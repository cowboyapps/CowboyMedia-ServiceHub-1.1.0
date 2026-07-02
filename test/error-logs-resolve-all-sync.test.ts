import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the ErrorLogsTab "Resolve all" control (admin-portal.tsx).
// The server-side bulk-resolve storage method is unit tested elsewhere; this
// locks in the *client-side* UI logic that has no other coverage:
//   (1) the button is DISABLED when the list is empty (total === 0),
//   (2) it is DISABLED when the resolved filter is set to "Resolved" (there is
//       nothing left to resolve in that view), even though rows are present,
//   (3) it is ENABLED in the default "Unresolved" view with entries present,
//   (4) the success path invalidates BOTH the error-logs list query and the
//       unresolved-count badge query, so the on-screen list + count refresh.
// Without this a regression could enable the button in the wrong view or forget
// to refresh the list after a bulk resolve, leaving stale rows on screen.
//
// Mirrors the jsdom conventions in test/error-logs-clear-all-confirm.test.ts
// (global React, gcTime:0 teardown, wouter memoryLocation routing) and the
// Radix Select driving in test/store-catalogue-sort.test.ts.
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

function makeRow(id: string, resolvedAt: string | null): Record<string, unknown> {
  return {
    id,
    severity: "error",
    source: "push",
    summary: `Boom ${id}`,
    details: null,
    userId: null,
    referenceType: null,
    referenceId: null,
    resolvedAt,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    userName: null,
    resolvedByName: null,
  };
}

// Two error-log rows so `total` > 0 and the button is enabled in the default
// (Unresolved) view.
const ERROR_LOGS_WITH_ROWS = { logs: [makeRow("err-1", null), makeRow("err-2", null)], total: 2 };
const ERROR_LOGS_EMPTY = { logs: [], total: 0 };

// Swapped per mount so the same stub can serve a populated or an empty list.
let errorLogsResponse: { logs: unknown[]; total: number } = ERROR_LOGS_WITH_ROWS;
// Every POST to the resolve-all endpoint is recorded here.
let resolveAllCalls: string[] = [];

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown, init?: { method?: string }): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];
  const method = (init?.method ?? "GET").toUpperCase();

  if (pathname === "/api/admin/error-logs/resolve-all" && method === "POST") {
    resolveAllCalls.push(url);
    return jsonResponse({ resolved: errorLogsResponse.total });
  }
  if (pathname === "/api/admin/error-logs/unresolved-count") return jsonResponse({ count: errorLogsResponse.total });
  if (pathname === "/api/admin/error-logs") return jsonResponse(errorLogsResponse);

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

// Dynamic imports so the jsdom globals above are installed before React and the
// component tree evaluate. admin-portal.tsx + auth.tsx rely on Vite's automatic
// JSX runtime and resolve `React` from global scope under tsx.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
// The component invalidates the *singleton* queryClient (imported in
// admin-portal.tsx), NOT the provider client the queries observe. Spy on the
// singleton to assert the success path invalidates the right query keys.
const { getQueryFn, queryClient: appQueryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { Router, Route } = await import("wouter");
const { memoryLocation } = await import("wouter/memory-location");
const AdminPortal = (await import("../client/src/pages/admin-portal")).default;

const realInvalidate = appQueryClient.invalidateQueries.bind(appQueryClient);
let invalidatedKeys: unknown[][] = [];
appQueryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
  if (filters?.queryKey) invalidatedKeys.push(filters.queryKey);
  return Promise.resolve();
}) as typeof appQueryClient.invalidateQueries;
after(() => {
  appQueryClient.invalidateQueries = realInvalidate;
});

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

async function mountErrorLogsTab(response: { logs: unknown[]; total: number }): Promise<MountResult> {
  errorLogsResponse = response;
  resolveAllCalls = [];
  invalidatedKeys = [];

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { queryFn: getQueryFn({ on401: "returnNull" }), retry: false, refetchInterval: false, refetchOnWindowFocus: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  queryClient.setQueryData(["/api/auth/me"], ADMIN_USER);

  const { hook } = memoryLocation({ path: "/admin" });
  // Land straight on the Error Log tab; the admin portal reads its deep-link
  // params via wouter's useSearch, which memoryLocation doesn't model.
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

// Drive the resolved-filter Radix Select the way a mouse user does: a
// primary-button mouse pointerdown opens it (Radix only opens for pointerType
// "mouse"), mounting the items in the portal; a click on the option with the
// given label runs its handleSelect and fires onValueChange. The resolved-filter
// SelectItems carry no data-testid, so match the option by its visible text.
async function setResolvedFilter(label: string): Promise<void> {
  const trigger = findByTestId("select-error-resolved");
  assert.ok(trigger, "the resolved-filter select trigger is present");
  await act(async () => {
    trigger!.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
  await flush();

  const options = Array.from(window.document.body.querySelectorAll('[role="option"]'));
  const item = options.find((o) => o.textContent?.trim() === label) as HTMLElement | undefined;
  assert.ok(item, `the "${label}" option is present once the menu opens`);
  await act(async () => {
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

// --- (1) Empty list => the button is disabled -------------------------------

test("Resolve all is disabled when the error list is empty", async () => {
  const h = await mountErrorLogsTab(ERROR_LOGS_EMPTY);
  try {
    const btn = findByTestId("button-resolve-all-errors") as HTMLButtonElement | null;
    assert.ok(btn, "the Resolve all button renders");
    assert.equal(btn!.disabled, true, "an empty list leaves nothing to resolve, so the button is disabled");
  } finally {
    h.cleanup();
  }
});

// --- (2) Default (Unresolved) view with rows => enabled ---------------------

test("Resolve all is enabled in the Unresolved view with entries present", async () => {
  const h = await mountErrorLogsTab(ERROR_LOGS_WITH_ROWS);
  try {
    const btn = findByTestId("button-resolve-all-errors") as HTMLButtonElement | null;
    assert.ok(btn, "the Resolve all button renders");
    assert.equal(btn!.disabled, false, "with unresolved entries present the button is enabled");
  } finally {
    h.cleanup();
  }
});

// --- (3) Resolved filter => disabled even though rows are present ------------

test("Resolve all is disabled when the resolved filter is Resolved", async () => {
  const h = await mountErrorLogsTab(ERROR_LOGS_WITH_ROWS);
  try {
    const btn = findByTestId("button-resolve-all-errors") as HTMLButtonElement | null;
    assert.ok(btn, "the Resolve all button renders");
    assert.equal(btn!.disabled, false, "it starts enabled in the Unresolved view");

    await setResolvedFilter("Resolved");

    const btnAfter = findByTestId("button-resolve-all-errors") as HTMLButtonElement | null;
    assert.ok(btnAfter, "the Resolve all button still renders in the Resolved view");
    assert.equal(
      btnAfter!.disabled,
      true,
      "in the Resolved view there is nothing left to resolve, so the button is disabled even with rows present",
    );
  } finally {
    h.cleanup();
  }
});

// --- (4) Confirming resolve-all invalidates the list + count queries --------

test("confirming Resolve all fires the POST and refreshes the list + count", async () => {
  const h = await mountErrorLogsTab(ERROR_LOGS_WITH_ROWS);
  try {
    assert.equal(resolveAllCalls.length, 0, "no resolve-all POST before the button is clicked");

    // Clicking the trigger opens the confirm dialog; confirming fires the POST.
    await clickTestId("button-resolve-all-errors");
    assert.ok(findByTestId("button-resolve-all-errors-confirm"), "the confirm dialog opens");
    assert.equal(resolveAllCalls.length, 0, "opening the dialog must NOT fire the POST");

    await clickTestId("button-resolve-all-errors-confirm");

    assert.equal(resolveAllCalls.length, 1, "confirming fires exactly one resolve-all POST");
    assert.equal(
      resolveAllCalls[0].split("?")[0],
      "/api/admin/error-logs/resolve-all",
      "the POST targets the resolve-all endpoint",
    );

    // The success path must invalidate both the list and the unresolved-count
    // badge so the on-screen list and count stay in sync after the bulk resolve.
    const keys = invalidatedKeys.map((k) => JSON.stringify(k));
    assert.ok(
      keys.includes(JSON.stringify(["/api/admin/error-logs"])),
      "the error-logs list query is invalidated so the list refreshes",
    );
    assert.ok(
      keys.includes(JSON.stringify(["/api/admin/error-logs/unresolved-count"])),
      "the unresolved-count badge query is invalidated so the count refreshes",
    );
  } finally {
    h.cleanup();
  }
});
