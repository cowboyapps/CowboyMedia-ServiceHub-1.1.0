import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { JSDOM } from "jsdom";

// SetupReminderDialog pulls in BrandLogo, which imports `@assets/*.png` files.
// Vite turns those into URL strings at build time; under `tsx --test` Node
// can't import a .png, so short-circuit them to an empty-string module.
register("./helpers/asset-stub-loader.mjs", import.meta.url);

// Companion to test/onboarding-modal-queue.test.ts. That test drives faithful
// STAND-INS for the first-run popups; this one mounts the REAL in-app
// components — SetupReminderDialog and PrivateMessagePopup(Inner) — and proves
// they obey the anti-stacking modal queue end-to-end:
//   * each renders null while a higher-priority slot is claimed, and
//   * appears the moment the higher slot releases.
// A future edit that drops a component's own gating (e.g. removing the
// `!isMine` guard) would let the popup stack again and freeze first-run — and
// would fail here, where the literal components are exercised.
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
g.sessionStorage = window.sessionStorage;
g.localStorage = window.localStorage;

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) g[key] = w[key];
}

const rafImpl: typeof requestAnimationFrame = (cb) =>
  setTimeout(() => cb(Date.now()), 0) as unknown as number;
const cafImpl: typeof cancelAnimationFrame = (id) =>
  clearTimeout(id as unknown as NodeJS.Timeout);
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

// Radix's focus-scope (used inside Dialog) observes the DOM for removed nodes.
if (w.MutationObserver !== undefined) {
  g.MutationObserver = w.MutationObserver;
} else {
  class MutationObserverStub implements MutationObserver {
    observe(): void {}
    disconnect(): void {}
    takeRecords(): MutationRecord[] { return []; }
  }
  g.MutationObserver = MutationObserverStub;
  w.MutationObserver = MutationObserverStub;
}

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

const matchMediaImpl = (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent() { return false; },
});
g.matchMedia = matchMediaImpl;
w.matchMedia = matchMediaImpl;

// PrivateMessagePopupInner opens a reconnecting WebSocket on mount. jsdom has
// none — this stub records each instance so a test can drive an incoming
// private_message frame through the real onMessage handler.
type SockMsg = (ev: { data: string }) => void;
class WebSocketStub {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 1;
  url: string;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: SockMsg | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(url: string) {
    this.url = url;
    sockets.push(this);
  }
  send(): void {}
  close(): void { this.readyState = 3; }
  addEventListener(): void {}
  removeEventListener(): void {}
}
const sockets: WebSocketStub[] = [];
g.WebSocket = WebSocketStub as unknown as typeof WebSocket;
w.WebSocket = WebSocketStub as unknown as typeof WebSocket;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures + a fetch stub that serves the components' queries -----------
const CUSTOMER_ID = "cust-1";
// A customer who has finished the tour but not enabled push / picked services —
// the exact state that makes SetupReminderDialog WANT to show (jsdom has no
// serviceWorker, so isSubscribedToPush() is false).
const CUSTOMER_WANTS_REMINDER = {
  id: CUSTOMER_ID,
  role: "customer",
  fullName: "Casey Customer",
  username: "casey",
  email: "casey@example.com",
  onboardingTourCompletedAt: "2026-01-01T00:00:00.000Z",
  setupReminderDismissed: false,
  subscribedServices: [] as string[],
};
// Same customer, but with the setup reminder already dismissed so ONLY the
// private-message popup competes for a slot.
const CUSTOMER_NO_REMINDER = { ...CUSTOMER_WANTS_REMINDER, setupReminderDismissed: true };

let currentUser: Record<string, unknown> | null = null;

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];
  if (pathname === "/api/auth/me") {
    return currentUser ? jsonResponse(currentUser) : jsonResponse(null, 401);
  }
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  // Everything else (settings PATCH, etc.) succeeds quietly.
  return jsonResponse({});
};

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { useModalSlot, _resetModalQueueForTests } = await import("../client/src/lib/modal-queue");
const { SetupReminderDialog } = await import("../client/src/components/setup-reminder-dialog");
const { PrivateMessagePopup } = await import("../client/src/components/private-message-popup");

after(() => {
  g.fetch = realFetch;
  try { window.close(); } catch {}
});

beforeEach(() => {
  _resetModalQueueForTests();
  currentUser = null;
  sockets.length = 0;
  try { window.sessionStorage.clear(); } catch {}
  try { window.localStorage.clear(); } catch {}
});

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

// Deploy-gate machines can be much slower than dev: a fixed flush budget is not
// always enough for React + the modal queue to settle, which made this file
// flake and block deploys. For POSITIVE assertions ("the popup appears"), poll
// until the condition holds instead of assuming a fixed number of ticks.
async function waitFor(cond: () => boolean, message: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (!cond() && Date.now() - start < timeoutMs) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 25)); });
  }
  assert.ok(cond(), message);
}

// A stand-in for a HIGHER-priority first-run surface (the onboarding tour sits
// at 70, above the setup reminder's 45 and the message popup's 40). Toggling
// `hold` lets a test claim then release the top slot and watch the real popups
// react.
const HigherSlot: React.FC<{ hold: boolean }> = ({ hold }) => {
  useModalSlot("onboarding-tour", 70, hold);
  return null;
};

interface Harness {
  setHold: (hold: boolean) => Promise<void>;
  fireMessage: (subject: string) => Promise<void>;
  cleanup: () => void;
}

async function mount(hold: boolean): Promise<Harness> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const Tree: React.FC<{ hold: boolean }> = ({ hold }) =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          React.Fragment,
          null,
          React.createElement(HigherSlot, { hold }),
          React.createElement(SetupReminderDialog, null),
          React.createElement(PrivateMessagePopup, null),
        ),
      ),
    );

  const root = createRoot(container);
  const render = async (h: boolean) => {
    await act(async () => { root.render(React.createElement(Tree, { hold: h })); });
    await flush();
  };
  await render(hold);

  return {
    setHold: render,
    fireMessage: async (subject: string) => {
      const sock = sockets[sockets.length - 1];
      assert.ok(sock, "expected the private-message popup to have opened a WebSocket");
      await act(async () => {
        sock.onmessage?.({
          data: JSON.stringify({ type: "private_message", recipientId: CUSTOMER_ID, subject }),
        });
      });
      await flush();
    },
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

async function click(id: string): Promise<void> {
  const el = window.document.body.querySelector(`[data-testid="${id}"]`);
  assert.ok(el, `expected element [data-testid="${id}"] to exist`);
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

// --- The real SetupReminderDialog obeys the queue --------------------------
test("real SetupReminderDialog renders null under a higher slot, then appears once it releases", async () => {
  currentUser = CUSTOMER_WANTS_REMINDER;
  const h = await mount(true); // onboarding-tour holds the top slot
  try {
    assert.equal(
      has("dialog-setup-reminder"),
      false,
      "setup reminder stays hidden while a higher-priority slot is claimed",
    );

    await h.setHold(false); // higher slot releases
    await waitFor(
      () => has("dialog-setup-reminder"),
      "setup reminder appears once the higher slot releases",
    );
  } finally {
    h.cleanup();
  }
});

// --- The real PrivateMessagePopup obeys the queue --------------------------
test("real PrivateMessagePopup renders null under a higher slot, then appears once it releases", async () => {
  currentUser = CUSTOMER_NO_REMINDER; // only the message popup competes
  const h = await mount(true);
  try {
    await h.fireMessage("Ping");
    assert.equal(
      has("dialog-private-message-popup"),
      false,
      "message popup stays hidden while a higher-priority slot is claimed",
    );

    await h.setHold(false);
    await waitFor(
      () => has("dialog-private-message-popup"),
      "message popup appears once the higher slot releases",
    );
  } finally {
    h.cleanup();
  }
});

// --- The two real popups cascade: reminder (45) outranks message (40) ------
test("real setup reminder outranks the message popup; the message shows only once the reminder is dismissed", async () => {
  currentUser = CUSTOMER_WANTS_REMINDER;
  const h = await mount(false); // nothing higher claimed
  try {
    await h.fireMessage("Ping"); // both now want to show

    await waitFor(() => has("dialog-setup-reminder"), "the higher-priority setup reminder is active");
    assert.equal(
      has("dialog-private-message-popup"),
      false,
      "the message popup waits its turn under the reminder",
    );

    // Dismiss the reminder — it releases its slot; the message popup takes over.
    await click("button-reminder-dismiss");
    await waitFor(
      () => has("dialog-private-message-popup"),
      "message popup shows once the reminder releases its slot",
    );
    assert.equal(has("dialog-setup-reminder"), false, "reminder closed after dismiss");
  } finally {
    h.cleanup();
  }
});

// --- Anti-stacking: never more than one of them visible at once ------------
test("with a higher slot claimed and both real popups wanting, neither is visible", async () => {
  currentUser = CUSTOMER_WANTS_REMINDER;
  const h = await mount(true);
  try {
    await h.fireMessage("Ping");
    assert.equal(has("dialog-setup-reminder"), false, "setup reminder suppressed under the higher slot");
    assert.equal(has("dialog-private-message-popup"), false, "message popup suppressed under the higher slot");
  } finally {
    h.cleanup();
  }
});
