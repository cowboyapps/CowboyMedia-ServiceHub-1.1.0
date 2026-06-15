import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the admin Suspend / Unsuspend / Terminate controls
// in client/src/components/billing-summary.tsx (AdminServiceActionDialog + the
// per-product admin buttons). Mounts BillingSummaryView in context="admin" with
// services in active / suspended / terminated states and locks in that:
//   - only the status-appropriate buttons render (active -> Suspend + Terminate,
//     suspended -> Unsuspend + Terminate, terminated -> none)
//   - the Terminate confirm dialog gates the destructive POST (nothing fires on
//     the row button alone; the call only happens on the dialog's Confirm)
//   - each action hits the right endpoint, and a suspend carries the typed reason
//     in the request body (unsuspend/terminate send no body)

// --- jsdom globals + polyfills (mirrors test/billing-confirmation-banner.test.ts)
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

// Never report intersection so InvoiceServiceLabel's lazy per-invoice service
// lookup stays disabled (no stray fetch for an endpoint this test doesn't stub).
class IntersectionObserverStub implements IntersectionObserver {
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}
g.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
w.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;

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

// --- Capture every fetch the admin action mutation makes so we can assert the
// endpoint + body. apiRequest calls fetch(url, { method, headers, body }).
interface CapturedRequest {
  url: string;
  method: string;
  body: unknown;
}
let captured: CapturedRequest[] = [];

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

// How the next non-GET (admin action) request resolves. Tests flip this to drive
// the happy path (default), a non-2xx error response (permission denied / WHMCS
// unreachable / conflict), or an indefinitely in-flight call so we can observe
// the pending label + disabled buttons before it settles.
type PostBehavior =
  | { kind: "ok" }
  | { kind: "error"; status: number; body: unknown }
  | { kind: "hang" };
let postBehavior: PostBehavior = { kind: "ok" };
let releaseHang: (() => void) | null = null;

g.fetch = (async (url: unknown, init?: RequestInit) => {
  const u = String(url);
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    captured.push({
      url: u,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    if (postBehavior.kind === "hang") {
      await new Promise<void>((resolve) => {
        releaseHang = resolve;
      });
      return jsonResponse({ ok: true, message: "Done" });
    }
    if (postBehavior.kind === "error") {
      return jsonResponse(postBehavior.body, postBehavior.status);
    }
    return jsonResponse({ ok: true, message: "Done" });
  }
  return jsonResponse({});
}) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
// billing-summary.tsx uses the classic JSX transform; the free `React`
// identifier must resolve to a global.
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { useToast } = await import("../client/src/hooks/use-toast");
const { BillingSummaryView } = await import("../client/src/components/billing-summary");

// The admin action buttons drive react-query mutations. A settled mutation
// schedules a 5-minute garbage-collection timer that queryClient.clear() does
// NOT cancel, which keeps the node:test process alive long past the suite's
// per-file watchdog. Collapse mutation gcTime to 0 (test process only — each
// file runs in its own subprocess) so the runner sees a clean exit-0.
queryClient.setDefaultOptions({ mutations: { gcTime: 0 } });
type BillingSummary = import("../client/src/components/billing-summary").BillingSummary;
type BillingProduct = import("../client/src/components/billing-summary").BillingProduct;

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

// Radix Dialog content portals to document.body (outside the mount container),
// so search the whole document — test ids are unique enough to stay unambiguous.
function findByTestId(_root: ParentNode, id: string): Element | null {
  return window.document.querySelector(`[data-testid="${id}"]`);
}

const USER_ID = "42";

function product(id: number, status: string): BillingProduct {
  return {
    id,
    pid: 100 + id,
    name: `Service ${id}`,
    domain: `svc${id}.example.com`,
    status,
    nextDueDate: null,
    billingCycle: "Monthly",
    amount: "10.00",
  };
}

function summary(products: BillingProduct[]): BillingSummary {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    client: { id: 1, name: "Test Customer", status: "Active" },
    balance: null,
    invoices: [],
    products,
    transactions: [],
    portalUrl: null,
    payAll: null,
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

// The latest toast queue, mirrored out of the shared toast store by a headless
// probe so error-path tests can assert what surfaced without rendering the Radix
// Toaster (and its portal/animation machinery). Newest toast is index 0.
interface CapturedToast {
  title?: unknown;
  description?: unknown;
  variant?: unknown;
}
let toasts: CapturedToast[] = [];

const ToastProbe: React.FC = () => {
  const state = useToast();
  toasts = state.toasts.map((t) => ({
    title: t.title,
    description: t.description,
    variant: t.variant,
  }));
  return null;
};

async function mountAdmin(data: BillingSummary): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ToastProbe),
      React.createElement(BillingSummaryView, {
        data,
        isLoading: false,
        context: "admin" as const,
        userId: USER_ID,
      }),
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
      captured = [];
      toasts = [];
      postBehavior = { kind: "ok" };
      releaseHang = null;
    },
  };
}

async function clickTestId(c: MountResult, id: string): Promise<void> {
  const el = findByTestId(c.container, id);
  assert.ok(el instanceof window.HTMLElement, `element ${id} present and clickable`);
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flushFrames();
}

test("active service shows Suspend + Terminate, not Unsuspend", async () => {
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    assert.ok(findByTestId(c.container, "button-admin-suspend-1"), "Suspend offered on an active service");
    assert.ok(findByTestId(c.container, "button-admin-terminate-1"), "Terminate offered on an active service");
    assert.equal(
      findByTestId(c.container, "button-admin-unsuspend-1"),
      null,
      "Unsuspend is NOT offered on an active service",
    );
  } finally {
    c.cleanup();
  }
});

test("suspended service shows Unsuspend + Terminate, not Suspend", async () => {
  const c = await mountAdmin(summary([product(2, "Suspended")]));
  try {
    assert.ok(findByTestId(c.container, "button-admin-unsuspend-2"), "Unsuspend offered on a suspended service");
    assert.ok(findByTestId(c.container, "button-admin-terminate-2"), "Terminate offered on a suspended service");
    assert.equal(
      findByTestId(c.container, "button-admin-suspend-2"),
      null,
      "Suspend is NOT offered on a suspended service",
    );
  } finally {
    c.cleanup();
  }
});

test("terminated service shows no admin lifecycle buttons", async () => {
  const c = await mountAdmin(summary([product(3, "Terminated")]));
  try {
    assert.equal(findByTestId(c.container, "button-admin-suspend-3"), null, "no Suspend on a terminated service");
    assert.equal(findByTestId(c.container, "button-admin-unsuspend-3"), null, "no Unsuspend on a terminated service");
    assert.equal(findByTestId(c.container, "button-admin-terminate-3"), null, "no Terminate on a terminated service");
  } finally {
    c.cleanup();
  }
});

test("suspend sends the typed reason in the request body to the suspend endpoint", async () => {
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    await clickTestId(c, "button-admin-suspend-1");
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "suspend dialog opened");

    const reasonInput = findByTestId(c.container, "input-admin-suspend-reason");
    assert.ok(reasonInput instanceof window.HTMLInputElement, "suspend reason field rendered");
    await act(async () => {
      const input = reasonInput as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "Overdue invoice");
      input.dispatchEvent(new window.Event("input", { bubbles: true }));
    });
    await flushFrames();

    assert.equal(captured.length, 0, "nothing fired before confirming");
    await clickTestId(c, "button-admin-action-confirm");

    assert.equal(captured.length, 1, "exactly one POST fired on confirm");
    assert.equal(
      captured[0].url,
      `/api/admin/users/${USER_ID}/whmcs/services/1/suspend`,
      "suspend hits the per-service suspend endpoint",
    );
    assert.equal(captured[0].method, "POST", "suspend is a POST");
    assert.deepEqual(captured[0].body, { reason: "Overdue invoice" }, "the typed reason is sent in the body");
  } finally {
    c.cleanup();
  }
});

test("terminate is gated by the confirm dialog and sends no body", async () => {
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    // The row button only opens the dialog — the destructive call must NOT fire yet.
    await clickTestId(c, "button-admin-terminate-1");
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "terminate confirm dialog opened");
    assert.equal(captured.length, 0, "no POST fired just by opening the terminate dialog");

    // No suspend-reason field on terminate.
    assert.equal(
      findByTestId(c.container, "input-admin-suspend-reason"),
      null,
      "terminate carries no reason field",
    );

    // Dismissing the dialog still fires nothing.
    await clickTestId(c, "button-admin-action-dismiss");
    assert.equal(captured.length, 0, "dismissing the dialog never calls the endpoint");

    // Re-open and actually confirm.
    await clickTestId(c, "button-admin-terminate-1");
    await clickTestId(c, "button-admin-action-confirm");

    assert.equal(captured.length, 1, "exactly one POST fired on confirm");
    assert.equal(
      captured[0].url,
      `/api/admin/users/${USER_ID}/whmcs/services/1/terminate`,
      "terminate hits the per-service terminate endpoint",
    );
    assert.equal(captured[0].method, "POST", "terminate is a POST");
    assert.equal(captured[0].body, undefined, "terminate sends no request body");
  } finally {
    c.cleanup();
  }
});

test("unsuspend hits the unsuspend endpoint with no body", async () => {
  const c = await mountAdmin(summary([product(2, "Suspended")]));
  try {
    await clickTestId(c, "button-admin-unsuspend-2");
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "unsuspend dialog opened");
    assert.equal(captured.length, 0, "nothing fired before confirming");

    await clickTestId(c, "button-admin-action-confirm");

    assert.equal(captured.length, 1, "exactly one POST fired on confirm");
    assert.equal(
      captured[0].url,
      `/api/admin/users/${USER_ID}/whmcs/services/2/unsuspend`,
      "unsuspend hits the per-service unsuspend endpoint",
    );
    assert.equal(captured[0].method, "POST", "unsuspend is a POST");
    assert.equal(captured[0].body, undefined, "unsuspend sends no request body");
  } finally {
    c.cleanup();
  }
});

// --- Error path: when the WHMCS suspend/unsuspend/terminate call fails (permission
// denied, WHMCS unreachable, conflict), the mutation's onError raises a destructive
// toast carrying the server's message and the dialog stays open so the admin can
// retry or cancel — nothing is silently swallowed.

test("a failed suspend surfaces a destructive error toast and keeps the dialog open", async () => {
  // Server rejects with a permission-denied message.
  postBehavior = {
    kind: "error",
    status: 403,
    body: { message: "You don't have permission to suspend services." },
  };
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    await clickTestId(c, "button-admin-suspend-1");
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "suspend dialog opened");

    await clickTestId(c, "button-admin-action-confirm");

    // The POST was attempted...
    assert.equal(captured.length, 1, "the suspend POST fired");
    assert.equal(
      captured[0].url,
      `/api/admin/users/${USER_ID}/whmcs/services/1/suspend`,
      "it hit the suspend endpoint",
    );

    // ...and on failure a destructive toast surfaces the server's message verbatim.
    const t = toasts[0];
    assert.ok(t, "an error toast was raised");
    assert.equal(t.title, "Couldn't complete that action", "the error toast title");
    assert.equal(t.variant, "destructive", "the error toast is destructive");
    assert.equal(
      t.description,
      "You don't have permission to suspend services.",
      "the server's message is surfaced to the admin",
    );

    // The dialog is NOT dismissed — the admin can retry or cancel.
    assert.ok(
      findByTestId(c.container, "dialog-admin-service-action"),
      "the dialog stays open after a failed action",
    );
  } finally {
    c.cleanup();
  }
});

test("a failed terminate (WHMCS unreachable) keeps the dialog open with a fallback message", async () => {
  // Server returns a non-JSON body (e.g. a gateway error page) — the dialog must
  // still degrade gracefully rather than echoing raw markup at the operator.
  postBehavior = { kind: "error", status: 502, body: "Bad Gateway" };
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    await clickTestId(c, "button-admin-terminate-1");
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "terminate dialog opened");

    await clickTestId(c, "button-admin-action-confirm");

    assert.equal(captured.length, 1, "the terminate POST fired");
    assert.equal(
      captured[0].url,
      `/api/admin/users/${USER_ID}/whmcs/services/1/terminate`,
      "it hit the terminate endpoint",
    );

    const t = toasts[0];
    assert.ok(t, "an error toast was raised");
    assert.equal(t.title, "Couldn't complete that action", "the error toast title");
    assert.equal(t.variant, "destructive", "the error toast is destructive");
    assert.ok(
      typeof t.description === "string" && (t.description as string).length > 0,
      "a non-empty, human-readable message is shown",
    );

    assert.ok(
      findByTestId(c.container, "dialog-admin-service-action"),
      "the destructive terminate dialog stays open after a failed action",
    );
  } finally {
    c.cleanup();
  }
});

test("the confirm button shows a pending label and disables both buttons while in flight", async () => {
  // The action hangs until we release it, so we can observe the in-flight state.
  postBehavior = { kind: "hang" };
  const c = await mountAdmin(summary([product(1, "Active")]));
  try {
    await clickTestId(c, "button-admin-terminate-1");
    await clickTestId(c, "button-admin-action-confirm");

    const confirm = findByTestId(c.container, "button-admin-action-confirm");
    const dismiss = findByTestId(c.container, "button-admin-action-dismiss");
    assert.ok(confirm instanceof window.HTMLButtonElement, "confirm button present");
    assert.ok(dismiss instanceof window.HTMLButtonElement, "cancel button present");

    assert.equal(
      (confirm as HTMLButtonElement).textContent?.trim(),
      "Terminating...",
      "confirm shows the in-flight pending label",
    );
    assert.equal((confirm as HTMLButtonElement).disabled, true, "confirm is disabled while pending");
    assert.equal((dismiss as HTMLButtonElement).disabled, true, "cancel is disabled while pending");

    // The dialog is still open mid-flight — nothing resolved yet, no toast raised.
    assert.ok(findByTestId(c.container, "dialog-admin-service-action"), "dialog open while pending");

    // Release the in-flight request and let it settle on the success path.
    await act(async () => {
      releaseHang?.();
    });
    await flushFrames();

    // The mutation resolved: a non-destructive success toast surfaced, and the
    // confirm button is no longer stuck on its pending label.
    const t = toasts[0];
    assert.ok(t, "a toast surfaced once the action resolved");
    assert.equal(t.title, "Service terminated", "the success toast title");
    assert.notEqual(t.variant, "destructive", "a resolved action is not a destructive toast");
  } finally {
    c.cleanup();
  }
});
