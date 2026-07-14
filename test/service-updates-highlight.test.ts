import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression coverage for the /service-updates?highlight=<id> deep link
// (client/src/pages/service-updates-page.tsx). Push notifications, emails and
// the dashboard rows all deep-link here; the page must (1) render the target
// row, (2) apply the temporary highlight classes, and (3) auto-clear them
// after the pulse window.

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/service-updates",
});
const { window } = dom;

type GlobalShim = Record<string, unknown>;
const g = globalThis as unknown as GlobalShim;
const w = window as unknown as GlobalShim;

g.window = window;
g.document = window.document;
g.navigator = window.navigator;
g.location = window.location;
g.history = window.history;
g.localStorage = window.localStorage;
g.addEventListener = window.addEventListener.bind(window);
g.removeEventListener = window.removeEventListener.bind(window);
g.dispatchEvent = window.dispatchEvent.bind(window);
g.getComputedStyle = window.getComputedStyle.bind(window);

const BROWSER_GLOBALS = [
  "HTMLElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLButtonElement",
  "HTMLSelectElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException", "MutationObserver",
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

// jsdom has no scrollIntoView
(window.HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};

g.IS_REACT_ACT_ENVIRONMENT = true;

interface StubResponse {
  status: number;
  body: unknown;
}
type RouteTable = Record<string, StubResponse>;
let routes: RouteTable = {};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
    clone() { return this; },
  };
}

const fetchStub = (async (input: unknown) => {
  const url = String(input);
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  const hit = routes[path];
  if (hit) return jsonResponse(hit.body, hit.status);
  return jsonResponse([]);
}) as unknown as typeof fetch;
g.fetch = fetchStub;
w.fetch = fetchStub;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { setupComponentTestTeardown } = await import("./helpers/component-test-teardown");
const { Router } = await import("wouter");
const ServiceUpdatesPage = (await import("../client/src/pages/service-updates-page")).default;

setupComponentTestTeardown({ queryClient, window });

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

const UPDATE_ID = "u-1";
const SERVICE_ID = "s-1";
const NOW = new Date().toISOString();

const baseRoutes: RouteTable = {
  "/api/auth/me": { status: 200, body: { id: "cust-1", username: "cust", fullName: "Customer", role: "customer", subscribedServices: [SERVICE_ID] } },
  "/api/services": { status: 200, body: [{ id: SERVICE_ID, name: "Email Service", status: "operational", category: "Communication" }] },
  "/api/service-updates": {
    status: 200,
    body: [
      { id: UPDATE_ID, serviceId: SERVICE_ID, title: "Maintenance done", description: "<p>All good</p>", matureContent: false, createdAt: NOW },
      { id: "u-2", serviceId: SERVICE_ID, title: "Older update", description: "<p>Older</p>", matureContent: false, createdAt: NOW },
    ],
  },
};

interface MountResult {
  container: HTMLElement;
  cleanup: () => void;
}

async function mountPage(table: RouteTable, search: string): Promise<MountResult> {
  routes = table;
  window.history.replaceState({}, "", `/service-updates${search}`);
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(
          AuthProvider,
          null,
          React.createElement(Router, null, React.createElement(ServiceUpdatesPage)),
        ),
      ),
    );
  });
  await flushFrames();
  return {
    container,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      routes = {};
    },
  };
}

test("deep link ?highlight applies the pulse classes to the target row", async () => {
  const c = await mountPage(baseRoutes, `?highlight=${UPDATE_ID}`);
  try {
    const row = c.container.querySelector(`#service-update-${UPDATE_ID}`)
      ?? c.container.querySelector(`[data-testid="row-service-update-${UPDATE_ID}"]`);
    assert.ok(row, "target row renders");
    const rowEl = row as HTMLElement;
    const holder = rowEl.className.includes("animate-pulse")
      ? rowEl
      : (rowEl.closest('[data-testid^="row-service-update-"]') as HTMLElement | null);
    assert.ok(holder, "a highlightable row container exists");
    assert.ok(
      holder!.className.includes("animate-pulse") && holder!.className.includes("ring-2"),
      `highlight classes present immediately after load (got: ${holder!.className})`,
    );
  } finally {
    c.cleanup();
  }
});

test("highlight auto-clears after the pulse window", async () => {
  const c = await mountPage(baseRoutes, `?highlight=${UPDATE_ID}`);
  try {
    await act(async () => {
      await sleep(3200);
    });
    await flushFrames();
    const row = c.container.querySelector(`[data-testid="row-service-update-${UPDATE_ID}"]`) as HTMLElement | null;
    assert.ok(row, "row still rendered");
    assert.ok(!row!.className.includes("animate-pulse"), "pulse cleared after ~3s");
  } finally {
    c.cleanup();
  }
});

test("no highlight param renders rows without pulse classes", async () => {
  const c = await mountPage(baseRoutes, "");
  try {
    const row = c.container.querySelector(`[data-testid="row-service-update-${UPDATE_ID}"]`) as HTMLElement | null;
    assert.ok(row, "row rendered");
    assert.ok(!row!.className.includes("animate-pulse"), "no pulse without highlight param");
  } finally {
    c.cleanup();
  }
});
