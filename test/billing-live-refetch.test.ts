import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// Regression guard for the WHMCS-billing freshness fix (Task #568): WHMCS-backed
// reads opt into `liveQueryOptions` (finite 30s staleTime + refetch on
// mount/focus/reconnect) instead of the app-wide `staleTime: Infinity` default.
// Without this, a cached billing snapshot could show a deleted/paid invoice for
// days because nothing ever refetched.
//
// This test mounts the real BillingPage (which drives `useQuery(["/api/billing"],
// ...liveQueryOptions)`) and proves the end-to-end contract that protects against
// a future change to the global query defaults or to `liveQueryOptions`:
//   - a cached-but-stale (>30s) billing query REFETCHES on window focus and the
//     UI drops a now-deleted invoice
//   - the same happens on network reconnect
//   - a still-FRESH (<30s) query does NOT refetch on focus (proves the options
//     are `true`, not `"always"`, so re-focusing within the window is cheap)
// If someone reverts staleTime to Infinity, drops refetchOnWindowFocus, or drops
// refetchOnReconnect, the stale-refetch assertions fail.

// --- jsdom globals + polyfills (mirrors test/billing-confirmation-banner.test.ts)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/billing",
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

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- A minimal Response-like the default query fetcher / apiRequest needs.
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

// The server-side billing payload the next GET /api/billing will return. Tests
// swap this to simulate a change made directly in WHMCS (e.g. an invoice
// deleted) before they trigger a focus/reconnect refetch.
let billingResponse: BillingSummary;
let billingFetchCount = 0;

g.fetch = (async (url: unknown) => {
  const u = String(url);
  if (u.includes("/api/billing/profile")) {
    // Not wired up -> WhmcsProfileCard renders nothing. Keeps the page focused
    // on the invoice list under test.
    return jsonResponse({
      configured: false, enabled: false, linked: false, unreachable: false, profile: null,
    });
  }
  if (u.includes("/api/billing")) {
    billingFetchCount++;
    return jsonResponse(billingResponse);
  }
  return jsonResponse({});
}) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider, focusManager, onlineManager } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const BillingPage = (await import("../client/src/pages/billing-page")).default;
type BillingSummary = import("../client/src/components/billing-summary").BillingSummary;
type BillingInvoice = import("../client/src/components/billing-summary").BillingInvoice;
type InvoiceStatus = import("../client/src/components/billing-summary").InvoiceStatus;

after(() => {
  try {
    queryClient.clear();
    // Leave the managers in a sane default for any later file in the process.
    onlineManager.setOnline(true);
    focusManager.setFocused(undefined);
    window.close();
  } catch {}
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function flushFrames(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

function inv(id: number, status: InvoiceStatus = "paid", total = "10.00"): BillingInvoice {
  return {
    id,
    invoiceNum: `INV-${id}`,
    date: null,
    dueDate: null,
    datePaid: null,
    total,
    balance: null,
    currencyCode: "USD",
    status,
    rawStatus: status,
    payUrl: null,
    serviceId: null,
    serviceName: null,
    serviceUrl: null,
  };
}

function summary(invoices: BillingInvoice[]): BillingSummary {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    client: { id: 1, name: "Test", status: "Active" },
    balance: { creditBalance: "0.00", currencyCode: "USD" },
    invoices,
    products: [],
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

// Mount BillingPage with the billing query primed FRESH (updatedAt = now) so the
// initial render shows `initial` without a mount-time refetch (refetchOnMount is
// `true`, which respects staleTime). The profile query is primed not-wired so its
// card renders nothing.
async function mountBilling(initial: BillingSummary): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/billing"], initial);
  queryClient.setQueryData(["/api/billing/profile"], {
    configured: false, enabled: false, linked: false, unreachable: false, profile: null,
  });

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(BillingPage),
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

// Push the billing query's last-updated time 60s into the past so it is stale
// against the 30s staleTime, WITHOUT changing the displayed data. This is the
// deterministic stand-in for "30+ seconds have elapsed since the data loaded".
function ageBillingPastStaleTime(): void {
  const cached = queryClient.getQueryData<BillingSummary>(["/api/billing"]);
  queryClient.setQueryData(["/api/billing"], cached, { updatedAt: Date.now() - 60_000 });
}

test("a stale billing query refetches on window focus and drops a deleted invoice", async () => {
  billingResponse = summary([inv(1), inv(2)]);
  const c = await mountBilling(billingResponse);
  try {
    assert.ok(findByTestId(c.container, "card-billing-invoice-1"), "invoice 1 shown initially");
    assert.ok(findByTestId(c.container, "card-billing-invoice-2"), "invoice 2 shown initially");

    // Invoice 1 is deleted directly in WHMCS; the next GET returns only invoice 2.
    billingResponse = summary([inv(2)]);
    const before = billingFetchCount;

    // 30+ seconds pass, then the tab regains focus (PWA resume / window focus).
    ageBillingPastStaleTime();
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await sleep(0);
    });
    await flushFrames();

    assert.ok(billingFetchCount > before, "focus on a stale query triggers a refetch");
    assert.equal(
      findByTestId(c.container, "card-billing-invoice-1"),
      null,
      "the deleted invoice disappears after the focus refetch",
    );
    assert.ok(
      findByTestId(c.container, "card-billing-invoice-2"),
      "the surviving invoice still renders",
    );
  } finally {
    c.cleanup();
  }
});

test("a stale billing query refetches on network reconnect and drops a deleted invoice", async () => {
  billingResponse = summary([inv(1), inv(2)]);
  const c = await mountBilling(billingResponse);
  try {
    assert.ok(findByTestId(c.container, "card-billing-invoice-1"), "invoice 1 shown initially");

    billingResponse = summary([inv(2)]);
    const before = billingFetchCount;

    ageBillingPastStaleTime();
    await act(async () => {
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
      await sleep(0);
    });
    await flushFrames();

    assert.ok(billingFetchCount > before, "reconnect on a stale query triggers a refetch");
    assert.equal(
      findByTestId(c.container, "card-billing-invoice-1"),
      null,
      "the deleted invoice disappears after the reconnect refetch",
    );
  } finally {
    onlineManager.setOnline(true);
    c.cleanup();
  }
});

test("a still-fresh billing query does NOT refetch on focus (options are true, not always)", async () => {
  billingResponse = summary([inv(1)]);
  const c = await mountBilling(billingResponse);
  try {
    const before = billingFetchCount;

    // The data is fresh (just primed) — a focus within the 30s window should
    // reuse it, not fire a redundant request.
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await sleep(0);
    });
    await flushFrames();

    assert.equal(billingFetchCount, before, "no refetch while the data is still fresh");
    assert.ok(
      findByTestId(c.container, "card-billing-invoice-1"),
      "the cached invoice keeps rendering",
    );
  } finally {
    c.cleanup();
  }
});
