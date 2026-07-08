import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React render coverage for the AlertsTab "Suggested drafts" strip
// (client/src/pages/admin-portal.tsx): pending monitor-generated drafts must
// surface as review cards, an outage draft offers "Review & publish", a
// recovery draft offers "Draft update" / "Draft resolve", and clicking
// Review pre-fills the create-alert dialog from the draft — never
// auto-publishing anything.

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
g.fetch = (async () => jsonResponse({})) as unknown as typeof fetch;
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

function byTestId(root: ParentNode, id: string): HTMLElement | null {
  return root.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
}

type DraftRow = {
  id: string;
  monitorId: string;
  monitorIncidentId: string | null;
  serviceId: string | null;
  kind: "outage" | "recovery";
  suggestedTitle: string;
  suggestedDescription: string;
  suggestedSeverity: string;
  suggestedServiceImpact: string;
  relatedAlertId: string | null;
  status: string;
  actedByUserId: string | null;
  actedAt: string | null;
  createdAt: string;
};

function outageDraft(overrides: Partial<DraftRow> = {}): DraftRow {
  return {
    id: "d-out",
    monitorId: "mon-1",
    monitorIncidentId: "inc-1",
    serviceId: "svc-1",
    kind: "outage",
    suggestedTitle: "API is experiencing an outage",
    suggestedDescription: "Our monitoring detected a problem with API.",
    suggestedSeverity: "critical",
    suggestedServiceImpact: "outage",
    relatedAlertId: null,
    status: "pending",
    actedByUserId: null,
    actedAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const SERVICES = [{ id: "svc-1", name: "API", status: "down", description: "", icon: null, sortOrder: 0 }];

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountAlertsTab(drafts: DraftRow[], opts: { canManage?: boolean } = {}): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/alerts"], []);
  queryClient.setQueryData(["/api/services"], SERVICES);
  queryClient.setQueryData(["/api/admin/alert-drafts?status=pending"], drafts);

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

test("no pending drafts → no suggested-drafts strip", async () => {
  const c = await mountAlertsTab([]);
  try {
    assert.equal(byTestId(c.container, "section-suggested-drafts"), null);
  } finally {
    c.cleanup();
  }
});

test("pending outage draft renders a card with title, description, and Review & Dismiss actions", async () => {
  const c = await mountAlertsTab([outageDraft()]);
  try {
    const section = byTestId(c.container, "section-suggested-drafts");
    assert.ok(section, "suggested drafts strip renders");
    const card = byTestId(section!, "card-alert-draft-d-out");
    assert.ok(card, "draft card renders");
    assert.match(card!.textContent ?? "", /API is experiencing an outage/);
    assert.match(card!.textContent ?? "", /Our monitoring detected a problem/);
    assert.ok(byTestId(card!, "button-review-draft-d-out"), "outage draft offers Review & publish");
    assert.ok(byTestId(card!, "button-dismiss-draft-d-out"), "draft offers Dismiss");
    assert.equal(byTestId(card!, "button-draft-update-d-out"), null, "outage draft has no update action");
  } finally {
    c.cleanup();
  }
});

test("recovery draft offers Draft update + Draft resolve instead of Review & publish", async () => {
  const rec = outageDraft({
    id: "d-rec",
    kind: "recovery",
    suggestedTitle: "API has recovered",
    suggestedDescription: "API has recovered. Total downtime: 3m.",
    suggestedSeverity: "info",
    suggestedServiceImpact: "operational",
    relatedAlertId: "alert-1",
  });
  const c = await mountAlertsTab([rec]);
  try {
    const card = byTestId(c.container, "card-alert-draft-d-rec");
    assert.ok(card);
    assert.ok(byTestId(card!, "button-draft-update-d-rec"), "recovery draft offers Draft update");
    assert.ok(byTestId(card!, "button-draft-resolve-d-rec"), "recovery draft offers Draft resolve");
    assert.equal(byTestId(card!, "button-review-draft-d-rec"), null, "recovery draft has no Review & publish");
  } finally {
    c.cleanup();
  }
});

test("clicking Review & publish pre-fills the create-alert dialog from the draft (no auto-post)", async () => {
  const c = await mountAlertsTab([outageDraft()]);
  try {
    const btn = byTestId(c.container, "button-review-draft-d-out");
    assert.ok(btn);
    await act(async () => {
      btn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();

    const titleInput = window.document.querySelector('[data-testid="input-alert-title"]') as HTMLInputElement | null;
    assert.ok(titleInput, "create-alert dialog opened");
    assert.equal(titleInput!.value, "API is experiencing an outage");
    // Description is a TipTap rich-text editor; assert the draft text landed in it.
    const desc = window.document.querySelector('[data-testid="input-alert-desc-content"]') as HTMLElement | null;
    assert.ok(desc, "description editor rendered");
    assert.match(desc!.textContent ?? "", /Our monitoring detected a problem with API\./);
    // The linked service is pre-checked from the draft.
    const svc = window.document.querySelector('[data-testid="checkbox-alert-service-svc-1"]');
    assert.ok(svc, "service checkbox rendered");
  } finally {
    c.cleanup();
  }
});

test("view-only admins (canManage=false) never see the drafts strip (acting requires manage)", async () => {
  const c = await mountAlertsTab([outageDraft()], { canManage: false });
  try {
    assert.equal(byTestId(c.container, "section-suggested-drafts"), null);
  } finally {
    c.cleanup();
  }
});
