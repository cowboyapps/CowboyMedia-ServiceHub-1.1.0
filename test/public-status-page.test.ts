import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the unauthenticated public status page
// (client/src/pages/public-status-page.tsx). The overall banner is computed
// from /api/public/status and must NEVER show the green "All systems
// operational" when the query fails — a regression there would tell visitors
// everything is fine during an outage. These tests lock in:
//   - ok / warn / bad overall banner variants from public service statuses
//   - maintenance counts as degraded (warn), never all-clear
//   - a failed /api/public/status query renders an explicit error state
//     (never a false all-clear, never "No services configured" /
//     "No incidents in progress")

// --- jsdom globals + polyfills (mirrors test/dashboard-status-hero.test.ts)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/status",
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
g.addEventListener = window.addEventListener.bind(window);
g.removeEventListener = window.removeEventListener.bind(window);
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

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- Route-driven fetch stub. Each test declares per-URL responses; anything
// not declared resolves to an empty 200 array so background refetches are inert.
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
  const path = url.replace(/^https?:\/\/[^/]+/, "");
  const hit = routes[path];
  if (hit) return jsonResponse(hit.body, hit.status);
  return jsonResponse([]);
}) as unknown as typeof fetch;
g.fetch = fetchStub;
w.fetch = fetchStub;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { setupComponentTestTeardown } = await import("./helpers/component-test-teardown");
const PublicStatusPage = (await import("../client/src/pages/public-status-page")).default;

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

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

// A failed query goes through one retry (default retryDelay ~1s) before it
// settles into isError, so error-state assertions must wait it out.
async function waitForTestId(root: ParentNode, id: string, timeoutMs = 8000): Promise<Element> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = findByTestId(root, id);
    if (el) return el;
    if (Date.now() > deadline) {
      throw new Error(`timed out waiting for [data-testid="${id}"]`);
    }
    await act(async () => {
      await sleep(100);
    });
  }
}

// --- Fixtures
function service(id: string, status: string, extra: Record<string, unknown> = {}) {
  return { id, name: `Service ${id}`, status, ...extra };
}

function statusBody(services: unknown[], alerts: unknown[] = [], updates: unknown[] = []) {
  return { services, alerts, updates };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountStatusPage(table: RouteTable): Promise<MountResult> {
  routes = {
    "/api/public/status": { status: 200, body: statusBody([]) },
    ...table,
  };

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(PublicStatusPage),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      routes = {};
    },
  };
}

test("green 'All systems operational' banner when every service is operational", async () => {
  const c = await mountStatusPage({
    "/api/public/status": {
      status: 200,
      body: statusBody([service("s1", "operational"), service("s2", "operational")]),
    },
  });
  try {
    const banner = findByTestId(c.container, "banner-overall-ok");
    assert.ok(banner, "ok banner renders");
    assert.match(
      findByTestId(c.container, "text-banner-title")!.textContent || "",
      /All systems operational/,
    );
    assert.equal(findByTestId(c.container, "banner-overall-warn"), null);
    assert.equal(findByTestId(c.container, "banner-overall-bad"), null);
    assert.equal(findByTestId(c.container, "banner-overall-error"), null, "no error state");
    assert.ok(findByTestId(c.container, "row-service-s1"), "service rows render");
  } finally {
    c.cleanup();
  }
});

test("amber 'Some systems degraded' banner when a service is degraded", async () => {
  const c = await mountStatusPage({
    "/api/public/status": {
      status: 200,
      body: statusBody([service("s1", "degraded"), service("s2", "operational")]),
    },
  });
  try {
    const banner = findByTestId(c.container, "banner-overall-warn");
    assert.ok(banner, "warn banner renders");
    const title = findByTestId(c.container, "text-banner-title")!.textContent || "";
    assert.match(title, /Some systems degraded/);
    assert.doesNotMatch(title, /All systems operational/);
    assert.equal(findByTestId(c.container, "banner-overall-ok"), null, "no all-clear banner");
  } finally {
    c.cleanup();
  }
});

test("maintenance counts as degraded — never the green all-clear", async () => {
  const c = await mountStatusPage({
    "/api/public/status": {
      status: 200,
      body: statusBody([service("s1", "maintenance"), service("s2", "operational")]),
    },
  });
  try {
    assert.ok(findByTestId(c.container, "banner-overall-warn"), "warn banner renders");
    assert.equal(findByTestId(c.container, "banner-overall-ok"), null, "no all-clear banner");
    assert.doesNotMatch(
      c.container.textContent || "",
      /All systems operational/,
    );
  } finally {
    c.cleanup();
  }
});

test("red 'Major outage' banner when any service reports outage — outage wins over degraded", async () => {
  const c = await mountStatusPage({
    "/api/public/status": {
      status: 200,
      body: statusBody([
        service("s1", "outage"),
        service("s2", "degraded"),
        service("s3", "operational"),
      ]),
    },
  });
  try {
    const banner = findByTestId(c.container, "banner-overall-bad");
    assert.ok(banner, "bad banner renders");
    const title = findByTestId(c.container, "text-banner-title")!.textContent || "";
    assert.match(title, /Major outage/);
    assert.equal(findByTestId(c.container, "banner-overall-warn"), null, "outage outranks degraded");
    assert.equal(findByTestId(c.container, "banner-overall-ok"), null);
  } finally {
    c.cleanup();
  }
});

test("current incidents list shows unresolved alerts, not the empty state", async () => {
  const c = await mountStatusPage({
    "/api/public/status": {
      status: 200,
      body: statusBody(
        [service("s1", "outage")],
        [
          {
            id: "a1",
            title: "Big incident",
            status: "active",
            severity: "critical",
            serviceName: "Service s1",
            createdAt: new Date().toISOString(),
            resolvedAt: null,
            lastUpdateAt: null,
          },
        ],
      ),
    },
  });
  try {
    assert.ok(findByTestId(c.container, "item-incident-a1"), "incident row renders");
    assert.equal(
      findByTestId(c.container, "text-no-current-incidents"),
      null,
      "no 'No incidents in progress' while an incident is active",
    );
    assert.equal(
      findByTestId(c.container, "link-incident-a1")!.getAttribute("href"),
      "/status/incidents/a1",
      "incident links to its public detail page",
    );
  } finally {
    c.cleanup();
  }
});

test("status query failure shows the error banner — never a false all-clear", async () => {
  const c = await mountStatusPage({
    "/api/public/status": { status: 500, body: { error: "boom" } },
  });
  try {
    await waitForTestId(c.container, "banner-overall-error");
    assert.equal(findByTestId(c.container, "banner-overall-ok"), null, "no green banner");
    assert.equal(findByTestId(c.container, "banner-overall-warn"), null);
    assert.equal(findByTestId(c.container, "banner-overall-bad"), null);
    const text = c.container.textContent || "";
    assert.doesNotMatch(
      text,
      /All systems operational/,
      "a failed status query must NEVER show the green all-clear",
    );
    assert.doesNotMatch(
      text,
      /No services configured/,
      "failure must not masquerade as an empty services list",
    );
    assert.doesNotMatch(
      text,
      /No incidents in progress/,
      "failure must not claim there are no incidents",
    );
    assert.match(text, /Status unavailable/, "error state is explicit");
    assert.ok(findByTestId(c.container, "button-retry-status"), "retry affordance renders");
  } finally {
    c.cleanup();
  }
});

test("network-level fetch failure also lands in the error state", async () => {
  const prevFetch = g.fetch;
  const failingFetch = (async (input: unknown) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    if (url === "/api/public/status") {
      throw new TypeError("network down");
    }
    return jsonResponse([]);
  }) as unknown as typeof fetch;
  g.fetch = failingFetch;
  w.fetch = failingFetch;
  const c = await mountStatusPage({});
  try {
    await waitForTestId(c.container, "banner-overall-error");
    assert.doesNotMatch(
      c.container.textContent || "",
      /All systems operational/,
      "a network failure must NEVER show the green all-clear",
    );
  } finally {
    c.cleanup();
    g.fetch = prevFetch;
    w.fetch = prevFetch;
  }
});
