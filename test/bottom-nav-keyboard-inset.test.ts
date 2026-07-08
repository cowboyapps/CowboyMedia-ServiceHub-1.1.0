import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Render test pinning the "bottom nav hides while the on-screen keyboard is
// open" behavior. BottomNav returns null when useKeyboardInset() > 0 so the
// fixed bar can't float mid-screen above the iOS keyboard while typing. The
// hook measures window.innerHeight - visualViewport.height (pan-independent —
// offsetTop is deliberately NOT subtracted, or an iOS viewport pan would
// cancel detection) with an 80px jitter threshold; this test drives a stubbed
// visualViewport through
// keyboard open/close and asserts the nav unmounts and remounts accordingly.
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

// Mobile viewport: useIsMobile checks window.innerWidth < 768.
Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });

// matchMedia for useIsMobile — reports mobile.
const matchMediaImpl = (query: string) => ({
  matches: true,
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

// --- Controllable visualViewport stub --------------------------------------
// useKeyboardInset computes: window.innerHeight - vv.height (pan-independent;
// offsetTop must NOT cancel detection), with anything <= 80px treated as
// browser-chrome jitter (inset 0).
type Listener = () => void;
const vvListeners = new Map<string, Set<Listener>>();
const visualViewportStub = {
  height: 800,
  offsetTop: 0,
  addEventListener(type: string, cb: Listener) {
    if (!vvListeners.has(type)) vvListeners.set(type, new Set());
    vvListeners.get(type)!.add(cb);
  },
  removeEventListener(type: string, cb: Listener) {
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

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- fetch stub -------------------------------------------------------------
const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com",
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
  if (pathname.endsWith("/unread-count")) return jsonResponse({ count: 0 });
  if (pathname === "/api/content-notifications/counts") return jsonResponse({});
  return jsonResponse({});
};

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { BottomNav } = await import("../client/src/components/bottom-nav");

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountNav(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const { hook } = memoryLocation({ path: "/services" });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(Router, { hook, children: React.createElement(BottomNav) }),
      ),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flush();

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function navEl(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="nav-bottom"]');
}

async function setKeyboardCoverage(px: number): Promise<void> {
  visualViewportStub.height = 800 - px;
  await act(async () => {
    fireViewportResize();
  });
  await flush();
}

test("BottomNav renders on mobile with keyboard closed and hides while keyboard is open", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  try {
    // Keyboard closed (inset 0): nav visible.
    assert.ok(navEl(container), "nav should render on mobile with no keyboard inset");

    // Keyboard opens (covers 300px, above the 80px jitter threshold): nav hides.
    await setKeyboardCoverage(300);
    assert.equal(navEl(container), null, "nav must unmount while the on-screen keyboard is open");

    // Keyboard closes again: nav returns.
    await setKeyboardCoverage(0);
    assert.ok(navEl(container), "nav should reappear once the keyboard closes");
  } finally {
    cleanup();
  }
});

test("sub-threshold viewport shrink (browser chrome jitter) does not hide the nav", async () => {
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  try {
    assert.ok(navEl(container));
    // 60px < 80px threshold: treated as chrome jitter, nav stays.
    await setKeyboardCoverage(60);
    assert.ok(navEl(container), "nav must not hide for sub-threshold viewport changes");
    await setKeyboardCoverage(0);
  } finally {
    cleanup();
  }
});

test("iOS visual-viewport pan (offsetTop) must not cancel keyboard detection", async () => {
  // Regression: iOS pans the visual viewport down to chase the focused input,
  // so offsetTop grows by ~the keyboard height. The old formula subtracted
  // offsetTop and read the inset as 0 at exactly that moment — nav floated
  // mid-screen with the keyboard open. Detection must ignore offsetTop, and
  // the hook must un-pan via window.scrollTo(0, 0).
  const scrollCalls: Array<[number, number]> = [];
  const scrollToImpl = (x: number, y: number) => { scrollCalls.push([x, y]); };
  g.scrollTo = scrollToImpl;
  w.scrollTo = scrollToImpl;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  try {
    assert.ok(navEl(container), "nav visible before the keyboard opens");

    // Keyboard covers 300px AND iOS pans the viewport down by 300px.
    visualViewportStub.height = 500;
    visualViewportStub.offsetTop = 300;
    await act(async () => {
      fireViewportResize();
    });
    await flush();

    assert.equal(
      navEl(container),
      null,
      "nav must hide even when the viewport pan offsets the keyboard height",
    );
    assert.ok(
      scrollCalls.some(([x, y]) => x === 0 && y === 0),
      "hook must un-pan via window.scrollTo(0, 0) while panned with keyboard open",
    );

    // Keyboard closes and pan resets: nav returns.
    visualViewportStub.height = 800;
    visualViewportStub.offsetTop = 0;
    await act(async () => {
      fireViewportResize();
    });
    await flush();
    assert.ok(navEl(container), "nav must return once the keyboard closes");
  } finally {
    cleanup();
  }
});
