import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the ErrorLogsTab per-row resolve/unresolve toggle
// (admin-portal.tsx). The resolve endpoint + its master-admin gate are unit
// tested on the server; this locks in the *client-side* guarantee that the
// per-row toggle:
//   (1) fires exactly one PATCH to /api/admin/error-logs/<that id>/resolve
//       with { resolved: true } and touches NO other row,
//   (2) sends { resolved: false } from the Reopen control on a resolved row.
// Without this a regression could mark the wrong row resolved, silently no-op,
// or wipe the other rows.
//
// Mirrors the jsdom conventions in test/error-logs-clear-all-confirm.test.ts
// (global React, gcTime:0 teardown, wouter memoryLocation routing).
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

// Three unresolved error-log rows so we can prove the toggle only touches one.
const ERROR_LOGS = {
  logs: [
    { id: "err-1", severity: "error", source: "route", summary: "Boom one", details: null, userId: null, referenceType: null, referenceId: null, resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() },
    { id: "err-2", severity: "warn", source: "email", summary: "Boom two", details: null, userId: null, referenceType: null, referenceId: null, resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() },
    { id: "err-3", severity: "fatal", source: "job", summary: "Boom three", details: null, userId: null, referenceType: null, referenceId: null, resolvedAt: null, resolvedBy: null, createdAt: new Date().toISOString() },
  ],
  total: 3,
};

// A single already-resolved row, used to exercise the Reopen (resolved:false) path.
const RESOLVED_ONLY = {
  logs: [
    { id: "err-9", severity: "error", source: "route", summary: "Already fixed", details: "some details", userId: null, referenceType: null, referenceId: null, resolvedAt: new Date().toISOString(), resolvedBy: "admin-1", createdAt: new Date().toISOString(), resolvedByName: "Avery Admin" },
  ],
  total: 1,
};

// Which dataset the /api/admin/error-logs GET should serve. The Reopen test
// flips this to RESOLVED_ONLY before mounting.
let logsPayload: typeof ERROR_LOGS | typeof RESOLVED_ONLY = ERROR_LOGS;

// Every resolve PATCH the component fires is recorded here.
type PatchCall = { url: string; body: unknown };
let patchCalls: PatchCall[] = [];

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

  // PATCH /api/admin/error-logs/<id>/resolve
  const resolveMatch = pathname.match(/^\/api\/admin\/error-logs\/([^/]+)\/resolve$/);
  if (resolveMatch && method === "PATCH") {
    let body: unknown = null;
    if (typeof init?.body === "string") {
      try { body = JSON.parse(init.body); } catch { body = init.body; }
    }
    patchCalls.push({ url: pathname, body });
    return jsonResponse({ ok: true });
  }

  if (pathname === "/api/admin/error-logs") return jsonResponse(logsPayload);
  if (pathname === "/api/admin/error-logs/unresolved-count") return jsonResponse({ count: logsPayload.total });

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
  // Seed the auth cache so the very first render already knows the identity.
  queryClient.setQueryData(["/api/auth/me"], ADMIN_USER);

  const { hook } = memoryLocation({ path: "/admin" });
  // Land straight on the Error Log tab (a master_admin would otherwise auto-land
  // on the Overview dashboard). The admin portal reads its deep-link params via
  // wouter's useSearch, which memoryLocation doesn't model — feed it directly.
  const searchHook = () => "tab=error-log";

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
            searchHook,
            children: React.createElement(Route, { path: "/admin", component: AdminPortal }),
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
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      patchCalls = [];
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

// --- (1) Resolving one row PATCHes only that row with { resolved: true } ----

test("clicking a row's Resolve fires exactly one PATCH to that row with resolved:true", async () => {
  logsPayload = ERROR_LOGS;
  const h = await mountErrorLogsTab();
  try {
    // All three rows render with their own resolve toggle.
    assert.ok(findByTestId("button-resolve-error-err-1"), "row 1 resolve toggle renders");
    assert.ok(findByTestId("button-resolve-error-err-2"), "row 2 resolve toggle renders");
    assert.ok(findByTestId("button-resolve-error-err-3"), "row 3 resolve toggle renders");
    assert.equal(patchCalls.length, 0, "no PATCH before any toggle is clicked");

    await clickTestId("button-resolve-error-err-2");

    assert.equal(patchCalls.length, 1, "exactly one PATCH fires");
    assert.equal(
      patchCalls[0].url,
      "/api/admin/error-logs/err-2/resolve",
      "the PATCH targets ONLY the clicked row",
    );
    assert.deepEqual(
      patchCalls[0].body,
      { resolved: true },
      "the PATCH marks the row resolved",
    );
    // No other row's endpoint was hit.
    assert.ok(
      !patchCalls.some((c) => c.url.includes("err-1") || c.url.includes("err-3")),
      "no other row was touched",
    );
  } finally {
    h.cleanup();
  }
});

// --- (2) Reopen on a resolved row PATCHes it with { resolved: false } -------

test("Reopen on a resolved row fires one PATCH with resolved:false", async () => {
  logsPayload = RESOLVED_ONLY;
  const h = await mountErrorLogsTab();
  try {
    // Resolved rows show no Resolve toggle; the Reopen control lives in the
    // expanded detail, so expand the row first.
    assert.equal(findByTestId("button-resolve-error-err-9"), null, "a resolved row has no Resolve toggle");
    await clickTestId("button-expand-error-err-9");

    assert.equal(patchCalls.length, 0, "expanding fires no PATCH");
    await clickTestId("button-reopen-error-err-9");

    assert.equal(patchCalls.length, 1, "exactly one PATCH fires");
    assert.equal(
      patchCalls[0].url,
      "/api/admin/error-logs/err-9/resolve",
      "the PATCH targets the reopened row",
    );
    assert.deepEqual(
      patchCalls[0].body,
      { resolved: false },
      "Reopen unresolves the row",
    );
  } finally {
    logsPayload = ERROR_LOGS;
    h.cleanup();
  }
});
