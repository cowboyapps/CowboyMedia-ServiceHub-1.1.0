import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// --- jsdom globals + polyfills (mirrors test/whmcs-tickets-badge.test.ts) -----
// This test covers the observer-gated lazy fetch in InvoiceServiceLabel
// (client/src/components/billing-summary.tsx): older invoices beyond the
// up-front correlation cap render no service label until the row scrolls into
// view, at which point a per-invoice service lookup fires and the label
// appears. Rows the server already labelled never fire the lazy query.
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
  "HTMLElement", "HTMLSpanElement", "HTMLAnchorElement", "HTMLDivElement",
  "Element", "Node", "Document", "DocumentFragment", "ShadowRoot",
  "Event", "CustomEvent", "MouseEvent", "PointerEvent", "FocusEvent",
  "KeyboardEvent", "InputEvent", "NodeFilter", "DOMException",
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

// --- Controllable IntersectionObserver stub ----------------------------------
// The real observer never fires in jsdom (no layout), so we capture each
// observed element and its callback and expose a helper to drive intersection
// on demand — letting the test prove "no fetch before visible" vs. "fetch once
// visible" deterministically.
interface ObserverRecord {
  callback: IntersectionObserverCallback;
  observer: IntersectionObserver;
  elements: Element[];
}
const observerRecords: ObserverRecord[] = [];

class IntersectionObserverStub implements IntersectionObserver {
  root: Element | Document | null = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  private record: ObserverRecord;
  constructor(callback: IntersectionObserverCallback) {
    this.record = { callback, observer: this, elements: [] };
    observerRecords.push(this.record);
  }
  observe(target: Element): void {
    this.record.elements.push(target);
  }
  unobserve(target: Element): void {
    this.record.elements = this.record.elements.filter((el) => el !== target);
  }
  disconnect(): void {
    this.record.elements = [];
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}
g.IntersectionObserver = IntersectionObserverStub as unknown as typeof IntersectionObserver;
w.IntersectionObserver = g.IntersectionObserver;

// Fire intersection for every element currently observed by any live observer.
function triggerIntersection(): void {
  for (const rec of observerRecords) {
    if (rec.elements.length === 0) continue;
    const entries = rec.elements.map(
      (target) =>
        ({ isIntersecting: true, target } as unknown as IntersectionObserverEntry),
    );
    rec.callback(entries, rec.observer);
  }
}

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- fetch stub: tracks every lazy service lookup ----------------------------
function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Per-test: maps a service-endpoint pathname to the payload it should return,
// and records each requested service pathname so the test can assert on it.
let serviceResponses: Record<string, unknown> = {};
const serviceRequests: string[] = [];

const realFetch = globalThis.fetch;
g.fetch = async (input: unknown): Promise<Response> => {
  const url = typeof input === "string" ? input : String((input as { url?: string }).url ?? input);
  const pathname = url.split("?")[0];

  if (pathname.endsWith("/service")) {
    serviceRequests.push(pathname);
    const payload = serviceResponses[pathname];
    if (payload !== undefined) return jsonResponse(payload);
    return jsonResponse({
      configured: true,
      enabled: true,
      linked: true,
      unreachable: false,
      notFound: false,
      service: null,
    });
  }
  return jsonResponse({});
};

// --- Dynamic imports so jsdom globals are installed before React evaluates ----
const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { getQueryFn } = await import("../client/src/lib/queryClient");
const { InvoiceServiceLabel } = await import("../client/src/components/billing-summary");
type BillingInvoice = import("../client/src/components/billing-summary").BillingInvoice;

after(() => {
  g.fetch = realFetch;
  try {
    window.close();
  } catch {}
});

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }
}

const invoice = (over: Partial<BillingInvoice>): BillingInvoice => ({
  id: 1,
  invoiceNum: "1001",
  date: "2026-01-01",
  dueDate: "2026-01-15",
  datePaid: "2026-01-02",
  total: "10.00",
  balance: "0.00",
  currencyCode: "USD",
  status: "paid",
  rawStatus: "Paid",
  payUrl: null,
  ...over,
});

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

async function mountLabel(inv: BillingInvoice): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "returnNull" }),
        retry: false,
        refetchInterval: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        gcTime: 0,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  const root = createRoot(container);
  await act(async () => {
    root.render(
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        React.createElement(InvoiceServiceLabel, { invoice: inv, context: "customer" as const }),
      ),
    );
  });
  await flush();
  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function resetState(): void {
  serviceResponses = {};
  serviceRequests.length = 0;
  observerRecords.length = 0;
}

test("no service query fires while the row is off-screen, then the label appears once it scrolls into view", async () => {
  resetState();
  const inv = invoice({ id: 42 });
  const servicePath = `/api/billing/invoices/${inv.id}/service`;
  serviceResponses[servicePath] = {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    notFound: false,
    service: { serviceId: 7, serviceName: "Web Hosting Pro", serviceUrl: null },
  };

  const h = await mountLabel(inv);
  try {
    // Off-screen: the observer is registered but has not fired, so no fetch and
    // no label yet.
    assert.equal(serviceRequests.length, 0, "no service lookup before the row is visible");
    assert.equal(
      findByTestId(h.container, `text-invoice-service-${inv.id}`),
      null,
      "no service label rendered before the row is visible",
    );
    // The lazy placeholder span is present (it carries the observer ref).
    assert.ok(
      findByTestId(h.container, `invoice-service-lazy-${inv.id}`),
      "lazy placeholder span is mounted with the observer ref",
    );

    // Scroll into view -> observer fires -> lazy query runs -> label appears.
    await act(async () => {
      triggerIntersection();
    });
    await flush();

    assert.deepEqual(
      serviceRequests,
      [servicePath],
      "exactly one service lookup fires after the row becomes visible",
    );
    const label = findByTestId(h.container, `text-invoice-service-${inv.id}`);
    assert.ok(label, "service label renders after the lazy endpoint resolves");
    assert.match(label!.textContent ?? "", /Web Hosting Pro/, "label shows the renewed service name");
  } finally {
    h.cleanup();
  }
});

test("a row already labelled by the server renders immediately and never fires the lazy query", async () => {
  resetState();
  const inv = invoice({
    id: 99,
    serviceName: "Managed VPS",
    serviceUrl: "https://billing.example.com/clientarea.php?action=productdetails&id=7",
  });

  const h = await mountLabel(inv);
  try {
    // Server-labelled rows render the link tag straight away.
    const link = findByTestId(h.container, `link-invoice-service-${inv.id}`);
    assert.ok(link, "server-labelled invoice renders its service link immediately");
    assert.match(link!.textContent ?? "", /Managed VPS/, "shows the server-provided service name");

    // No lazy placeholder span and no observer registered for this row.
    assert.equal(
      findByTestId(h.container, `invoice-service-lazy-${inv.id}`),
      null,
      "server-labelled row has no lazy placeholder span",
    );

    // Even if something tried to intersect, there is nothing to fetch.
    await act(async () => {
      triggerIntersection();
    });
    await flush();

    assert.equal(serviceRequests.length, 0, "server-labelled row never fires the lazy service lookup");
  } finally {
    h.cleanup();
  }
});
