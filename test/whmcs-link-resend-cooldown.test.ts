import { test, after, mock } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom render test for the WHMCS account-link dialog's resend cooldown ---
// Locks in two safeguards added to stop email spamming on the "Resend code"
// flow:
//   1. After a code is sent the "Resend code" button is disabled and shows a
//      live countdown ("Resend in 45s").
//   2. When the server rate-limits a resend (HTTP 429 with retryAfterSeconds),
//      the dialog surfaces a friendly "try again in N seconds" notice
//      (data-testid text-whmcs-link-rate-limit) instead of failing silently.
// Mirrors the jsdom client-component pattern (global React, gcTime:0 teardown)
// used by test/chat-composer.test.ts and test/messages-admin-gating.test.ts.
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

// Route rAF through setImmediate (kept REAL even when setTimeout is faked in the
// 429 test) so React/Radix scheduling never stalls under fake timers.
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
// Default: every request is a successful code send.
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
// whmcs-link-dialog.tsx only imports { useEffect, useState } from "react" and
// relies on the classic JSX transform's free `React.createElement`. Expose React
// on the global so that resolves under tsx.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { WhmcsLinkDialog } = await import("../client/src/components/whmcs-link-dialog");

// Flush React effects + resolved fetch promises. Uses setImmediate (never faked)
// so it still drains under the 429 test's fake setTimeout.
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
      // gcTime:0 so React Query's default 5-min cache timer doesn't keep the
      // node:test subprocess alive after the last assertion.
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
// dialog on the code step with the resend cooldown running.
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

test("after a code is sent, the resend button is disabled with a live countdown", async () => {
  requestHandler = () => jsonResponse({ status: "code_sent" });
  const h = await mountDialog();
  try {
    await sendCode();

    // We're now on the code step.
    assert.ok(findByTestId("text-whmcs-code-title"), "advanced to the code step");

    const resend = findByTestId("button-whmcs-link-resend") as HTMLButtonElement | null;
    assert.ok(resend, "resend button rendered on the code step");
    assert.equal(resend!.disabled, true, "resend is disabled immediately after a code is sent");
    assert.match(
      resend!.textContent ?? "",
      /Resend in \d+s/,
      "resend shows a countdown instead of being clickable",
    );
  } finally {
    h.cleanup();
  }
});

test("a 429 on resend shows the friendly rate-limit notice on the code step", async () => {
  // Fake setTimeout so we can drain the resend cooldown to 0 without 45s of real
  // time. rAF/flush use setImmediate, which stays real, so React keeps working.
  mock.timers.enable({ apis: ["setTimeout"] });
  requestHandler = () => jsonResponse({ status: "code_sent" });
  const h = await mountDialog();
  try {
    await sendCode();

    const resend = findByTestId("button-whmcs-link-resend") as HTMLButtonElement;
    assert.equal(resend.disabled, true, "resend starts disabled during cooldown");

    // Tick the cooldown down one second at a time; act() between ticks lets the
    // effect re-render and schedule the next 1s timer.
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        mock.timers.tick(1000);
        await new Promise<void>((r) => setImmediate(r));
      });
      if (!(findByTestId("button-whmcs-link-resend") as HTMLButtonElement).disabled) break;
    }

    const readyResend = findByTestId("button-whmcs-link-resend") as HTMLButtonElement;
    assert.equal(readyResend.disabled, false, "resend re-enables once the cooldown elapses");

    // Next resend gets rate-limited.
    requestHandler = () =>
      jsonResponse({ error: "Too many requests", retryAfterSeconds: 30 }, 429);
    await act(async () => {
      readyResend.click();
    });
    await flush();

    const notice = findByTestId("text-whmcs-link-rate-limit");
    assert.ok(notice, "rate-limit notice is shown on the code step");
    assert.match(
      notice!.textContent ?? "",
      /try again in 30 seconds/i,
      "notice tells the user how long to wait",
    );
  } finally {
    h.cleanup();
    mock.timers.reset();
  }
});
