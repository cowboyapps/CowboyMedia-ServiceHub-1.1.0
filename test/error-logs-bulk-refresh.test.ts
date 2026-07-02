import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the ErrorLogsTab *bulk* actions' follow-up refetch
// (admin-portal.tsx). test/error-logs-resolve-refresh.test.ts locks in the
// per-row toggle's contract; this is the same contract for the two bulk
// buttons — "Resolve all" (resolveAllMutation) and "Clear all"
// (clearAllMutation). Each mutation's onSuccess invalidates BOTH
//   (1) ["/api/admin/error-logs"]                 — the row list, and
//   (2) ["/api/admin/error-logs/unresolved-count"] — the sidebar badge counter,
// so after a bulk action the list re-fetches AND the unresolved-count
// re-fetches. A regression dropping either invalidation would leave the list
// stale or the badge wrong until a manual refresh — a silent, user-visible
// staleness bug, just via the bulk buttons instead of the per-row toggle.
//
// The list query is owned by ErrorLogsTab (via AdminPortal). The unresolved
// counter query lives in AppSidebar (rendered in App.tsx's layout, not inside
// AdminPortal, and its asset imports don't resolve under tsx), so this test
// mounts a tiny probe that subscribes to the exact same
// ["/api/admin/error-logs/unresolved-count"] query key — sharing one
// QueryClient with AdminPortal — to make that counter query active. That is
// precisely what the bulk mutations' onSuccess invalidates, so a dropped
// invalidation would leave the probe's query unrefetched and fail this test.
// We then assert both endpoints see a fresh GET after each bulk action.
//
// Mirrors the jsdom conventions in test/error-logs-resolve-refresh.test.ts
// (global React, gcTime:0 teardown, wouter memoryLocation routing, the
// singleton-invalidateQueries bridge + CounterProbe technique).
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

// --- Fixtures + a fetch stub that serves the tab's queries ----------------
const ADMIN_USER = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };

// Two unresolved error-log rows.
const ERROR_LOGS = {
  logs: [
    { id: "err-1", severity: "error", source: "route", summary: "Boom one", details: null, userId: null, referenceType: null, referenceId: null, resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() },
    { id: "err-2", severity: "warn", source: "email", summary: "Boom two", details: null, userId: null, referenceType: null, referenceId: null, resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() },
  ],
  total: 2,
};

// Count every GET the two watched endpoints receive so we can prove the
// follow-up refetch happens after each bulk action.
let listGetCount = 0;
let countGetCount = 0;
// Every bulk write the component fires is recorded here.
type WriteCall = { url: string; method: string };
let resolveAllCalls: WriteCall[] = [];
let deleteAllCalls: WriteCall[] = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown, init?: { method?: string; body?: unknown }): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];
  const method = (init?.method ?? "GET").toUpperCase();

  // POST /api/admin/error-logs/resolve-all
  if (pathname === "/api/admin/error-logs/resolve-all" && method === "POST") {
    resolveAllCalls.push({ url: pathname, method });
    return jsonResponse({ resolved: 2 });
  }

  // DELETE /api/admin/error-logs (clear all) — must be checked before the GET.
  if (pathname === "/api/admin/error-logs" && method === "DELETE") {
    deleteAllCalls.push({ url: pathname, method });
    return jsonResponse({ deleted: 2 });
  }

  if (pathname === "/api/admin/error-logs" && method === "GET") {
    listGetCount++;
    return jsonResponse(ERROR_LOGS);
  }
  if (pathname === "/api/admin/error-logs/unresolved-count" && method === "GET") {
    countGetCount++;
    return jsonResponse({ count: ERROR_LOGS.total });
  }

  if (pathname === "/api/auth/me") return jsonResponse(ADMIN_USER);
  if (pathname === "/api/admin/my-permissions") return jsonResponse({ permissions: [] });
  if (pathname === "/api/content-notifications/counts") return jsonResponse({});
  if (pathname === "/api/admin/chat/unread-count") return jsonResponse({ count: 0 });

  // Unknown endpoints: succeed quietly so background fetches don't error.
  return jsonResponse({});
};
w.fetch = g.fetch;

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate. admin-portal.tsx + auth.tsx rely on Vite's
// automatic JSX runtime and resolve `React` from global scope under tsx.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn, queryClient: appQueryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const { useQuery } = await import("@tanstack/react-query");
const AdminPortal = (await import("../client/src/pages/admin-portal")).default;

// ErrorLogsTab's bulk mutations' onSuccess invalidate the *module singleton*
// queryClient imported from @/lib/queryClient — not whatever client a test wires
// into its QueryClientProvider. In the real app they're the same object; here we
// keep a fast, self-cleaning test client as the provider (the production
// singleton's 5-min gcTime + refetch intervals hang the test runner) and bridge
// the singleton's invalidateQueries onto the active test client. So a real bulk
// action → singleton.invalidateQueries(<key>) → the *observed* client refetches
// that key, producing an actual GET. Drop either invalidation in onSuccess and
// the matching refetch never fires — exactly the regression this test guards.
let activeTestClient: InstanceType<typeof QueryClient> | null = null;
const realInvalidate = appQueryClient.invalidateQueries.bind(appQueryClient);
appQueryClient.invalidateQueries = ((filters?: unknown, options?: unknown) => {
  if (activeTestClient) {
    void (activeTestClient.invalidateQueries as (f?: unknown, o?: unknown) => Promise<void>)(filters, options);
  }
  return realInvalidate(filters as never, options as never);
}) as typeof appQueryClient.invalidateQueries;

after(() => {
  appQueryClient.invalidateQueries = realInvalidate as typeof appQueryClient.invalidateQueries;
});

// A tiny stand-in for AppSidebar's unresolved-count badge: it subscribes to the
// exact query key the bulk mutations invalidate, using the client's default
// queryFn (which GETs /api/admin/error-logs/unresolved-count). Rendering it
// makes that query active, so an invalidation forces a real refetch.
const CounterProbe: React.FC = () => {
  const { data } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/error-logs/unresolved-count"],
  });
  return React.createElement(
    "div",
    { "data-testid": "probe-unresolved-count" },
    String(data?.count ?? ""),
  );
};

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

interface MountResult {
  container: HTMLElement;
  cleanup: () => void;
}

async function mountErrorLogsTab(): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  // Route the app singleton's invalidations onto this client for the test's life.
  activeTestClient = queryClient;
  // Seed the auth cache so the very first render already knows the identity.
  queryClient.setQueryData(["/api/auth/me"], ADMIN_USER);

  const { hook } = memoryLocation({ path: "/admin" });
  // Land straight on the Error Log tab (a master_admin would otherwise auto-land
  // on the Overview dashboard). The admin portal reads its deep-link params via
  // wouter's useSearch, which memoryLocation doesn't model — feed it directly.
  const searchHook = () => "tab=error-log";

  // Mount the CounterProbe (subscriber of the unresolved-count query) alongside
  // AdminPortal under one QueryClient/Router/Auth so the counter query is active
  // and the mutation's invalidation of it produces an observable refetch.
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
          React.createElement(CounterProbe),
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
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      activeTestClient = null;
      resolveAllCalls = [];
      deleteAllCalls = [];
      listGetCount = 0;
      countGetCount = 0;
    },
  };
}

function findByTestId(id: string): HTMLElement | null {
  return window.document.body.querySelector(`[data-testid="${id}"]`);
}

async function clickTestId(id: string): Promise<void> {
  const el = findByTestId(id);
  assert.ok(el, `element ${id} is present to click`);
  await act(async () => {
    el!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flush();
}

// --- "Resolve all" refetches BOTH the list and the unresolved counter -------

test("Resolve all refetches the error-log list and the unresolved-count badge", async () => {
  const h = await mountErrorLogsTab();
  try {
    // Both watched queries fetched at least once on mount.
    assert.ok(findByTestId("button-resolve-all-errors"), "Resolve all button renders");
    assert.ok(listGetCount >= 1, "the row list fetched on mount");
    assert.ok(countGetCount >= 1, "the unresolved-count fetched on mount");

    const listBefore = listGetCount;
    const countBefore = countGetCount;

    // Open the confirm dialog, then confirm.
    await clickTestId("button-resolve-all-errors");
    await clickTestId("button-resolve-all-errors-confirm");

    // The bulk POST fired...
    assert.equal(resolveAllCalls.length, 1, "exactly one resolve-all POST fires");
    assert.equal(resolveAllCalls[0].url, "/api/admin/error-logs/resolve-all", "POST hits resolve-all");

    // ...and its onSuccess invalidated BOTH keys, forcing a fresh GET on each.
    assert.ok(
      listGetCount > listBefore,
      `the error-log list re-fetched after Resolve all (was ${listBefore}, now ${listGetCount})`,
    );
    assert.ok(
      countGetCount > countBefore,
      `the unresolved-count re-fetched after Resolve all (was ${countBefore}, now ${countGetCount})`,
    );
  } finally {
    h.cleanup();
  }
});

// --- "Clear all" refetches BOTH the list and the unresolved counter ---------

test("Clear all refetches the error-log list and the unresolved-count badge", async () => {
  const h = await mountErrorLogsTab();
  try {
    // Both watched queries fetched at least once on mount.
    assert.ok(findByTestId("button-clear-all-errors"), "Clear all button renders");
    assert.ok(listGetCount >= 1, "the row list fetched on mount");
    assert.ok(countGetCount >= 1, "the unresolved-count fetched on mount");

    const listBefore = listGetCount;
    const countBefore = countGetCount;

    // Open the confirm dialog, then confirm.
    await clickTestId("button-clear-all-errors");
    await clickTestId("button-clear-all-errors-confirm");

    // The bulk DELETE fired...
    assert.equal(deleteAllCalls.length, 1, "exactly one clear-all DELETE fires");
    assert.equal(deleteAllCalls[0].url, "/api/admin/error-logs", "DELETE hits the error-log collection");

    // ...and its onSuccess invalidated BOTH keys, forcing a fresh GET on each.
    assert.ok(
      listGetCount > listBefore,
      `the error-log list re-fetched after Clear all (was ${listBefore}, now ${listGetCount})`,
    );
    assert.ok(
      countGetCount > countBefore,
      `the unresolved-count re-fetched after Clear all (was ${countBefore}, now ${countGetCount})`,
    );
  } finally {
    h.cleanup();
  }
});
