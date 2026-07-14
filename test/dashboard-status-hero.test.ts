import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the redesigned home dashboard's status hero
// (client/src/pages/dashboard.tsx). The colored hero banner is computed from
// /api/services + /api/alerts and must NEVER show the green "all clear" when
// either query fails — a regression there would silently tell customers
// "All services are running smoothly" during an outage. These tests lock in:
//   - green / yellow / red hero variants from service status + alert severity
//   - the non-clear hero deep-links to the FIRST active alert
//   - alerts/services query failures render the hero error state (never all-clear)
//   - tickets query failure renders an error state (never "no open tickets")
//   - NEW badges appear for unread service updates / news references

// --- jsdom globals + polyfills (mirrors test/my-services-empty-state.test.ts)
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
const { AuthProvider } = await import("../client/src/lib/auth");
const { setupComponentTestTeardown } = await import("./helpers/component-test-teardown");
const Dashboard = (await import("../client/src/pages/dashboard")).default;

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
const USER = {
  id: "user-1",
  username: "jane",
  fullName: "Jane Customer",
  email: "jane@example.com",
  role: "customer",
  subscribedServices: [],
};

function service(id: string, status: string) {
  return { id, name: `Service ${id}`, description: "", status };
}

function alert(id: string, severity: string, opts: { status?: string; serviceIds?: string[] } = {}) {
  return {
    id,
    title: `Alert ${id}`,
    message: "Something happened",
    severity,
    status: opts.status ?? "active",
    serviceIds: opts.serviceIds ?? [],
    createdAt: new Date(Date.now() - 60_000).toISOString(),
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountDashboard(table: RouteTable): Promise<MountResult> {
  routes = {
    "/api/auth/me": { status: 200, body: USER },
    "/api/services": { status: 200, body: [] },
    "/api/alerts": { status: 200, body: [] },
    "/api/news": { status: 200, body: [] },
    "/api/tickets": { status: 200, body: [] },
    "/api/service-updates": { status: 200, body: [] },
    ...table,
  };

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AuthProvider, null, React.createElement(Dashboard)),
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

test("green all-clear hero when every service is operational and no active alerts", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational"), service("s2", "operational")] },
    "/api/alerts": { status: 200, body: [alert("a-resolved", "critical", { status: "resolved" })] },
  });
  try {
    const hero = findByTestId(c.container, "hero-status");
    assert.ok(hero, "hero renders");
    assert.match(hero!.textContent || "", /All services are running smoothly/);
    assert.equal(hero!.getAttribute("href"), "/alerts", "clear hero links to alert history");
    assert.match(
      findByTestId(c.container, "text-active-alerts-count")!.textContent || "",
      /0 active alerts/,
    );
    assert.equal(findByTestId(c.container, "hero-status-error"), null, "no error state");
  } finally {
    c.cleanup();
  }
});

test("yellow issue hero for a non-critical active alert, deep-linking to the first alert", async () => {
  const first = alert("a1", "medium", { serviceIds: ["s1"] });
  const second = alert("a2", "low");
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational")] },
    "/api/alerts": { status: 200, body: [first, second] },
  });
  try {
    const hero = findByTestId(c.container, "hero-status");
    assert.ok(hero, "hero renders");
    const text = hero!.textContent || "";
    assert.match(text, /We're currently experiencing an issue/);
    assert.doesNotMatch(text, /outage/i, "issue hero must not claim an outage");
    assert.doesNotMatch(text, /All services are running smoothly/);
    assert.equal(hero!.getAttribute("href"), "/alerts/a1", "hero links to the FIRST active alert");
    assert.match(text, /Alert a1/, "hero subtitle names the first alert");
    assert.match(text, /Service s1/, "hero subtitle names the affected service");
    assert.match(
      findByTestId(c.container, "text-active-alerts-count")!.textContent || "",
      /2 active alerts/,
    );
    assert.ok(findByTestId(c.container, "link-view-all-alerts"), "view-all link for multiple alerts");
  } finally {
    c.cleanup();
  }
});

test("yellow issue hero from a degraded service even with zero active alerts", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "degraded"), service("s2", "operational")] },
    "/api/alerts": { status: 200, body: [] },
  });
  try {
    const hero = findByTestId(c.container, "hero-status");
    assert.ok(hero, "hero renders");
    const text = hero!.textContent || "";
    assert.match(text, /We're currently experiencing an issue/);
    assert.doesNotMatch(text, /All services are running smoothly/);
    assert.equal(hero!.getAttribute("href"), "/alerts", "no alert to deep-link → alerts index");
  } finally {
    c.cleanup();
  }
});

test("red outage hero when a critical alert is active", async () => {
  const critical = alert("a-crit", "critical", { serviceIds: ["s1"] });
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational")] },
    "/api/alerts": { status: 200, body: [critical] },
  });
  try {
    const hero = findByTestId(c.container, "hero-status");
    assert.ok(hero, "hero renders");
    const text = hero!.textContent || "";
    assert.match(text, /We're currently experiencing an outage/);
    assert.doesNotMatch(text, /All services are running smoothly/);
    assert.equal(hero!.getAttribute("href"), "/alerts/a-crit", "outage hero links to the alert");
  } finally {
    c.cleanup();
  }
});

test("red outage hero when a service reports outage status", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "outage")] },
    "/api/alerts": { status: 200, body: [] },
  });
  try {
    const hero = findByTestId(c.container, "hero-status");
    assert.ok(hero, "hero renders");
    assert.match(hero!.textContent || "", /We're currently experiencing an outage/);
  } finally {
    c.cleanup();
  }
});

test("alerts query failure shows the hero error state — never a false all-clear", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational")] },
    "/api/alerts": { status: 500, body: { error: "boom" } },
  });
  try {
    await waitForTestId(c.container, "hero-status-error");
    assert.equal(findByTestId(c.container, "hero-status"), null, "no status hero at all");
    assert.doesNotMatch(
      c.container.textContent || "",
      /All services are running smoothly/,
      "a failed alerts query must NEVER show the green all-clear",
    );
  } finally {
    c.cleanup();
  }
});

test("services query failure shows hero + services error states — never all-clear", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 500, body: { error: "boom" } },
    "/api/alerts": { status: 200, body: [] },
  });
  try {
    await waitForTestId(c.container, "hero-status-error");
    assert.ok(findByTestId(c.container, "error-dashboard-services"), "services section error renders");
    assert.doesNotMatch(
      c.container.textContent || "",
      /All services are running smoothly/,
      "a failed services query must NEVER show the green all-clear",
    );
    assert.doesNotMatch(
      c.container.textContent || "",
      /No services to display/,
      "failure must not masquerade as an empty services list",
    );
  } finally {
    c.cleanup();
  }
});

test("tickets query failure shows an error state — never 'no open tickets'", async () => {
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational")] },
    "/api/tickets": { status: 500, body: { error: "boom" } },
  });
  try {
    await waitForTestId(c.container, "error-dashboard-tickets");
    assert.doesNotMatch(
      c.container.textContent || "",
      /You don't have any open tickets/,
      "a failed tickets query must NEVER claim there are no open tickets",
    );
    assert.equal(findByTestId(c.container, "button-open-ticket"), null, "no empty-state CTA on failure");
  } finally {
    c.cleanup();
  }
});

test("NEW badges appear only for unread service updates and news", async () => {
  const now = new Date().toISOString();
  const c = await mountDashboard({
    "/api/services": { status: 200, body: [service("s1", "operational")] },
    "/api/service-updates": {
      status: 200,
      body: [
        { id: "u1", serviceId: "s1", title: "Update one", content: "", createdAt: now },
        { id: "u2", serviceId: "s1", title: "Update two", content: "", createdAt: now },
      ],
    },
    "/api/news": {
      status: 200,
      body: [
        { id: "n1", title: "Story one", content: "<p>Body</p>", createdAt: now },
        { id: "n2", title: "Story two", content: "<p>Body</p>", createdAt: now },
      ],
    },
    "/api/content-notifications/unread-references/service-updates": { status: 200, body: ["u1"] },
    "/api/content-notifications/unread-references/news": { status: 200, body: ["n2"] },
  });
  try {
    const unreadUpdate = findByTestId(c.container, "update-row-u1");
    const readUpdate = findByTestId(c.container, "update-row-u2");
    assert.ok(unreadUpdate && readUpdate, "both update rows render");
    assert.match(unreadUpdate!.textContent || "", /New/, "unread update shows the NEW badge");
    assert.doesNotMatch(readUpdate!.textContent || "", /New/, "read update has no badge");

    const readNews = findByTestId(c.container, "news-row-n1");
    const unreadNews = findByTestId(c.container, "news-row-n2");
    assert.ok(readNews && unreadNews, "both news rows render");
    assert.match(unreadNews!.textContent || "", /New/, "unread story shows the NEW badge");
    assert.doesNotMatch(readNews!.textContent || "", /New/, "read story has no badge");
  } finally {
    c.cleanup();
  }
});
