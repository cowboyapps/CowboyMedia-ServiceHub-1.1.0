import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the ErrorLogsTab *filter controls* (admin-portal.tsx).
// The tab lets admins narrow the error log by severity, source, resolved-state,
// and a free-text search box. Each control feeds the list query key
//   ["/api/admin/error-logs", severity, source, resolved, search, page]
// and the queryFn turns those into the GET query string. Nothing else asserts
// that flipping a control actually drives a fresh fetch with the RIGHT params,
// nor that changing a filter resets back to page 1 — so a regression wiring a
// control to the wrong state (or forgetting the page reset) could silently show
// stale/wrong rows, and make "Resolve all"/"Clear all" act on a different set
// than what the admin sees.
//
// This mounts the real AdminPortal on the Error Log tab, records every list GET
// with its full query string, then:
//   (1) changes the severity select and asserts the next GET carries
//       severity=<v> (and page=1),
//   (2) changes the source select and asserts source=<v>,
//   (3) changes the resolved select to "All" and asserts the resolved param is
//       DROPPED (resolved === "all" omits the param),
//   (4) types in the search box + clicks search and asserts search=<term>,
//   (5) pages to page 2, then changes a filter and asserts the next GET resets
//       to page=1.
//
// Mirrors the jsdom conventions in test/error-logs-bulk-refresh.test.ts
// (global React, gcTime:0 teardown, wouter memoryLocation routing) and the
// Radix Select driving in test/error-logs-resolve-all-sync.test.ts.
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

// --- Fixtures + a fetch stub that records every list GET's query string -----
const ADMIN_USER = { id: "admin-1", role: "master_admin", fullName: "Avery Admin", username: "avery", email: "avery@example.com" };

function makeRow(id: string): Record<string, unknown> {
  return {
    id,
    severity: "error",
    source: "route",
    summary: `Boom ${id}`,
    details: null,
    userId: null,
    referenceType: null,
    referenceId: null,
    resolvedAt: null,
    resolvedBy: null,
    createdAt: new Date().toISOString(),
    userName: null,
    resolvedByName: null,
  };
}

// total = 60 with a page size of 30 → 2 pages, so the Next button is enabled and
// we can prove a filter change resets page 2 back to page 1.
const ERROR_LOGS = { logs: [makeRow("err-1"), makeRow("err-2")], total: 60 };

// Every GET to the list endpoint, captured with its full query string.
let listGetUrls: string[] = [];

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

  if (pathname === "/api/admin/error-logs" && method === "GET") {
    listGetUrls.push(url);
    return jsonResponse(ERROR_LOGS);
  }
  if (pathname === "/api/admin/error-logs/unresolved-count") return jsonResponse({ count: ERROR_LOGS.total });

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
  listGetUrls = [];

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

// Drive a Radix Select the way a mouse user does: a primary-button mouse
// pointerdown opens it (Radix only opens for pointerType "mouse"), mounting the
// items in the portal; a click on the option whose visible text matches `label`
// runs its handleSelect and fires onValueChange.
async function selectOption(triggerTestId: string, label: string): Promise<void> {
  const trigger = findByTestId(triggerTestId);
  assert.ok(trigger, `the ${triggerTestId} select trigger is present`);
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
  assert.ok(item, `the "${label}" option is present once ${triggerTestId} opens`);
  await act(async () => {
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flush();
}

// Set a controlled <input>'s value the way React's tracked native setter
// expects, then fire the input event so onChange runs.
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const proto = Object.getPrototypeOf(input) as HTMLInputElement;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc?.set?.call(input, value);
  await act(async () => {
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flush();
}

function lastListParams(): URLSearchParams {
  assert.ok(listGetUrls.length > 0, "at least one list GET has fired");
  const url = listGetUrls[listGetUrls.length - 1];
  return new URLSearchParams(url.split("?")[1] ?? "");
}

// --- Each filter control drives a fresh list fetch with the right params -----

test("changing severity/source/resolved and searching re-fetches the list with the matching query params", async () => {
  const h = await mountErrorLogsTab();
  try {
    // On mount the tab fetches with the default filters: resolved defaults to
    // "false" (Unresolved) and page 1. severity/source/search start empty so
    // they're omitted from the query string entirely.
    assert.ok(findByTestId("select-error-severity"), "the severity select renders");
    const initial = lastListParams();
    assert.equal(initial.get("resolved"), "false", "the default view fetches unresolved errors");
    assert.equal(initial.get("page"), "1", "the default view fetches page 1");
    assert.equal(initial.get("severity"), null, "no severity filter is set by default");
    assert.equal(initial.get("source"), null, "no source filter is set by default");
    assert.equal(initial.get("search"), null, "no search term is set by default");

    // (1) Severity → a fresh GET carrying severity=error (and still page 1).
    let before = listGetUrls.length;
    await selectOption("select-error-severity", "error");
    assert.ok(listGetUrls.length > before, "changing severity triggers a new list fetch");
    let params = lastListParams();
    assert.equal(params.get("severity"), "error", "the severity filter is applied to the query");
    assert.equal(params.get("page"), "1", "the severity change fetches from page 1");

    // (2) Source → a fresh GET carrying source=route (severity still applied).
    before = listGetUrls.length;
    await selectOption("select-error-source", "route");
    assert.ok(listGetUrls.length > before, "changing source triggers a new list fetch");
    params = lastListParams();
    assert.equal(params.get("source"), "route", "the source filter is applied to the query");
    assert.equal(params.get("severity"), "error", "the earlier severity filter is preserved");
    assert.equal(params.get("page"), "1", "the source change fetches from page 1");

    // (3) Resolved → "All" DROPS the resolved param entirely.
    before = listGetUrls.length;
    await selectOption("select-error-resolved", "All");
    assert.ok(listGetUrls.length > before, "changing the resolved filter triggers a new list fetch");
    params = lastListParams();
    assert.equal(params.get("resolved"), null, "the 'All' resolved view omits the resolved param");

    // (4) Search box → typing + clicking search carries search=<term>.
    before = listGetUrls.length;
    const searchInput = findByTestId("input-error-search") as HTMLInputElement | null;
    assert.ok(searchInput, "the search input renders");
    await typeInto(searchInput!, "timeout");
    // Typing alone must NOT fetch — search is committed by the button/Enter.
    assert.equal(listGetUrls.length, before, "typing in the search box does not fetch until submitted");
    await clickTestId("button-error-search");
    assert.ok(listGetUrls.length > before, "submitting the search triggers a new list fetch");
    params = lastListParams();
    assert.equal(params.get("search"), "timeout", "the committed search term is applied to the query");
    assert.equal(params.get("page"), "1", "committing a search fetches from page 1");
  } finally {
    h.cleanup();
  }
});

// --- Changing a filter resets pagination back to page 1 ---------------------

test("changing a filter resets pagination to page 1", async () => {
  const h = await mountErrorLogsTab();
  try {
    // total=60 with 30/page → 2 pages, so Next is enabled. Advance to page 2.
    const before = listGetUrls.length;
    await clickTestId("button-error-next");
    assert.ok(listGetUrls.length > before, "paging forward triggers a new list fetch");
    assert.equal(lastListParams().get("page"), "2", "the Next button fetches page 2");

    // Now change a filter — the page must snap back to 1 so the admin isn't left
    // looking at a page that no longer exists for the narrowed result set.
    const beforeFilter = listGetUrls.length;
    await selectOption("select-error-severity", "warn");
    assert.ok(listGetUrls.length > beforeFilter, "changing a filter while on page 2 triggers a new fetch");
    const params = lastListParams();
    assert.equal(params.get("severity"), "warn", "the new severity filter is applied");
    assert.equal(params.get("page"), "1", "changing a filter resets pagination back to page 1");
  } finally {
    h.cleanup();
  }
});
