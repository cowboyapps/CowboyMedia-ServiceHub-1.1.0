import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Real render test for the ErrorLogsTab "Clear all" control (admin-portal.tsx).
// The Clear all endpoint + its master-admin gate are unit tested on the server;
// this locks in the *client-side* safety guarantee that the destructive DELETE
// is gated behind the confirmation dialog:
//   (1) clicking "Clear all" opens the confirm dialog and fires NO DELETE,
//   (2) confirming in the dialog fires exactly one DELETE,
//   (3) cancelling fires no DELETE.
// Without this a regression could wire the button straight to the mutation and
// silently wipe the whole error log on a single click.
//
// Mirrors the jsdom conventions in test/admin-portal-admin-gating.test.ts
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

// Two error-log rows so `total` > 0 and the "Clear all" button is enabled.
const ERROR_LOGS = {
  logs: [
    { id: "err-1", severity: "error", source: "server", message: "Boom one", createdAt: new Date().toISOString(), resolved: false, stack: null, context: null },
    { id: "err-2", severity: "warning", source: "client", message: "Boom two", createdAt: new Date().toISOString(), resolved: false, stack: null, context: null },
  ],
  total: 2,
};

// Every DELETE the component fires is recorded here so a test can assert the
// dialog gates it.
let deleteCalls: string[] = [];

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

  if (pathname === "/api/admin/error-logs" && method === "DELETE") {
    deleteCalls.push(url);
    return jsonResponse({ deleted: ERROR_LOGS.total });
  }
  if (pathname === "/api/admin/error-logs") return jsonResponse(ERROR_LOGS);
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

// Dynamic imports so the jsdom globals above are installed before React and
// the component tree evaluate. admin-portal.tsx + auth.tsx rely on Vite's
// automatic JSX runtime and resolve `React` from global scope under tsx.
const React = await import("react");
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
      deleteCalls = [];
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

// --- (1) Clicking "Clear all" only opens the dialog; no DELETE fires --------

test("clicking Clear all opens the confirm dialog and fires no DELETE", async () => {
  const h = await mountErrorLogsTab();
  try {
    const trigger = findByTestId("button-clear-all-errors");
    assert.ok(trigger, "the Clear all button renders for a master admin");
    assert.equal(deleteCalls.length, 0, "no DELETE before the button is even clicked");

    await clickTestId("button-clear-all-errors");

    // The confirm dialog is now open with both actions...
    assert.ok(findByTestId("button-clear-all-errors-confirm"), "the confirm button appears in the dialog");
    assert.ok(findByTestId("button-clear-all-errors-cancel"), "the cancel button appears in the dialog");
    // ...but nothing has been deleted yet — the click only opened the dialog.
    assert.equal(deleteCalls.length, 0, "opening the dialog must NOT fire the DELETE");
  } finally {
    h.cleanup();
  }
});

// --- (2) Confirming fires exactly one DELETE --------------------------------

test("confirming in the dialog fires the DELETE", async () => {
  const h = await mountErrorLogsTab();
  try {
    await clickTestId("button-clear-all-errors");
    assert.equal(deleteCalls.length, 0, "still no DELETE with the dialog merely open");

    await clickTestId("button-clear-all-errors-confirm");

    assert.equal(deleteCalls.length, 1, "confirming fires exactly one DELETE");
    assert.equal(
      deleteCalls[0].split("?")[0],
      "/api/admin/error-logs",
      "the DELETE targets the error-logs endpoint",
    );
  } finally {
    h.cleanup();
  }
});

// --- (3) Cancelling fires no DELETE -----------------------------------------

test("cancelling the dialog fires no DELETE", async () => {
  const h = await mountErrorLogsTab();
  try {
    await clickTestId("button-clear-all-errors");
    await clickTestId("button-clear-all-errors-cancel");

    assert.equal(deleteCalls.length, 0, "cancelling must NOT fire the DELETE");
  } finally {
    h.cleanup();
  }
});
