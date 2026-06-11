import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/messages-admin-gating.test.ts) -
// This is a real render test: it mounts the dedicated admin management surface
// (the /admin route → admin-portal.tsx) as a customer and as an admin and
// asserts the client-side gating. The admin portal is where Knowledge Base
// article create/edit/delete and News create/edit actually live, reached via
// its own route. The server already enforces these permissions; this
// complements that by confirming a customer who navigates straight to /admin
// is blocked (sees the "Access Denied" no-access state) and never sees the
// admin tooling, while an admin sees the management tiles.
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

// matchMedia (used by useIsMobile in admin portal subcomponents).
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

// Some admin portal subcomponents open reconnecting WebSockets on mount. jsdom
// has no WebSocket; a stub that never fires events keeps things stable.
class WebSocketStub {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(): void {}
  close(): void { this.readyState = 3; }
  addEventListener(): void {}
  removeEventListener(): void {}
}
g.WebSocket = WebSocketStub;
w.WebSocket = WebSocketStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Test fixtures + a fetch stub that serves the page's queries ----------
const CUSTOMER_USER = { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" };
const ADMIN_USER = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };

// Set per-test before mounting so /api/auth/me returns the right identity.
let currentUser: typeof CUSTOMER_USER | typeof ADMIN_USER | null = null;

// When set, the /api/auth/me handler awaits this promise before responding,
// letting a test hold the auth query in its unresolved (loading) state across
// the first render and resolve it afterwards.
let authGate: Promise<void> | null = null;

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
    if (authGate) await authGate;
    return currentUser ? jsonResponse(currentUser) : jsonResponse(null, 401);
  }
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/content-notifications/counts") return jsonResponse({});
  if (pathname === "/api/admin/chat/unread-count") return jsonResponse({ count: 0 });

  // Unknown endpoints: succeed quietly so background fetches don't error.
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
// admin-portal.tsx and auth.tsx rely on Vite's automatic JSX runtime and do
// not import React. Under tsx the JSX compiles to classic `React.createElement`
// calls that resolve `React` from the global scope, so expose it there before
// those modules render.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const AdminPortal = (await import("../client/src/pages/admin-portal")).default;

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

async function mountAdmin(
  path: string,
  user: typeof CUSTOMER_USER | typeof ADMIN_USER,
  search = "",
  { seed = true }: { seed?: boolean } = {},
): Promise<MountResult> {
  currentUser = user;
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  // Seed the auth cache so the very first render already knows the identity.
  // Most tests want this so the portal renders its resolved state immediately.
  // The "auth resolves after first render" test passes seed: false to exercise
  // the null → admin upgrade explicitly.
  if (seed) {
    queryClient.setQueryData(["/api/auth/me"], user);
  }

  const { hook } = memoryLocation({ path });
  // memoryLocation only models the path; the admin portal calls wouter's
  // useSearch for its deep-link params. Without an explicit searchHook wouter
  // falls back to the (undefined) browser `location` global, so feed the query
  // string in directly.
  const searchHook = () => search;

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        AuthProvider,
        null,
        React.createElement(
          Router,
          { hook, searchHook },
          React.createElement(Route, { path: "/admin", component: AdminPortal }),
        ),
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
      queryClient.clear();
    },
  };
}

function has(id: string): boolean {
  return window.document.body.querySelector(`[data-testid="${id}"]`) !== null;
}

// --- Customer is blocked at /admin ---------------------------------------

test("customer navigating to /admin is blocked and never sees the admin tooling", async () => {
  const h = await mountAdmin("/admin", CUSTOMER_USER);
  try {
    // The no-access state is shown...
    assert.ok(has("text-admin-access-denied"), "customer sees the Access Denied no-access state");

    // ...and none of the admin management surface renders.
    assert.equal(has("text-admin-title"), false, "no Admin Portal heading for customer");
    assert.equal(has("admin-menu-grouped"), false, "no admin tile menu for customer");
    assert.equal(has("tile-admin-knowledge-base"), false, "no Knowledge Base admin tile for customer");
    assert.equal(has("tile-admin-news"), false, "no News admin tile for customer");
    assert.equal(has("tile-admin-users"), false, "no Users admin tile for customer");
  } finally {
    h.cleanup();
  }
});

// --- Admin sees the management surface -----------------------------------

test("admin at /admin sees the management tiles including Knowledge Base and News", async () => {
  // tab=_menu forces the tile menu (otherwise a master_admin with
  // dashboard.view auto-lands on the heavier Overview dashboard).
  const h = await mountAdmin("/admin", ADMIN_USER, "tab=_menu");
  try {
    assert.equal(has("text-admin-access-denied"), false, "admin is not blocked");
    assert.ok(has("text-admin-title"), "admin sees the Admin Portal heading");
    assert.ok(has("admin-menu-grouped"), "admin sees the tile menu");
    assert.ok(has("tile-admin-knowledge-base"), "admin sees the Knowledge Base tile");
    assert.ok(has("tile-admin-news"), "admin sees the News tile");
    assert.ok(has("tile-admin-users"), "admin sees the Users tile");
  } finally {
    h.cleanup();
  }
});

// --- Auth resolves AFTER the first render --------------------------------
// Regression guard: the portal used to call several hooks, early-return the
// "Access Denied" view, then call MORE hooks below the return. A first render
// with the user still unknown (null) followed by a re-render as admin changed
// the hook count and crashed React with "Rendered more hooks than during the
// previous render", white-screening the page. All hooks now run before the
// gate, so this null → admin upgrade must render cleanly.

test("admin portal survives auth resolving after the first render (no hook-count crash)", async () => {
  let releaseAuth: () => void = () => {};
  authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });

  // seed: false → the first render happens while /api/auth/me is still
  // pending, so useAuth yields user=null and the portal takes the early
  // "Access Denied" return. Every hook must still have run on this render.
  const h = await mountAdmin("/admin", ADMIN_USER, "tab=_menu", { seed: false });
  try {
    assert.ok(has("text-admin-access-denied"), "shows Access Denied while auth is unresolved");
    assert.equal(has("text-admin-title"), false, "no admin surface before auth resolves");

    // Resolve auth to an admin. This re-renders the portal; if any hook still
    // lived below the early return the hook count would change here and React
    // would throw, so the admin surface would never appear.
    releaseAuth();
    authGate = null;
    await flush();

    assert.equal(has("text-admin-access-denied"), false, "Access Denied clears once admin resolves");
    assert.ok(has("text-admin-title"), "admin surface renders after auth resolves");
    assert.ok(has("admin-menu-grouped"), "admin sees the tile menu after auth resolves");
  } finally {
    authGate = null;
    h.cleanup();
  }
});
