import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom render test for the WHMCS account-link dialog's verify step --------
// Locks in the user-facing branches of the code *verification* mutation:
//   - "linked"            -> shows the success step (text-whmcs-success-title)
//   - "invalid_code" with attemptsRemaining -> stays on the code step (toast)
//   - "expired"           -> resets back to the email step and clears the code
//   - "too_many_attempts" -> resets back to the email step and clears the code
//   - "conflict"          -> shows the conflict step (text-whmcs-conflict-title)
// Mirrors the jsdom client-component pattern (global React, gcTime:0 teardown)
// used by test/whmcs-link-resend-cooldown.test.ts.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/",
});
const { window } = dom;

type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
  // Radix Dialog (focus-scope) reads MutationObserver as a bare global.
  "MutationObserver",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) {
    g[key] = w[key];
  }
}

// Route rAF through setImmediate so React/Radix scheduling never stalls.
const rafImpl: typeof requestAnimationFrame = (cb) =>
  setImmediate(() => cb(Date.now())) as unknown as number;
const cafImpl: typeof cancelAnimationFrame = (id) =>
  clearImmediate(id as unknown as NodeJS.Immediate);
g.requestAnimationFrame = rafImpl;
g.cancelAnimationFrame = cafImpl;
w.requestAnimationFrame = rafImpl;
w.cancelAnimationFrame = cafImpl;

class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
g.ResizeObserver = ResizeObserverStub;
w.ResizeObserver = ResizeObserverStub;

class DOMRectStub implements DOMRect {
  x = 0; y = 0; width = 0; height = 0;
  top = 0; right = 0; bottom = 0; left = 0;
  toJSON(): unknown { return this; }
}
g.DOMRect = DOMRectStub;
w.DOMRect = DOMRectStub;

interface PointerCaptureProto {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
  getBoundingClientRect: () => DOMRect;
}
const HEProto = window.HTMLElement.prototype as unknown as PointerCaptureProto;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};
HEProto.getBoundingClientRect = () => new DOMRectStub();

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Configurable fetch stub: each test installs its own request handler -----
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

type ReqHandler = (pathname: string) => Response;
// Default: code send succeeds, verify says linked. Tests override the verify arm.
let requestHandler: ReqHandler = () => jsonResponse({ status: "code_sent" });

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];
  return requestHandler(pathname);
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and the
// component tree evaluate.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WhmcsLinkDialog } = await import("../client/src/components/whmcs-link-dialog");

// Flush React effects + resolved fetch promises.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setImmediate(r));
    });
  }
}

function findByTestId(id: string): Element | null {
  // Radix Dialog portals its content onto document.body, so query the document.
  return window.document.querySelector(`[data-testid="${id}"]`);
}

interface MountResult {
  root: Root;
  cleanup: () => void;
}

async function mountDialog(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(WhmcsLinkDialog, {
        open: true,
        onOpenChange: () => {},
      }),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

// Set a controlled <input>'s value the way React's tracked native setter expects,
// then fire the input event so onChange runs.
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, value);
  await act(async () => {
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

// Walk the email step → enter a valid address → click "Send code". Leaves the
// dialog on the code step.
async function sendCode(): Promise<void> {
  const emailInput = findByTestId("input-whmcs-link-email");
  assert.ok(emailInput instanceof window.HTMLInputElement, "email input present on email step");
  await typeInto(emailInput as HTMLInputElement, "user@example.com");

  const sendBtn = findByTestId("button-whmcs-link-send-code") as HTMLButtonElement | null;
  assert.ok(sendBtn, "send-code button present");
  await act(async () => {
    sendBtn!.click();
  });
  await flush();
}

// Type a 6-digit code on the code step and click "Verify & link". The verify
// button is gated only by code validity (NOT the resend cooldown), so once a
// valid code is entered it is immediately clickable.
async function enterCodeAndVerify(value: string): Promise<void> {
  const codeInput = findByTestId("input-whmcs-link-code");
  assert.ok(codeInput instanceof window.HTMLInputElement, "code input present on code step");
  await typeInto(codeInput as HTMLInputElement, value);

  const verifyBtn = findByTestId("button-whmcs-link-verify") as HTMLButtonElement | null;
  assert.ok(verifyBtn, "verify button present on code step");
  assert.equal(verifyBtn!.disabled, false, "verify button is enabled once a valid code is entered");
  await act(async () => {
    verifyBtn!.click();
  });
  await flush();
}

// Build a handler that sends a code, then returns `verify` for the verify call.
function handlerFor(verify: Response): ReqHandler {
  return (pathname) =>
    pathname.endsWith("/verify") ? verify : jsonResponse({ status: "code_sent" });
}

test("the verify button is clickable right after a code is sent (resend cooldown does not gate it)", async () => {
  requestHandler = handlerFor(jsonResponse({ status: "linked" }));
  const h = await mountDialog();
  try {
    await sendCode();
    assert.ok(findByTestId("text-whmcs-code-title"), "advanced to the code step");

    // The post-send resend cooldown is active, but the verify button should be
    // enabled the moment a valid 6-digit code is entered.
    const codeInput = findByTestId("input-whmcs-link-code") as HTMLInputElement;
    await typeInto(codeInput, "123456");

    const verifyBtn = findByTestId("button-whmcs-link-verify") as HTMLButtonElement;
    assert.equal(verifyBtn.disabled, false, "verify button is enabled despite the active cooldown");

    // The resend control stays cooldown-gated.
    const resendBtn = findByTestId("button-whmcs-link-resend") as HTMLButtonElement | null;
    assert.ok(resendBtn, "resend control present on the code step");
    assert.equal(resendBtn!.disabled, true, "resend stays disabled while the cooldown runs");
  } finally {
    h.cleanup();
  }
});

test("a correct code links the account and shows the success step", async () => {
  requestHandler = handlerFor(jsonResponse({ status: "linked" }));
  const h = await mountDialog();
  try {
    await sendCode();
    assert.ok(findByTestId("text-whmcs-code-title"), "advanced to the code step");

    await enterCodeAndVerify("123456");

    assert.ok(findByTestId("text-whmcs-success-title"), "verify success shows the success step");
    assert.equal(findByTestId("text-whmcs-code-title"), null, "code step is gone");
  } finally {
    h.cleanup();
  }
});

test("an incorrect code with attempts remaining keeps the user on the code step", async () => {
  requestHandler = handlerFor(
    jsonResponse({ status: "invalid_code", attemptsRemaining: 2 }),
  );
  const h = await mountDialog();
  try {
    await sendCode();
    await enterCodeAndVerify("000000");

    // Stays on the code step (the toast is the only user feedback); the code
    // input is left intact so the user can correct it.
    assert.ok(findByTestId("text-whmcs-code-title"), "still on the code step after a wrong code");
    assert.equal(findByTestId("text-whmcs-success-title"), null, "no success step");
    assert.equal(findByTestId("text-whmcs-conflict-title"), null, "no conflict step");
    const codeInput = findByTestId("input-whmcs-link-code") as HTMLInputElement;
    assert.equal(codeInput.value, "000000", "the entered code is preserved for a retry");
  } finally {
    h.cleanup();
  }
});

// Drain the post-send resend cooldown to 0 so the email step's "Send code"
// button (also disabled during cooldown) becomes clickable again. Uses faked
// setTimeout; setImmediate stays real so React keeps scheduling.
async function drainCooldown(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    const send = findByTestId("button-whmcs-link-send-code") as HTMLButtonElement | null;
    if (send && !send.disabled) break;
    await act(async () => {
      mock.timers.tick(1000);
      await new Promise<void>((r) => setImmediate(r));
    });
  }
}

// Both reset branches set step back to "email" and clear the entered code. To
// observe the cleared code we must return to the code step, but the resend
// cooldown started on the first send still disables "Send code" — so fake timers
// drain it before re-sending and asserting the code input is empty.
for (const status of ["expired", "too_many_attempts"] as const) {
  test(`a ${status} verify resets back to the email step and clears the code`, async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    requestHandler = handlerFor(jsonResponse({ status }));
    const h = await mountDialog();
    try {
      await sendCode();
      await enterCodeAndVerify("123456");

      assert.ok(findByTestId("text-whmcs-link-title"), "reset back to the email step");
      assert.equal(findByTestId("text-whmcs-code-title"), null, "code step is gone");

      // Re-advance to the code step; the input should start empty.
      requestHandler = handlerFor(jsonResponse({ status: "linked" }));
      await drainCooldown();
      await sendCode();
      const codeInput = findByTestId("input-whmcs-link-code") as HTMLInputElement;
      assert.ok(codeInput, "back on the code step after re-sending");
      assert.equal(codeInput.value, "", "the code was cleared on reset");
    } finally {
      h.cleanup();
      mock.timers.reset();
    }
  });
}

test("a conflict on verify shows the conflict step", async () => {
  requestHandler = handlerFor(jsonResponse({ status: "conflict" }));
  const h = await mountDialog();
  try {
    await sendCode();
    await enterCodeAndVerify("123456");

    assert.ok(findByTestId("text-whmcs-conflict-title"), "verify conflict shows the conflict step");
    assert.equal(findByTestId("text-whmcs-code-title"), null, "code step is gone");
    assert.equal(findByTestId("text-whmcs-success-title"), null, "no success step");
  } finally {
    h.cleanup();
  }
});
