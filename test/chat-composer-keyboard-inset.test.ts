import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the composer-padding side of useKeyboardInset:
// the community chat page pads its root container by the keyboard inset
// (paddingBottom = `${inset}px`) so the composer sits directly above the iOS
// on-screen keyboard instead of hiding beneath it. The bottom-nav side is
// pinned by test/bottom-nav-keyboard-inset.test.ts; this file pins the
// typing-surface side by mounting the real CommunityChatPage, driving a
// stubbed visualViewport through keyboard open/close/jitter, and asserting
// the inline paddingBottom is applied and removed accordingly.
// Harness mirrors test/community-chat-live-updates.test.ts; the
// visualViewport stub mirrors test/bottom-nav-keyboard-inset.test.ts.
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
  "KeyboardEvent", "InputEvent", "MessageEvent", "NodeFilter", "DOMException",
  "MutationObserver",
] as const;
for (const key of BROWSER_GLOBALS) {
  if (w[key] !== undefined) {
    g[key] = w[key];
  }
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

const URLCtor = window.URL as unknown as { createObjectURL?: () => string; revokeObjectURL?: () => void };
URLCtor.createObjectURL ??= () => "blob:stub";
URLCtor.revokeObjectURL ??= () => {};

// Fixed layout viewport height for the inset math:
// inset = window.innerHeight - visualViewport.height - visualViewport.offsetTop.
Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });

// --- Controllable visualViewport stub ---------------------------------------
// useKeyboardInset treats anything <= 80px as browser-chrome jitter (inset 0).
type VvListener = () => void;
const vvListeners = new Map<string, Set<VvListener>>();
const visualViewportStub = {
  height: 800,
  offsetTop: 0,
  addEventListener(type: string, cb: VvListener) {
    if (!vvListeners.has(type)) vvListeners.set(type, new Set());
    vvListeners.get(type)!.add(cb);
  },
  removeEventListener(type: string, cb: VvListener) {
    vvListeners.get(type)?.delete(cb);
  },
};
Object.defineProperty(window, "visualViewport", {
  value: visualViewportStub,
  configurable: true,
});

function fireViewportResize(): void {
  for (const cb of vvListeners.get("resize") ?? []) cb();
}

// --- Inert WebSocket stub -----------------------------------------------------
// The chat page opens a socket after auth resolves; this test never needs
// live events, so the stub just records instances and stays CONNECTING.
class InertWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  url: string;
  readyState = InertWebSocket.CONNECTING;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  constructor(url: string) {
    this.url = url;
  }
  send(): void {}
  close(): void {
    this.readyState = InertWebSocket.CLOSED;
  }
}
g.WebSocket = InertWebSocket as unknown as typeof WebSocket;
w.WebSocket = InertWebSocket as unknown as typeof WebSocket;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Fixtures + fetch stub ----------------------------------------------------
const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com", chatUsername: "casey", chatNotifications: "mentions", chatBanned: false,
};

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

  if (pathname === "/api/auth/me") return jsonResponse(CUSTOMER_USER);
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/community-chat/messages") return jsonResponse([]);
  if (pathname === "/api/community-chat/participants") return jsonResponse([]);
  return jsonResponse({});
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient, getQueryFn } = await import("../client/src/lib/queryClient");
queryClient.setDefaultOptions({
  queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
  mutations: { retry: false, gcTime: 0 },
});
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const CommunityChatPage = (await import("../client/src/pages/community-chat-page")).default;

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  cleanup: () => void;
}

async function mountChat(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.clear();

  const { hook } = memoryLocation({ path: "/community" });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          {
            hook,
            children: React.createElement(Route, { path: "/community", component: CommunityChatPage }),
          },
        ),
      ),
    );

  const root: Root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

function pageRoot(): HTMLElement {
  const el = window.document.body.querySelector<HTMLElement>('[data-testid="community-chat-page"]');
  assert.ok(el, "community chat page rendered");
  return el!;
}

async function setKeyboardCoverage(px: number): Promise<void> {
  visualViewportStub.height = 800 - px;
  await act(async () => {
    fireViewportResize();
  });
  await flush();
}

test("chat container pads by the keyboard inset while the keyboard is open and unpads when it closes", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { cleanup } = await mountChat();
  try {
    // Keyboard closed: no keyboard padding on the chat container.
    assert.equal(
      pageRoot().style.paddingBottom,
      "",
      "no composer padding while the keyboard is closed",
    );

    // Keyboard opens (covers 320px): container padded by exactly the inset so
    // the composer sits directly above the keyboard.
    await setKeyboardCoverage(320);
    assert.equal(
      pageRoot().style.paddingBottom,
      "320px",
      "container must be padded by the keyboard inset while typing",
    );

    // Keyboard height changes (e.g. suggestion bar toggles): padding follows.
    await setKeyboardCoverage(260);
    assert.equal(
      pageRoot().style.paddingBottom,
      "260px",
      "padding must track keyboard height changes",
    );

    // Keyboard closes: padding removed so the layout returns to normal.
    await setKeyboardCoverage(0);
    assert.equal(
      pageRoot().style.paddingBottom,
      "",
      "composer padding must be removed once the keyboard closes",
    );
  } finally {
    cleanup();
  }
});

test("sub-threshold viewport shrink (browser chrome jitter) does not pad the composer", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { cleanup } = await mountChat();
  try {
    // 60px < 80px threshold: treated as chrome jitter, no padding.
    await setKeyboardCoverage(60);
    assert.equal(
      pageRoot().style.paddingBottom,
      "",
      "sub-threshold viewport changes must not pad the composer",
    );
    await setKeyboardCoverage(0);
  } finally {
    cleanup();
  }
});
