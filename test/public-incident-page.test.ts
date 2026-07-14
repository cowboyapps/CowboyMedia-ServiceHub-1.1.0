import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the unauthenticated public incident detail page
// (client/src/pages/public-incident-page.tsx). Visitors follow links here from
// the public status page during an outage — exactly when a broken page hurts
// most. These tests lock in:
//   - happy path: title, status/severity badges, description, updates timeline
//   - a 404/missing incident renders the explicit "Incident not found" card
//   - a server (500) failure renders an explicit "Couldn't load" error state
//     with a retry affordance — NEVER a blank page, NEVER the misleading
//     "Incident not found"
//   - a network-level fetch failure lands in the same explicit error state

// --- jsdom globals + polyfills (mirrors test/public-status-page.test.ts)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/status/incidents/inc-1",
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
// wouter patches history.replaceState to fire a bare `dispatchEvent(...)` —
// it must resolve to the jsdom window's dispatcher.
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
const { Route, Router } = await import("wouter");
const { queryClient } = await import("../client/src/lib/queryClient");
const { setupComponentTestTeardown } = await import("./helpers/component-test-teardown");
const PublicIncidentPage = (await import("../client/src/pages/public-incident-page")).default;

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
const INCIDENT_ID = "inc-1";
const INCIDENT_PATH = `/api/public/incidents/${INCIDENT_ID}`;

function incident(extra: Record<string, unknown> = {}) {
  return {
    id: INCIDENT_ID,
    title: "Database connectivity issues",
    description: "<p>We are seeing elevated error rates.</p>",
    status: "investigating",
    severity: "critical",
    serviceName: "API",
    serviceCategory: null,
    createdAt: "2026-07-10T12:00:00.000Z",
    resolvedAt: null,
    durationSeconds: 3600,
    updates: [
      {
        id: "u1",
        message: "<p>We have identified the cause.</p>",
        status: "identified",
        imageUrl: null,
        createdAt: "2026-07-10T12:30:00.000Z",
      },
      {
        id: "u2",
        message: "<p>Still investigating.</p>",
        status: "investigating",
        imageUrl: null,
        createdAt: "2026-07-10T12:05:00.000Z",
      },
    ],
    ...extra,
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountIncidentPage(table: RouteTable): Promise<MountResult> {
  routes = { ...table };

  // The page reads :id from wouter's route params; drive it via the real
  // browser location (jsdom URL is /status/incidents/inc-1).
  window.history.replaceState(null, "", `/status/incidents/${INCIDENT_ID}`);

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(
        Router,
        null,
        React.createElement(Route, {
          path: "/status/incidents/:id",
          component: PublicIncidentPage,
        }),
      ),
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

test("happy path renders title, badges, description, and updates timeline", async () => {
  const c = await mountIncidentPage({
    [INCIDENT_PATH]: { status: 200, body: incident() },
  });
  try {
    const title = await waitForTestId(c.container, "text-incident-title");
    assert.match(title.textContent || "", /Database connectivity issues/);
    assert.match(findByTestId(c.container, "badge-status")!.textContent || "", /investigating/);
    assert.match(findByTestId(c.container, "badge-severity")!.textContent || "", /critical/);
    assert.match(findByTestId(c.container, "badge-service")!.textContent || "", /API/);
    assert.match(
      findByTestId(c.container, "text-incident-description")!.textContent || "",
      /elevated error rates/,
    );
    assert.ok(findByTestId(c.container, "incident-update-u1"), "first update renders");
    assert.ok(findByTestId(c.container, "incident-update-u2"), "second update renders");
    assert.match(
      findByTestId(c.container, "text-incident-update-message-u1")!.textContent || "",
      /identified the cause/,
    );
    assert.equal(findByTestId(c.container, "text-incident-not-found"), null, "no not-found state");
    assert.equal(findByTestId(c.container, "text-incident-error"), null, "no error state");
  } finally {
    c.cleanup();
  }
});

test("happy path with zero updates shows the explicit empty-timeline message", async () => {
  const c = await mountIncidentPage({
    [INCIDENT_PATH]: { status: 200, body: incident({ updates: [] }) },
  });
  try {
    await waitForTestId(c.container, "text-incident-title");
    assert.ok(findByTestId(c.container, "text-no-updates"), "empty timeline message renders");
  } finally {
    c.cleanup();
  }
});

test("404 / missing incident renders the explicit 'Incident not found' card", async () => {
  const c = await mountIncidentPage({
    [INCIDENT_PATH]: { status: 404, body: { error: "Incident not found" } },
  });
  try {
    const notFound = await waitForTestId(c.container, "text-incident-not-found");
    assert.match(notFound.textContent || "", /Incident not found/);
    assert.equal(findByTestId(c.container, "text-incident-error"), null, "404 is not-found, not an error");
    assert.equal(findByTestId(c.container, "text-incident-title"), null, "no stale incident content");
    // A back-to-status escape hatch must exist so visitors are never stranded.
    assert.ok(findByTestId(c.container, "link-back-status"), "back link renders");
    assert.notEqual(
      (c.container.textContent || "").trim(),
      "",
      "never a silent blank page",
    );
  } finally {
    c.cleanup();
  }
});

test("server (500) failure renders an explicit error state with retry — never 'Incident not found', never blank", async () => {
  const c = await mountIncidentPage({
    [INCIDENT_PATH]: { status: 500, body: { error: "boom" } },
  });
  try {
    const errorEl = await waitForTestId(c.container, "text-incident-error");
    assert.match(errorEl.textContent || "", /Couldn't load this incident/);
    assert.ok(findByTestId(c.container, "button-retry-incident"), "retry affordance renders");
    assert.ok(findByTestId(c.container, "link-error-back-status"), "back-to-status escape hatch renders");
    const text = c.container.textContent || "";
    assert.doesNotMatch(
      text,
      /Incident not found/,
      "a server failure must NEVER masquerade as a missing incident",
    );
    assert.notEqual(text.trim(), "", "never a silent blank page");
  } finally {
    c.cleanup();
  }
});

test("retry after a failure refetches and renders the incident", async () => {
  const c = await mountIncidentPage({
    [INCIDENT_PATH]: { status: 500, body: { error: "boom" } },
  });
  try {
    const retry = await waitForTestId(c.container, "button-retry-incident");
    // Server recovers; retry should now succeed.
    routes[INCIDENT_PATH] = { status: 200, body: incident() };
    await act(async () => {
      retry.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await waitForTestId(c.container, "text-incident-title");
    assert.equal(findByTestId(c.container, "text-incident-error"), null, "error state cleared");
  } finally {
    c.cleanup();
  }
});

test("network-level fetch failure also lands in the explicit error state", async () => {
  const prevFetch = g.fetch;
  const failingFetch = (async (input: unknown) => {
    const url = String(input).replace(/^https?:\/\/[^/]+/, "");
    if (url === INCIDENT_PATH) {
      throw new TypeError("network down");
    }
    return jsonResponse([]);
  }) as unknown as typeof fetch;
  g.fetch = failingFetch;
  w.fetch = failingFetch;
  const c = await mountIncidentPage({});
  try {
    await waitForTestId(c.container, "text-incident-error");
    const text = c.container.textContent || "";
    assert.doesNotMatch(text, /Incident not found/, "network failure is not a missing incident");
    assert.notEqual(text.trim(), "", "never a silent blank page");
  } finally {
    c.cleanup();
    g.fetch = prevFetch;
    w.fetch = prevFetch;
  }
});
