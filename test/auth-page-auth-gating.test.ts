import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { JSDOM } from "jsdom";

// The auth page renders <BrandLogo>, which imports `.png` files via Vite's
// `@assets` alias. Node/tsx can't import images as modules, so stub them out
// before any dynamic import of the component tree pulls them in.
register("./helpers/asset-stub-loader.mjs", import.meta.url);

// --- jsdom globals + polyfills (mirrors test/admin-portal-admin-gating.test.ts)
// This is a real render test for the public auth screen (auth-page.tsx). Its
// purpose is a regression guard: the page used to early-return (redirecting an
// already-signed-in user) BEFORE it called its two `useForm` hooks. A first
// render with the user still unknown (null) ran those hooks; once auth resolved
// (null -> user) the early return fired before them, changing the hook count
// and crashing React with "Rendered more hooks than during the previous
// render", white-screening the page. All hooks now run unconditionally before
// the guard, so the null -> user upgrade must render cleanly and redirect.
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

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Test fixtures + a fetch stub that serves the page's queries ----------
const CUSTOMER_USER = { id: "cust-1", role: "customer", fullName: "Casey Customer", username: "casey", email: "casey@example.com" };

// Set per-test before mounting so /api/auth/me returns the right identity.
let currentUser: typeof CUSTOMER_USER | null = null;

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
// auth-page.tsx and auth.tsx rely on Vite's automatic JSX runtime and do not
// import React. Under tsx the JSX compiles to classic `React.createElement`
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
const { Router } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const AuthPage = (await import("../client/src/pages/auth-page")).default;

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
  history: string[];
  cleanup: () => void;
}

async function mountAuth(
  user: typeof CUSTOMER_USER | null,
  { seed = false }: { seed?: boolean } = {},
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

  if (seed && user) {
    queryClient.setQueryData(["/api/auth/me"], user);
  }

  const { hook, history } = memoryLocation({ path: "/auth", record: true });

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
            children: React.createElement(AuthPage),
          },
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
    history: history as string[],
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

// --- Signed-out visitor sees the sign-in form ----------------------------

test("signed-out visitor sees the login and register tabs", async () => {
  const h = await mountAuth(null);
  try {
    assert.ok(has("tab-login"), "sign-in tab is shown to a signed-out visitor");
    assert.ok(has("tab-register"), "sign-up tab is shown to a signed-out visitor");
    assert.ok(has("button-login"), "the login button renders");
  } finally {
    h.cleanup();
  }
});

// --- Auth resolves AFTER the first render --------------------------------
// Regression guard: the page used to call several hooks, then (for a logged-in
// user) early-return a redirect, then call the two useForm hooks BELOW that
// return. A first render with the user still unknown (null) ran the form hooks;
// the null -> user upgrade then skipped them, changing the hook count and
// crashing React. All hooks now run before the guard, so this must not crash:
// the form must disappear and the user must be redirected to "/".

test("auth page survives auth resolving to a signed-in user after first render (no hook-count crash)", async () => {
  let releaseAuth: () => void = () => {};
  authGate = new Promise<void>((resolve) => { releaseAuth = resolve; });

  // seed: false → the first render happens while /api/auth/me is still
  // pending, so useAuth yields user=null and the auth form renders. Every hook
  // (including the two useForm calls) must run on this render.
  const h = await mountAuth(CUSTOMER_USER, { seed: false });
  try {
    assert.ok(has("tab-login"), "form is shown while auth is unresolved");

    // Resolve auth to a signed-in user. This re-renders the page; if the
    // useForm hooks still lived below an early return the hook count would
    // change here and React would throw.
    releaseAuth();
    authGate = null;
    await flush();

    assert.equal(has("tab-login"), false, "form is gone once the user resolves");
    assert.equal(has("button-login"), false, "login button is gone once the user resolves");
    assert.ok(
      h.history.includes("/"),
      "signed-in customer is redirected to the dashboard",
    );
  } finally {
    authGate = null;
    h.cleanup();
  }
});

// --- Already signed-in on first render is redirected, no form flash -------

test("already signed-in visitor is redirected away and never sees the form", async () => {
  const h = await mountAuth(CUSTOMER_USER, { seed: true });
  try {
    assert.equal(has("tab-login"), false, "no sign-in form for an already signed-in visitor");
    assert.ok(h.history.includes("/"), "already signed-in customer is redirected to the dashboard");
  } finally {
    h.cleanup();
  }
});
