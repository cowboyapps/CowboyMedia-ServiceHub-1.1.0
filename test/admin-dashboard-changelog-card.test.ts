import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React render coverage for the admin dashboard's "Changelog draft" card
// (client/src/pages/admin-dashboard.tsx). The card's selection logic was
// changed from the old per-version "draft" lookup to: prefer the open
// rolling draft (status "collecting"), else fall back to the CURRENT
// APP_VERSION's "awaiting_publish" entry, else render an empty state. This
// is how a master admin watches agent-appended bullets pile up, so a future
// rename of those status strings must not silently break the count or label.
//
// These tests prime the /api/admin/changelog query cache with each scenario
// and assert the rendered bullet count, status label, and "collecting for"
// wording, plus that "collecting" wins over "awaiting_publish".

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/admin?tab=overview",
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

// recharts measures via getBoundingClientRect; jsdom returns 0s. A non-zero
// stub lets the chart render without throwing on a zero-area layout.
const rectStub = () => ({
  width: 600, height: 200, top: 0, left: 0, right: 600, bottom: 200, x: 0, y: 0,
  toJSON() { return this; },
}) as DOMRect;
(w.HTMLElement as typeof HTMLElement).prototype.getBoundingClientRect = rectStub;
(w.Element as typeof Element).prototype.getBoundingClientRect = rectStub;

g.IS_REACT_ACT_ENVIRONMENT = true;

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
g.fetch = (async () => jsonResponse({})) as unknown as typeof fetch;
w.fetch = g.fetch;

// WebSocket is opened by the dashboard's live-refresh hook; a no-op stub
// keeps it from trying a real connection in the test environment.
class WebSocketStub {
  static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
  readyState = 1;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  addEventListener(): void {}
  removeEventListener(): void {}
  send(): void {}
  close(): void {}
}
g.WebSocket = WebSocketStub as unknown as typeof WebSocket;
w.WebSocket = g.WebSocket;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { APP_VERSION } = await import("@shared/version");
const AdminDashboard = (await import("../client/src/pages/admin-dashboard")).default;

after(() => {
  try {
    queryClient.clear();
    window.close();
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

// Minimal-but-complete dashboard payload so the page renders past its
// loading/error guards into the full card grid (where the changelog card
// lives). Only the changelog card content is asserted on.
const DASHBOARD_METRICS = {
  generatedAt: new Date().toISOString(),
  usersOnline: 3,
  tickets: {
    open: 0, awaitingCustomer: 0, awaitingAdmin: 0,
    openedToday: 0, resolvedToday: 0, avgFirstResponseMinutes7d: null,
    series14d: [],
  },
  services: { total: 0, operational: 0, degraded: 0, down: 0, activeAlerts: 0, recentAlerts: [] },
  notifications: { pushSent24h: 0, pushFailed24h: 0, emailSent24h: 0, pushSubscriptionsTotal: 0, pushSubscriptionsThisWeek: 0 },
  knowledgeBase: { total: 0, published: 0, topViewed: [], topZeroResultSearches: [] },
  community: { messages24h: 0, activeUsers7d: 0, bannedUsers: 0 },
  users: { total: 0, customers: 0, admins: 0, signupsToday: 0, signupsThisWeek: 0 },
};

type ChangelogRow = {
  version: string;
  status: "collecting" | "awaiting_publish" | "published" | "draft";
  bodyHtml: string;
  updatedAt: string;
};

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountWithChangelog(rows: ChangelogRow[]): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  // master_admin gates the changelog card's render entirely.
  queryClient.setQueryData(["/api/auth/me"], { id: "u1", role: "master_admin" });
  queryClient.setQueryData(["/api/admin/dashboard"], DASHBOARD_METRICS);
  queryClient.setQueryData(["/api/admin/changelog"], rows);
  // The System Health card reads these eagerly; prime them so the page
  // renders past it into the changelog card under test (an unprimed query
  // would resolve to the empty {} fetch stub and crash on `.recent.length`).
  queryClient.setQueryData(["/api/admin/health/errors"], {
    dbOk: true, dbLatencyMs: 1, count5xxLast5Min: 0, recent: [],
  });
  queryClient.setQueryData(["/api/health"], {
    ok: true, db: "ok", version: APP_VERSION, gitSha: null, uptime: 1,
  });
  queryClient.setQueryData(["/api/admin/health/missing-images"], { count: 0, items: [] });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AuthProvider, null, React.createElement(AdminDashboard)),
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
    },
  };
}

const TWO_BULLETS = "<h3>New</h3><ul><li>One</li><li>Two</li></ul>";
const THREE_BULLETS = "<h3>Fixed</h3><ul><li>A</li><li>B</li><li>C</li></ul>";

test("changelog card surfaces the rolling collecting draft's bullet count", async () => {
  const c = await mountWithChangelog([
    { version: "__rolling_draft__", status: "collecting", bodyHtml: TWO_BULLETS, updatedAt: new Date().toISOString() },
  ]);
  try {
    const card = findByTestId(c.container, "card-dashboard-changelog-draft");
    assert.ok(card, "changelog card renders for a master admin");

    const badge = findByTestId(card!, "badge-changelog-draft-count");
    assert.ok(badge, "bullet-count badge is shown when the draft has bullets");
    assert.match(badge!.textContent ?? "", /2 bullets/);

    assert.equal(findByTestId(card!, "stat-bullets-queued")?.textContent, "2");
    assert.equal(findByTestId(card!, "stat-status")?.textContent, "Collecting");
    assert.equal(findByTestId(card!, "stat-collecting-for")?.textContent, "Next release");
  } finally {
    c.cleanup();
  }
});

test("changelog card switches to Awaiting publish wording for a current-version awaiting_publish entry", async () => {
  const c = await mountWithChangelog([
    { version: APP_VERSION, status: "awaiting_publish", bodyHtml: THREE_BULLETS, updatedAt: new Date().toISOString() },
  ]);
  try {
    const card = findByTestId(c.container, "card-dashboard-changelog-draft");
    assert.ok(card, "changelog card renders");

    assert.equal(findByTestId(card!, "stat-status")?.textContent, "Awaiting publish");
    assert.equal(findByTestId(card!, "stat-bullets-queued")?.textContent, "3");
    // The "Collecting for" stat shows the stamped version, not "Next release".
    assert.equal(findByTestId(card!, "stat-collecting-for")?.textContent, `v${APP_VERSION}`);
  } finally {
    c.cleanup();
  }
});

test("changelog card prefers the rolling collecting draft over an awaiting_publish entry", async () => {
  const c = await mountWithChangelog([
    { version: APP_VERSION, status: "awaiting_publish", bodyHtml: THREE_BULLETS, updatedAt: new Date().toISOString() },
    { version: "__rolling_draft__", status: "collecting", bodyHtml: TWO_BULLETS, updatedAt: new Date().toISOString() },
  ]);
  try {
    const card = findByTestId(c.container, "card-dashboard-changelog-draft");
    assert.ok(card);
    // Collecting wins: status + count reflect the rolling draft (2), not the
    // awaiting_publish entry (3).
    assert.equal(findByTestId(card!, "stat-status")?.textContent, "Collecting");
    assert.equal(findByTestId(card!, "stat-bullets-queued")?.textContent, "2");
    assert.equal(findByTestId(card!, "stat-collecting-for")?.textContent, "Next release");
  } finally {
    c.cleanup();
  }
});

test("changelog card shows the empty state when no draft applies", async () => {
  const c = await mountWithChangelog([
    // A published row + an awaiting_publish for a DIFFERENT version must not
    // be picked up as the current draft.
    { version: "6.0", status: "published", bodyHtml: TWO_BULLETS, updatedAt: new Date().toISOString() },
    { version: "1.2.3", status: "awaiting_publish", bodyHtml: THREE_BULLETS, updatedAt: new Date().toISOString() },
  ]);
  try {
    const card = findByTestId(c.container, "card-dashboard-changelog-draft");
    assert.ok(card);

    assert.equal(findByTestId(card!, "badge-changelog-draft-count"), null, "no count badge when no draft applies");
    assert.equal(findByTestId(card!, "stat-status")?.textContent, "Empty");
    assert.equal(findByTestId(card!, "stat-bullets-queued")?.textContent, "—");
    assert.equal(findByTestId(card!, "stat-collecting-for")?.textContent, "Next release");
  } finally {
    c.cleanup();
  }
});
