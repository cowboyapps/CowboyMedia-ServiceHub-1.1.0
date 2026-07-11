import { test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { setupComponentTestTeardown } from "./helpers/component-test-teardown";

// React render coverage for the streamlined alert-status flow in the AlertsTab
// (client/src/pages/admin-portal.tsx): active alerts surface a prominent,
// colour-coded current status plus inline one-tap status controls and a Resolve
// action; clicking a status pill opens the streamlined post-update dialog
// pre-set to that status with the impact + notification options collapsed;
// resolved alerts hide the inline controls; and an expanded alert shows a
// readable update timeline.

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/admin?tab=alerts",
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
// Capture the streamlined post-update write so we can assert its payload
// defaults (these drive customer notification fan-out + status recompute).
interface CapturedPost { url: string; body: FormData }
let capturedUpdatePost: CapturedPost | null = null;
// Read through a function so control-flow analysis keeps the declared union type
// after the test resets the module-level variable to null (the fetch closure
// reassigns it out of band).
const getCapturedUpdatePost = (): CapturedPost | null => capturedUpdatePost;
// GET refetches must resolve to an array — the tab maps over updates/alerts.
g.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
  const url = typeof input === "string" ? input : String(input);
  const body = init?.body as FormData | undefined;
  const isFormData = !!body && typeof body.append === "function" && typeof body.get === "function";
  if (isFormData && /\/api\/admin\/alerts\/.+\/updates$/.test(url)) {
    capturedUpdatePost = { url, body: body! };
  }
  return jsonResponse([]);
}) as unknown as typeof fetch;
w.fetch = g.fetch;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { AlertsTab } = await import("../client/src/pages/admin-portal");

// One of the tests fires a real useMutation (POST) and unmounts; React Query's
// mutation gc timer would otherwise pin the event loop until the watchdog kills
// the file. The shared teardown always collapses mutation gcTime to 0 to fix
// that. Query gcTime is left alone (collapseQueryGcTime:false): the timeline
// test seeds the per-alert updates cache and reads it back before the expanded
// query mounts an observer, so gcTime:0 would GC that seed prematurely.
setupComponentTestTeardown({ queryClient, window, collapseQueryGcTime: false });

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

// Drive the TipTap message editor: writing the DOM + firing an input event makes
// ProseMirror's observer flush, so the form's message field (required) is filled.
function typeIntoEditor(testId: string, html: string): void {
  const ce = window.document.querySelector(`[data-testid="${testId}"]`) as HTMLElement | null;
  if (!ce) throw new Error(`editor "${testId}" not found`);
  ce.innerHTML = html;
  ce.dispatchEvent(new window.InputEvent("input", { bubbles: true }));
}

const SERVICES = [{ id: "svc-1", name: "API", status: "operational", description: "", icon: null, sortOrder: 0 }];

function activeAlert(overrides: Record<string, unknown> = {}) {
  return {
    id: "alert-1",
    title: "Database latency",
    description: "<p>Investigating elevated latency.</p>",
    severity: "critical",
    status: "investigating",
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

async function mountAlertsTab(
  alerts: Record<string, unknown>[],
  opts: { canManage?: boolean; updates?: Record<string, unknown[]> } = {},
): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/alerts"], alerts);
  queryClient.setQueryData(["/api/services"], SERVICES);
  queryClient.setQueryData(["/api/admin/alert-drafts?status=pending"], []);
  for (const a of alerts) {
    queryClient.setQueryData(["/api/alerts", a.id, "updates"], opts.updates?.[a.id as string] ?? []);
  }

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(AlertsTab, { canManage: opts.canManage ?? true }),
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

test("active alert shows colour-coded current status + inline status controls", async () => {
  const c = await mountAlertsTab([activeAlert()]);
  try {
    const badge = byTestId(c.container, "badge-alert-status-alert-1");
    assert.ok(badge, "status badge renders");
    assert.match(badge!.textContent ?? "", /Investigating/);

    const controls = byTestId(c.container, "inline-status-controls-alert-1");
    assert.ok(controls, "inline status controls render without expanding the card");
    assert.ok(byTestId(controls!, "button-set-status-identified-alert-1"), "quick 'Identified' status control");
    assert.ok(byTestId(controls!, "button-set-status-monitoring-alert-1"), "quick 'Monitoring' status control");
    assert.ok(byTestId(controls!, "button-resolve-inline-alert-1"), "one-tap Resolve control");
  } finally {
    c.cleanup();
  }
});

test("resolved alert hides inline status controls but keeps a Resolved badge", async () => {
  const c = await mountAlertsTab([activeAlert({ status: "resolved", resolvedAt: new Date().toISOString() })]);
  try {
    const badge = byTestId(c.container, "badge-alert-status-alert-1");
    assert.ok(badge, "status badge renders");
    assert.match(badge!.textContent ?? "", /Resolved/);
    assert.equal(byTestId(c.container, "inline-status-controls-alert-1"), null, "no inline status controls once resolved");
  } finally {
    c.cleanup();
  }
});

test("clicking a status pill opens the streamlined update dialog preset to that status with options collapsed", async () => {
  const c = await mountAlertsTab([activeAlert()]);
  try {
    const pill = byTestId(c.container, "button-set-status-identified-alert-1");
    assert.ok(pill);
    await act(async () => {
      pill!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    // Streamlined dialog only needs status + message; advanced options hidden.
    assert.ok(window.document.querySelector('[data-testid="input-update-message-content"]'), "post-update dialog opened");
    assert.equal(window.document.querySelector('[data-testid="section-update-advanced"]'), null, "impact + notify options collapsed by default");
    const statusTrigger = window.document.querySelector('[data-testid="select-update-status"]') as HTMLElement | null;
    assert.ok(statusTrigger, "status control rendered");
    assert.match(statusTrigger!.textContent ?? "", /Identified/, "status preset from the clicked pill");
  } finally {
    c.cleanup();
  }
});

test("toggling 'Impact & notification options' reveals the secondary controls", async () => {
  const c = await mountAlertsTab([activeAlert()]);
  try {
    await act(async () => {
      byTestId(c.container, "button-set-status-monitoring-alert-1")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();
    assert.equal(window.document.querySelector('[data-testid="section-update-advanced"]'), null, "advanced hidden initially");

    const toggle = window.document.querySelector('[data-testid="button-toggle-update-advanced"]') as HTMLElement | null;
    assert.ok(toggle, "advanced toggle rendered");
    await act(async () => {
      toggle!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const advanced = window.document.querySelector('[data-testid="section-update-advanced"]');
    assert.ok(advanced, "advanced section revealed");
    assert.ok(window.document.querySelector('[data-testid="select-update-service-impact"]'), "service-impact control present in advanced");
    assert.ok(window.document.querySelector('[data-testid="switch-update-silent"]'), "silent switch present in advanced");
  } finally {
    c.cleanup();
  }
});

test("expanded alert shows a readable update timeline (status + message per entry)", async () => {
  const updates = {
    "alert-1": [
      { id: "u-1", alertId: "alert-1", status: "investigating", message: "<p>Looking into it.</p>", imageUrl: null, createdAt: new Date().toISOString() },
      { id: "u-2", alertId: "alert-1", status: "monitoring", message: "<p>Fix applied, monitoring.</p>", imageUrl: null, createdAt: new Date().toISOString() },
    ],
  };
  const c = await mountAlertsTab([activeAlert()], { updates });
  try {
    await act(async () => {
      byTestId(c.container, "button-expand-alert-alert-1")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const entry1 = byTestId(c.container, "alert-update-entry-u-1");
    const entry2 = byTestId(c.container, "alert-update-entry-u-2");
    assert.ok(entry1 && entry2, "both timeline entries render");
    assert.match(byTestId(c.container, "badge-alert-update-status-u-2")!.textContent ?? "", /Monitoring/);
    assert.match(byTestId(c.container, "text-alert-update-message-u-2")!.textContent ?? "", /Fix applied, monitoring/);
  } finally {
    c.cleanup();
  }
});

test("submitting the streamlined update (advanced collapsed) POSTs the notify-on defaults", async () => {
  const c = await mountAlertsTab([activeAlert()]);
  capturedUpdatePost = null;
  try {
    // One-tap: click the "Identified" status pill to open the streamlined dialog.
    await act(async () => {
      byTestId(c.container, "button-set-status-identified-alert-1")!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    // We deliberately never open the "Impact & notification options" section —
    // this asserts the defaults that apply when an admin just taps + posts.
    assert.equal(window.document.querySelector('[data-testid="section-update-advanced"]'), null, "advanced options stay collapsed");

    // Fill the required message, then submit exactly as-is.
    await act(async () => {
      typeIntoEditor("input-update-message-content", "<p>Fix deployed, monitoring recovery.</p>");
    });
    await flushFrames();

    await act(async () => {
      (window.document.querySelector('[data-testid="button-submit-update"]') as HTMLElement).dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const captured = getCapturedUpdatePost();
    assert.ok(captured, "streamlined submit POSTed to the updates endpoint");
    assert.match(captured!.url, /\/api\/admin\/alerts\/alert-1\/updates$/, "hits the per-alert updates route");
    const body = captured!.body;
    // These four defaults are what actually notify customers + recompute service
    // status during an incident; a silent UI regression here must fail the build.
    assert.equal(body.get("status"), "identified", "status = clicked pill's status");
    assert.equal(body.get("sendPush"), "true", "push notifications on by default");
    assert.equal(body.get("sendEmail"), "true", "subscriber emails on by default");
    assert.equal(body.get("serviceImpact"), "no_change", "service impact left unchanged by default");
    assert.equal(body.get("silent"), "false", "not silent — customers are notified");
  } finally {
    c.cleanup();
  }
});

test("view-only admin (canManage=false) sees status but no inline controls", async () => {
  const c = await mountAlertsTab([activeAlert()], { canManage: false });
  try {
    assert.ok(byTestId(c.container, "badge-alert-status-alert-1"), "status still visible");
    assert.equal(byTestId(c.container, "inline-status-controls-alert-1"), null, "acting controls require manage permission");
  } finally {
    c.cleanup();
  }
});
