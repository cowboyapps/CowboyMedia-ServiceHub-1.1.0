import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the "Payment received" confirmation banner and
// the return-from-pay auto-refresh loop in client/src/components/billing-summary.tsx.
// The settlement math (classifyPaymentSettlement) is unit-tested separately in
// test/billing-payment-confirmation.test.ts; this file locks in the *UI* wiring:
//   - clicking a pay link arms the refresh, and the first focus back into the tab
//     forces a billing refresh, compares before/after, and surfaces the banner
//   - the banner copy differs for a fully-cleared balance vs a partial payment
//   - the dismiss button (button-dismiss-payment-confirmation) clears the banner
//   - nothing settling leaves no banner at all (no false positive)

// --- jsdom globals + polyfills (mirrors test/chat-composer.test.ts)
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

// Opening WHMCS's hosted checkout is fire-and-forget; give openWhmcsPay a tab to
// redirect so the click handler that arms the refresh doesn't blow up.
g.open = () => ({ location: { href: "" }, opener: null } as unknown as Window);
w.open = g.open;

g.IS_REACT_ACT_ENVIRONMENT = true;

// --- A minimal Response-like the fetch stub returns; apiRequest only needs
// `ok` + `json`/`text`/`headers.get` and never sees a non-2xx here.
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

// When POST /api/billing/refresh is hit we drop `afterDataForRefresh` into the
// singleton cache, simulating the server returning the freshly-settled billing
// payload the focus handler then reads back via getQueryData.
let afterDataForRefresh: BillingSummary | undefined;

g.fetch = (async (url: unknown) => {
  const u = String(url);
  if (u.includes("/api/billing/refresh")) {
    if (afterDataForRefresh !== undefined) {
      queryClient.setQueryData(["/api/billing"], afterDataForRefresh);
    }
    return jsonResponse({ ok: true });
  }
  // pay-link / pay-all-link SSO mint and anything else: harmless empty body.
  return jsonResponse({});
}) as unknown as typeof fetch;
w.fetch = g.fetch;

// --- Dynamic imports so jsdom globals are installed before React evaluates.
const React = await import("react");
// billing-summary.tsx imports only named hooks (not React itself); under the
// classic JSX transform the free `React` identifier must resolve to a global.
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

function inv(id: number, status: InvoiceStatus, total = "10.00"): BillingInvoice {
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
  };
}

function summary(invoices: BillingInvoice[], payAllTotal: string | null): BillingSummary {
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
    // A non-null url is required for the "Pay all outstanding" card (and its
    // pay link, which arms the refresh) to render.
    payAll: payAllTotal == null
      ? null
      : { count: invoices.length, total: payAllTotal, currencyCode: "USD", url: "https://wh.example/pay" },
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

  // The focus refresh reads/writes the singleton queryClient directly, so use it
  // as the provider client too — keeps the cache the component sees consistent.
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

  return {
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      afterDataForRefresh = undefined;
    },
  };
}

// Click the "Pay all outstanding" link to arm the refresh (markPayClicked), then
// fire the window focus event the way the browser does when the customer returns
// from WHMCS's hosted checkout tab.
async function payThenReturn(c: MountResult, settleWaitMs: number): Promise<void> {
  const payLink = findByTestId(c.container, "link-pay-all-outstanding");
  assert.ok(payLink instanceof window.HTMLAnchorElement, "pay-all link rendered");
  await act(async () => {
    (payLink as HTMLAnchorElement).click();
  });
  await act(async () => {
    window.dispatchEvent(new window.Event("focus"));
    await sleep(settleWaitMs);
  });
  await flushFrames();
}

test("focus after paying shows the fully-cleared confirmation banner", async () => {
  const before = summary([inv(1, "unpaid")], "$10.00 USD");
  afterDataForRefresh = summary([inv(1, "paid")], null);
  const c = await mountBilling(before);
  try {
    assert.equal(
      findByTestId(c.container, "card-payment-confirmation"),
      null,
      "no banner before returning from pay",
    );

    await payThenReturn(c, 50);

    const banner = findByTestId(c.container, "card-payment-confirmation");
    assert.ok(banner, "banner appears after the focus-triggered refresh");
    assert.match(
      findByTestId(c.container, "text-payment-confirmation-title")?.textContent ?? "",
      /Payment received/,
      "headline confirms the payment",
    );
    assert.match(
      findByTestId(c.container, "text-payment-confirmation-description")?.textContent ?? "",
      /all paid up/i,
      "fully-cleared copy when nothing is left owing",
    );
  } finally {
    c.cleanup();
  }
});

test("focus after a partial payment shows the still-owing confirmation banner", async () => {
  const before = summary([inv(1, "unpaid"), inv(2, "unpaid")], "$20.00 USD");
  afterDataForRefresh = summary([inv(1, "paid"), inv(2, "unpaid")], "$10.00 USD");
  const c = await mountBilling(before);
  try {
    await payThenReturn(c, 50);

    assert.ok(
      findByTestId(c.container, "card-payment-confirmation"),
      "banner appears for a partial payment too",
    );
    assert.match(
      findByTestId(c.container, "text-payment-confirmation-description")?.textContent ?? "",
      /outstanding balance/i,
      "partial copy tells the customer they still owe",
    );
  } finally {
    c.cleanup();
  }
});

test("dismiss button clears the payment confirmation banner", async () => {
  const before = summary([inv(1, "unpaid")], "$10.00 USD");
  afterDataForRefresh = summary([inv(1, "paid")], null);
  const c = await mountBilling(before);
  try {
    await payThenReturn(c, 50);
    assert.ok(findByTestId(c.container, "card-payment-confirmation"), "banner shown");

    const dismiss = findByTestId(c.container, "button-dismiss-payment-confirmation");
    assert.ok(dismiss instanceof window.HTMLButtonElement, "dismiss button present");
    await act(async () => {
      (dismiss as HTMLButtonElement).click();
    });
    await flushFrames();

    assert.equal(
      findByTestId(c.container, "card-payment-confirmation"),
      null,
      "banner is gone after dismiss",
    );
  } finally {
    c.cleanup();
  }
});

test("no banner when the refresh finds nothing settled (no false positive)", async () => {
  const before = summary([inv(1, "unpaid")], "$10.00 USD");
  // Refresh returns the same outstanding state — nothing actually paid.
  afterDataForRefresh = summary([inv(1, "unpaid")], "$10.00 USD");
  const c = await mountBilling(before);
  try {
    // The handler retries 3x with a ~1.5s backoff before giving up; wait it out
    // so this asserts "ran and found nothing", not "didn't run yet".
    await payThenReturn(c, 3400);

    assert.equal(
      findByTestId(c.container, "card-payment-confirmation"),
      null,
      "nothing settled -> no confirmation banner",
    );
  } finally {
    c.cleanup();
  }
});
