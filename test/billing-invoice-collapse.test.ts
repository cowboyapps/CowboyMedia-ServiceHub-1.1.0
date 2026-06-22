import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the "Show all invoices" collapse/expand control in
// client/src/components/billing-summary.tsx (Task #523). A long invoice history is
// capped to the newest few; a toggle reveals the rest and collapses again. A short
// list (at/under the cap) renders no toggle at all.

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

g.open = () => ({ location: { href: "" }, opener: null } as unknown as Window);
w.open = g.open;

g.IS_REACT_ACT_ENVIRONMENT = true;

g.fetch = (async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({}),
  text: async () => "{}",
  clone() { return this; },
})) as unknown as typeof fetch;
w.fetch = g.fetch;

const React = await import("react");
g.React = React;
w.React = React;
const { act } = React;
const { createRoot } = await import("react-dom/client");
type Root = import("react-dom/client").Root;
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { BillingSummaryView } = await import("../client/src/components/billing-summary");
type BillingSummary = import("../client/src/components/billing-summary").BillingSummary;
type BillingInvoice = import("../client/src/components/billing-summary").BillingInvoice;
type InvoiceStatus = import("../client/src/components/billing-summary").InvoiceStatus;

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

function countInvoiceCards(root: ParentNode): number {
  return root.querySelectorAll('[data-testid^="card-billing-invoice-"]').length;
}

function inv(id: number, status: InvoiceStatus = "paid"): BillingInvoice {
  return {
    id,
    invoiceNum: `INV-${id}`,
    date: null,
    dueDate: null,
    datePaid: null,
    total: "10.00",
    balance: null,
    currencyCode: "USD",
    status,
    rawStatus: status,
    payUrl: null,
  };
}

function summary(invoices: BillingInvoice[]): BillingSummary {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    client: { id: 1, name: "Test", status: "Active" },
    balance: null,
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

async function mountBilling(initial: BillingSummary): Promise<MountResult> {
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  queryClient.setQueryData(["/api/billing"], initial);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(BillingSummaryView, {
        data: initial,
        isLoading: false,
        context: "customer" as const,
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
    },
  };
}

test("a long invoice list is capped and the toggle reveals the rest", async () => {
  const invoices = Array.from({ length: 8 }, (_, i) => inv(i + 1));
  const c = await mountBilling(summary(invoices));
  try {
    assert.equal(countInvoiceCards(c.container), 5, "initial render caps to the newest 5");

    const toggle = findByTestId(c.container, "button-toggle-all-invoices");
    assert.ok(toggle, "toggle button renders when there are more than the cap");
    assert.match(toggle?.textContent ?? "", /Show all invoices \(8\)/, "label shows the full count");

    await act(async () => {
      (toggle as HTMLButtonElement).click();
    });
    await flushFrames();

    assert.equal(countInvoiceCards(c.container), 8, "expanding shows every invoice");
    assert.match(
      findByTestId(c.container, "button-toggle-all-invoices")?.textContent ?? "",
      /Show fewer invoices/,
      "label flips to collapse copy when expanded",
    );

    await act(async () => {
      (findByTestId(c.container, "button-toggle-all-invoices") as HTMLButtonElement).click();
    });
    await flushFrames();

    assert.equal(countInvoiceCards(c.container), 5, "collapsing returns to the capped view");
  } finally {
    c.cleanup();
  }
});

test("a short invoice list renders no toggle", async () => {
  const invoices = Array.from({ length: 5 }, (_, i) => inv(i + 1));
  const c = await mountBilling(summary(invoices));
  try {
    assert.equal(countInvoiceCards(c.container), 5, "all invoices render");
    assert.equal(
      findByTestId(c.container, "button-toggle-all-invoices"),
      null,
      "no toggle when the list is at or below the cap",
    );
  } finally {
    c.cleanup();
  }
});
