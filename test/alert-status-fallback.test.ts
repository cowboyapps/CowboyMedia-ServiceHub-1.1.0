import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// Legacy rows in service_alerts / alert_updates written before the server-side
// status whitelist may carry arbitrary status strings. Every alert-status
// render site must fall back to a readable label (never a blank badge):
//   - alertStatusLabel() unit behavior (Title Case fallback, "Update" for blank)
//   - the customer-facing alert detail timeline (alert-detail.tsx)
//   - the admin portal alerts list (admin-portal.tsx AlertsTab)

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/alerts/alert-1",
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
g.fetch = (async () => jsonResponse([])) as unknown as typeof fetch;
w.fetch = g.fetch;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { alertStatusLabel } = await import("../client/src/lib/status-meta");
const AlertDetail = (await import("../client/src/pages/alert-detail")).default;
const { AlertsTab } = await import("../client/src/pages/admin-portal");

setupComponentTestTeardown({ queryClient, window });

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

function byTestId(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

const SERVICES = [{ id: "svc-1", name: "API", status: "operational", description: "", icon: null, sortOrder: 0 }];

function legacyAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    title: "Legacy incident",
    description: "<p>Written before the status whitelist.</p>",
    severity: "warning",
    status: "under_review",
    impact: "degraded",
    imageUrl: null,
    serviceIds: ["svc-1"],
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    ...overrides,
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mount(element: React.ReactElement): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(QueryClientProvider, { client: queryClient }, element));
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

test("alertStatusLabel: known statuses keep canonical labels", () => {
  assert.equal(alertStatusLabel("investigating"), "Investigating");
  assert.equal(alertStatusLabel("identified"), "Identified");
  assert.equal(alertStatusLabel("monitoring"), "Monitoring");
  assert.equal(alertStatusLabel("resolved"), "Resolved");
  // Legacy rows may carry odd casing of a known status.
  assert.equal(alertStatusLabel("Resolved"), "Resolved");
});

test("alertStatusLabel: unknown values render Title Case, never blank", () => {
  assert.equal(alertStatusLabel("under_review"), "Under Review");
  assert.equal(alertStatusLabel("pending-fix"), "Pending Fix");
  assert.equal(alertStatusLabel("ESCALATED"), "Escalated");
  assert.equal(alertStatusLabel("weird   spacing"), "Weird Spacing");
  assert.equal(alertStatusLabel(""), "Update");
  assert.equal(alertStatusLabel("   "), "Update");
  assert.equal(alertStatusLabel(null), "Update");
  assert.equal(alertStatusLabel(undefined), "Update");
});

test("customer alert detail renders a readable fallback for unknown statuses", async () => {
  // AlertDetail reads useParams().id — outside a matched wouter Route it is
  // undefined, so the queries key on ["/api/alerts", undefined]. Seed those
  // keys directly; the default fetcher never fires.
  queryClient.setQueryData(["/api/alerts", undefined], legacyAlert());
  queryClient.setQueryData(
    ["/api/alerts", undefined, "updates"],
    [
      { id: "u1", alertId: "alert-1", status: "under_review", message: "<p>Looking at it.</p>", imageUrl: null, createdAt: new Date().toISOString() },
      { id: "u2", alertId: "alert-1", status: "", message: "<p>Blank status row.</p>", imageUrl: null, createdAt: new Date().toISOString() },
    ],
  );
  queryClient.setQueryData(["/api/services"], SERVICES);

  const c = await mount(React.createElement(AlertDetail));
  try {
    const headerBadge = byTestId(c.container, "badge-alert-status");
    assert.ok(headerBadge, "header status badge renders");
    assert.equal(headerBadge!.textContent?.trim(), "Under Review");

    const u1 = byTestId(c.container, "badge-alert-update-status-u1");
    assert.ok(u1, "timeline badge for unknown status renders");
    assert.equal(u1!.textContent?.trim(), "Under Review");

    const u2 = byTestId(c.container, "badge-alert-update-status-u2");
    assert.ok(u2, "timeline badge for blank status renders");
    assert.equal(u2!.textContent?.trim(), "Update", "blank status falls back to 'Update'");
  } finally {
    c.cleanup();
  }
});

test("admin alerts list renders a readable fallback for unknown statuses", async () => {
  queryClient.setQueryData(["/api/alerts"], [legacyAlert()]);
  queryClient.setQueryData(["/api/services"], SERVICES);
  queryClient.setQueryData(["/api/admin/alert-drafts?status=pending"], []);
  queryClient.setQueryData(["/api/alerts", "alert-1", "updates"], []);

  const c = await mount(React.createElement(AlertsTab, { canManage: true }));
  try {
    const badge = byTestId(c.container, "badge-alert-status-alert-1");
    assert.ok(badge, "admin status badge renders");
    assert.equal(badge!.textContent?.trim(), "Under Review", "unknown status renders Title Case, not raw/blank");
  } finally {
    c.cleanup();
  }
});
