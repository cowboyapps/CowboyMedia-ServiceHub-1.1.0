import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Render test pinning the "bottom nav hides while the on-screen keyboard is
// open" behavior. BottomNav returns null when useKeyboardInset() > 0 so the
// fixed bar can't float mid-screen above the iOS keyboard while typing. The
// hook thresholds raw viewport loss, then subtracts offsetTop for layout
// padding while preserving a non-zero keyboard-open signal after a full pan.
// This test drives a stubbed visualViewport through
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
window.scrollTo = () => {};

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
// useKeyboardInset computes bottom occlusion from the visual viewport edge;
// with offsetTop at zero this is window.innerHeight - vv.height. Anything
// <= 80px is treated as browser-chrome jitter (inset 0).
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

function fireOrientationChange(): void {
  window.dispatchEvent(new window.Event("orientationchange"));
}

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- fetch stub -------------------------------------------------------------
const CUSTOMER_USER = {
  id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey",
  email: "casey@example.com",
};
let currentRole = "customer";
let newsCount = 4;

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

  if (pathname === "/api/auth/me") return jsonResponse({ ...CUSTOMER_USER, role: currentRole });
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname.endsWith("/unread-count")) return jsonResponse({ count: 0 });
  if (pathname === "/api/content-notifications/counts") return jsonResponse({ "admin-reports": 2, "admin-users": 3, news: newsCount });
  if (pathname === "/api/promotions") return jsonResponse([]);
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
const { useKeyboardInset } = await import("../client/src/hooks/use-keyboard-inset");
const { useKeyboardOpen } = await import("../client/src/hooks/use-keyboard-open");

function KeyboardProbe() {
  const inset = useKeyboardInset();
  const open = useKeyboardOpen();
  return React.createElement("output", { "data-testid": "keyboard-probe", "data-inset": inset, "data-open": String(open) });
}

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

async function mountNav(path = "/services"): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const { hook } = memoryLocation({ path });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(Router, { hook, children: React.createElement(React.Fragment, null, React.createElement(BottomNav), React.createElement(KeyboardProbe)) }),
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
      queryClient.clear();
      container.remove();
    },
  };
}

function navEl(container: HTMLElement): Element | null {
  return container.querySelector('[data-testid="nav-bottom"]');
}

test("customers retain five tabs with News and no Admin shortcut", async () => {
  currentRole = "customer";
  const { container, cleanup } = await mountNav();
  try {
    assert.ok(container.querySelector('[data-testid="link-bottom-nav-news"]'));
    assert.equal(container.querySelector('[data-testid="link-bottom-nav-admin"]'), null);
    assert.equal(navEl(container)?.querySelectorAll("a, button").length, 5);
  } finally { cleanup(); }
});

for (const role of ["admin", "master_admin"]) {
  test(`${role} gets a one-tap Admin tab with its own badge, not a More badge`, async () => {
    currentRole = role;
    newsCount = 0;
    const { container, cleanup } = await mountNav("/admin");
    try {
      const admin = container.querySelector('[data-testid="link-bottom-nav-admin"]');
      assert.equal(admin?.getAttribute("href"), "/admin");
      assert.ok(admin?.textContent?.includes("Admin"));
      assert.equal(container.querySelector('[data-testid="badge-bottom-nav-admin"]')?.textContent, "5");
      assert.equal(container.querySelector('[data-testid="link-bottom-nav-news"]'), null);
      assert.equal(navEl(container)?.querySelectorAll("a, button").length, 5);
      assert.match(admin?.lastElementChild?.className ?? "", /font-semibold/);
      const more = container.querySelector('[data-testid="button-bottom-nav-more"]');
      assert.doesNotMatch(more?.lastElementChild?.className ?? "", /font-semibold/);
      // Admin-only attention must not also light up More.
      assert.equal(container.querySelector('[data-testid="badge-bottom-nav-more"]'), null);
    } finally { cleanup(); currentRole = "customer"; newsCount = 4; }
  });
}

test("admin News routes highlight More instead of Admin", async () => {
  currentRole = "admin";
  const { container, cleanup } = await mountNav("/news/example");
  try {
    const more = container.querySelector('[data-testid="button-bottom-nav-more"]');
    assert.ok(container.querySelector('[data-testid="badge-bottom-nav-more"]'), "unread News lights up More");
    assert.match(more?.lastElementChild?.className ?? "", /font-semibold/);
    assert.doesNotMatch(container.querySelector('[data-testid="link-bottom-nav-admin"]')?.lastElementChild?.className ?? "", /font-semibold/);
    await act(async () => { (more as HTMLButtonElement).click(); });
    await flush();
    const news = [...window.document.querySelectorAll("button")].find(el => el.textContent?.includes("News"));
    assert.ok(news, "News is available in the More sheet");
  } finally { cleanup(); currentRole = "customer"; }
});

async function setKeyboardCoverage(px: number): Promise<void> {
  visualViewportStub.height = 800 - px;
  await act(async () => {
    fireViewportResize();
  });
  await flush();
}

test("BottomNav stays hidden through rotation while the keyboard is open", async () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  try {
    // Keyboard closed (inset 0): nav visible.
    assert.ok(navEl(container), "nav should render on mobile with no keyboard inset");

    // Keyboard opens (covers 300px, above the 80px jitter threshold): nav hides.
    await setKeyboardCoverage(300);
    assert.equal(navEl(container), null, "nav must unmount while the on-screen keyboard is open");

    Object.defineProperty(window, "innerHeight", { value: 430, configurable: true, writable: true });
    visualViewportStub.height = 300;
    visualViewportStub.offsetTop = 50;
    await act(async () => {
      fireOrientationChange();
    });
    await flush();
    assert.equal(navEl(container), null, "nav must remain hidden after rotating with the keyboard open");

    visualViewportStub.height = 260;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await flush();
    assert.equal(navEl(container), null, "nav must remain hidden while the rotated viewport settles");

    // Keyboard closes again: nav returns.
    visualViewportStub.height = 430;
    visualViewportStub.offsetTop = 0;
    await act(async () => {
      fireViewportResize();
    });
    await flush();
    assert.ok(navEl(container), "nav should reappear once the keyboard closes");
  } finally {
    cleanup();
  }
});

test("sub-threshold viewport shrink (browser chrome jitter) does not hide the nav", async () => {
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
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
  // iOS can pan the visual viewport down by the full keyboard height. Layout
  // padding may then fall to the 1px sentinel, but the open signal must remain
  // non-zero so the nav stays hidden; the hook must also request an un-pan.
  const scrollCalls: Array<[number, number]> = [];
  const scrollToImpl = (x: number, y: number) => { scrollCalls.push([x, y]); };
  g.scrollTo = scrollToImpl;
  w.scrollTo = scrollToImpl;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });

  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
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

test("Android resize hides nav without adding padding; Back, reopen and rotation retain drafts", async () => {
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  const input = document.createElement("textarea");
  input.value = "Keep this long draft.\n".repeat(30);
  document.body.append(input);
  const original = input.value;
  const resize = async (height: number, width = 390) => {
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    visualViewportStub.height = height;
    await act(async () => {
      window.dispatchEvent(new window.Event("resize"));
      fireViewportResize();
    });
    await flush();
  };
  try {
    await act(async () => input.focus());
    assert.ok(navEl(container), "hardware keyboard focus alone does not hide nav");
    // Small intermediate animation steps must not overwrite the baseline.
    for (const height of [750, 700, 650, 600, 500]) await resize(height);
    assert.equal(navEl(container), null, "both viewports shrinking hides navigation");
    assert.equal(container.querySelector('[data-testid="keyboard-probe"]')?.getAttribute("data-inset"), "0");
    await resize(450);
    assert.equal(navEl(container), null, "keyboard suggestion-height changes keep nav hidden");
    await resize(800);
    assert.ok(navEl(container), "Android Back restores nav without blur");
    assert.equal(document.activeElement, input);
    await resize(500);
    assert.equal(navEl(container), null);
    await resize(240, 800);
    await act(async () => fireOrientationChange());
    await flush();
    assert.equal(container.querySelector('[data-testid="keyboard-probe"]')?.getAttribute("data-open"), "true");
    assert.equal(container.querySelector('[data-testid="keyboard-probe"]')?.getAttribute("data-inset"), "0");
    await resize(430, 800);
    assert.equal(container.querySelector('[data-testid="keyboard-probe"]')?.getAttribute("data-open"), "false");
    await resize(800, 390);
    assert.ok(navEl(container));
    await resize(740);
    assert.ok(navEl(container), "small browser-toolbar changes do not hide nav while focused");
    assert.equal(input.value, original);
  } finally {
    input.remove();
    cleanup();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    visualViewportStub.height = 800;
  }
});

test("first Android rotation learns the shorter landscape baseline on keyboard dismissal", async () => {
  Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
  Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
  visualViewportStub.height = 800;
  visualViewportStub.offsetTop = 0;
  const { container, cleanup } = await mountNav();
  const input = document.createElement("textarea");
  document.body.append(input);
  const resize = async (height: number, width: number) => {
    Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
    visualViewportStub.height = height;
    await act(async () => {
      window.dispatchEvent(new window.Event("resize"));
      fireViewportResize();
    });
    await flush();
  };
  try {
    await act(async () => input.focus());
    await resize(440, 390);
    assert.equal(navEl(container), null);
    await resize(190, 740);
    assert.equal(navEl(container), null);
    // Keyboard closes in stages without blur (Android Back).
    await resize(250, 740);
    assert.equal(navEl(container), null);
    await resize(390, 740);
    assert.ok(navEl(container), "nav restores despite landscape being shorter than portrait keyboard loss estimate");
    assert.equal(document.activeElement, input);
    assert.equal(container.querySelector('[data-testid="keyboard-probe"]')?.getAttribute("data-inset"), "0");
    await resize(190, 740);
    assert.equal(navEl(container), null, "reopen uses learned real landscape baseline");
    await resize(390, 740);
    assert.ok(navEl(container));
    await act(async () => input.blur());
    assert.ok(navEl(container), "blur cannot re-latch keyboard state");
  } finally {
    input.remove();
    cleanup();
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true, writable: true });
    Object.defineProperty(window, "innerHeight", { value: 800, configurable: true, writable: true });
    visualViewportStub.height = 800;
  }
});
