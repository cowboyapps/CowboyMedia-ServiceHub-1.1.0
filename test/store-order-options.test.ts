import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for STEP 2 of the "Order a new product" flow
// (AddProductFlow in client/src/pages/my-services-page.tsx). Task #528 locked in
// step 1 (catalogue search + category chips); this locks in the configure +
// validate handoff that follows tapping a product card:
//   - selecting a single-term product auto-picks that term (Continue is live,
//     the running estimate shows); a multi-term product leaves the term unset
//     so Continue stays disabled until the customer chooses one
//   - the client-side required check (missingRequired) blocks "Continue to
//     payment" and surfaces the right message for a missing required config
//     option AND a missing required custom field, and no order is POSTed until
//     every required field is filled
//   - the running "Estimated total" label updates live as a config option /
//     billing term changes
// The pure pricing maths (computeOrderEstimate / startingPriceLabel) is unit
// tested in shared/store-estimate.test.ts; this exercises the wiring in the
// real component. The catalogue lives inside a dialog that only mounts
// AddProductFlow when the active-services section is live + linked, so the page
// is mounted with a configured/linked payload and the dialog opened by click.

// --- jsdom globals + polyfills (mirrors test/store-catalogue-filter.test.ts)
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  pretendToBeVisual: true,
  url: "http://localhost/my-services",
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

// Radix Select/Dialog poke at pointer-capture + scrollIntoView, which jsdom
// doesn't implement — stub them so opening a <Select> and picking a term works.
interface PointerCapableProto {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
}
const HEProto = window.HTMLElement.prototype as unknown as PointerCapableProto;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};

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

// openBlankTab() calls window.open before the order mutation runs; jsdom logs a
// "Not implemented" error for it, so stub it to a silent no-op returning null.
w.open = () => null;

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

// Route the catalogue endpoint to the product under test (it refetches on every
// dialog open: staleTime:0 + refetchOnMount:"always"); record any order POSTs so
// the required-field tests can assert the handoff is blocked until valid.
let catalogue: unknown = jsonResponse({});
const orderPosts: unknown[] = [];
g.fetch = (async (url: unknown, init?: { method?: string; body?: string }) => {
  const u = String(url);
  if (u.includes("/api/billing/store-products")) return catalogue;
  if (u.includes("/api/billing/store-order")) {
    orderPosts.push(init?.body ? JSON.parse(init.body) : null);
    return jsonResponse({ message: "Order placed", invoiceId: null });
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
const { QueryClientProvider } = await import("@tanstack/react-query");
const { queryClient } = await import("../client/src/lib/queryClient");
const { AuthProvider } = await import("../client/src/lib/auth");
const { useToast } = await import("../client/src/hooks/use-toast");
const MyServicesPage = (await import("../client/src/pages/my-services-page")).default;

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
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await sleep(0);
    });
  }
}

function findByTestId(root: ParentNode, id: string): Element | null {
  return root.querySelector(`[data-testid="${id}"]`);
}

// Mirror the shared toast store so the required-field block can be asserted
// without rendering the Radix Toaster. Newest toast is index 0.
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

const LINKED_ACTIVE = {
  configured: true,
  enabled: true,
  linked: true,
  unreachable: false,
  services: [],
};
const NOT_WIRED_MON = {
  configured: false,
  enabled: false,
  linked: false,
  unreachable: false,
  services: [],
};

interface FixtureCycle {
  cycle: string;
  label: string;
  price: string;
  setupFee?: string | null;
}
interface FixtureChoice {
  id: number;
  name: string;
  prices?: Record<string, string>;
}
interface FixtureConfigOption {
  id: number;
  name: string;
  type: "dropdown" | "radio" | "yesno" | "quantity";
  required: boolean;
  choices: FixtureChoice[];
}
interface FixtureCustomField {
  id: number;
  name: string;
  fieldType: string;
  required: boolean;
  options?: string[];
}
interface FixtureProduct {
  pid: number;
  name: string;
  currency?: string | null;
  cycles: FixtureCycle[];
  configOptions?: FixtureConfigOption[];
  customFields?: FixtureCustomField[];
}

function makeCatalogue(products: FixtureProduct[]) {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    hasGateway: true,
    products: products.map((p, i) => ({
      pid: p.pid,
      name: p.name,
      description: "",
      imageUrl: null,
      images: [],
      category: null,
      sortOrder: i + 1,
      currency: p.currency ?? "USD",
      cycles: p.cycles.map((c) => ({
        cycle: c.cycle,
        label: c.label,
        price: c.price,
        setupFee: c.setupFee ?? null,
      })),
      configOptions: (p.configOptions ?? []).map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        required: o.required,
        choices: o.choices.map((ch) => ({ id: ch.id, name: ch.name, prices: ch.prices ?? {} })),
      })),
      customFields: (p.customFields ?? []).map((f) => ({
        id: f.id,
        name: f.name,
        description: "",
        fieldType: f.fieldType,
        required: f.required,
        options: f.options ?? [],
      })),
    })),
  };
}

interface MountResult {
  root: Root;
  cleanup: () => void;
}

// Mount the page and open the "Order a new product" dialog so the catalogue
// grid is on screen, ready for a card tap.
async function mountFlow(products: FixtureProduct[]): Promise<MountResult> {
  catalogue = jsonResponse(makeCatalogue(products));

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/my/services"], LINKED_ACTIVE);
  queryClient.setQueryData(["/api/my/whmcs-services"], NOT_WIRED_MON);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(ToastProbe),
      React.createElement(AuthProvider, null, React.createElement(MyServicesPage)),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  const openBtn = findByTestId(container, "button-open-add-product") as HTMLButtonElement | null;
  assert.ok(openBtn, "the 'Order new product' button renders for a linked account");
  await act(async () => {
    openBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();

  return {
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
      toasts = [];
      orderPosts.length = 0;
    },
  };
}

const body = () => window.document.body;

async function clickTestId(id: string): Promise<void> {
  const el = findByTestId(body(), id) as HTMLElement | null;
  assert.ok(el, `element ${id} is present to click`);
  await act(async () => {
    el!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

// Drive a controlled <input> the way React expects (native setter + bubbling
// input event) so onChange fires.
async function typeInto(id: string, value: string): Promise<void> {
  const input = findByTestId(body(), id) as HTMLInputElement | null;
  assert.ok(input, `input ${id} is present`);
  const proto = window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input!.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flushFrames();
}

// Open a Radix <Select> by its trigger test id, then pick the option by its test
// id. Radix selects on pointerup, so dispatch the full pointer sequence.
async function pickFromSelect(triggerId: string, optionId: string): Promise<void> {
  const trigger = findByTestId(body(), triggerId) as HTMLElement | null;
  assert.ok(trigger, `select trigger ${triggerId} is present`);
  await act(async () => {
    trigger!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    trigger!.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, button: 0 }));
    trigger!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();

  const opt = findByTestId(body(), optionId) as HTMLElement | null;
  assert.ok(opt, `select option ${optionId} is present once the menu is open`);
  await act(async () => {
    opt!.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true }));
    opt!.dispatchEvent(new window.PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    opt!.dispatchEvent(new window.PointerEvent("pointerup", { bubbles: true, button: 0 }));
    opt!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

function estimateTotalText(): string | null {
  const el = findByTestId(body(), "text-order-estimate-total");
  return el ? el.textContent!.replace(/\s+/g, " ").trim() : null;
}

test("a single-term product auto-picks its term; Continue is live and the estimate shows", async () => {
  const c = await mountFlow([
    { pid: 1, name: "One-and-done", cycles: [{ cycle: "monthly", label: "Monthly", price: "10.00" }] },
  ]);
  try {
    await clickTestId("card-store-product-1");

    const confirm = findByTestId(body(), "button-confirm-add-product") as HTMLButtonElement | null;
    assert.ok(confirm, "Continue button renders once a product is chosen");
    assert.equal(confirm!.disabled, false, "the lone term is auto-picked, so Continue is enabled");
    assert.ok(findByTestId(body(), "group-order-estimate"), "the running estimate shows with the term picked");
  } finally {
    c.cleanup();
  }
});

test("a multi-term product leaves the term unset so Continue stays disabled until chosen", async () => {
  const c = await mountFlow([
    {
      pid: 2,
      name: "Pick a plan",
      cycles: [
        { cycle: "monthly", label: "Monthly", price: "10.00" },
        { cycle: "annually", label: "Annually", price: "100.00" },
      ],
    },
  ]);
  try {
    await clickTestId("card-store-product-2");

    const confirm = findByTestId(body(), "button-confirm-add-product") as HTMLButtonElement | null;
    assert.ok(confirm, "Continue button renders for a multi-term product");
    assert.equal(confirm!.disabled, true, "with no term chosen Continue is disabled");
    assert.equal(findByTestId(body(), "group-order-estimate"), null, "no estimate until a term is chosen");
    assert.ok(findByTestId(body(), "select-store-cycle"), "the billing-term picker is offered");

    // Choosing a term unblocks Continue and reveals the estimate.
    await pickFromSelect("select-store-cycle", "option-store-cycle-monthly");
    assert.equal(
      (findByTestId(body(), "button-confirm-add-product") as HTMLButtonElement).disabled,
      false,
      "picking a term enables Continue",
    );
    assert.ok(findByTestId(body(), "group-order-estimate"), "the estimate appears once a term is chosen");
  } finally {
    c.cleanup();
  }
});

test("the required check blocks Continue and names each missing field in turn", async () => {
  const c = await mountFlow([
    {
      pid: 3,
      name: "Needs details",
      cycles: [{ cycle: "monthly", label: "Monthly", price: "10.00" }],
      configOptions: [
        { id: 50, name: "Seats", type: "quantity", required: true, choices: [{ id: 500, name: "Seat", prices: { monthly: "5.00" } }] },
      ],
      customFields: [{ id: 60, name: "Domain name", fieldType: "text", required: true }],
    },
  ]);
  try {
    await clickTestId("card-store-product-3");

    // Nothing filled → blocked on the required config option.
    await clickTestId("button-confirm-add-product");
    assert.equal(orderPosts.length, 0, "no order is POSTed while a required field is empty");
    assert.equal(toasts[0]?.variant, "destructive", "the block surfaces a destructive toast");
    assert.equal(toasts[0]?.title, "Almost there", "the required-field toast title");
    assert.equal(
      toasts[0]?.description,
      'Please enter a quantity for "Seats".',
      "the message names the missing required config option",
    );

    // Fill the config option → now blocked on the required custom field.
    await typeInto("input-config-50", "3");
    await clickTestId("button-confirm-add-product");
    assert.equal(orderPosts.length, 0, "still no order — the custom field is required");
    assert.equal(
      toasts[0]?.description,
      'Please fill in "Domain name".',
      "the message moves on to the missing required custom field",
    );

    // Fill everything → the handoff finally fires with the chosen values.
    await typeInto("input-custom-60", "example.com");
    await clickTestId("button-confirm-add-product");
    assert.equal(orderPosts.length, 1, "the order is POSTed once every required field is filled");
    const payload = orderPosts[0] as { pid: number; billingCycle: string; configOptions: Record<string, number>; customFields: Record<string, string> };
    assert.equal(payload.pid, 3);
    assert.equal(payload.billingCycle, "monthly");
    assert.equal(payload.configOptions["50"], 3, "the quantity is carried into the order");
    assert.equal(payload.customFields["60"], "example.com", "the custom field is carried into the order");
  } finally {
    c.cleanup();
  }
});

test("the running estimate label updates as a config option and the billing term change", async () => {
  const c = await mountFlow([
    {
      pid: 4,
      name: "Live total",
      currency: "USD",
      cycles: [
        { cycle: "monthly", label: "Monthly", price: "10.00" },
        { cycle: "annually", label: "Annually", price: "100.00" },
      ],
      configOptions: [
        { id: 70, name: "Extra storage", type: "quantity", required: false, choices: [{ id: 700, name: "GB", prices: { monthly: "5.00", annually: "50.00" } }] },
      ],
    },
  ]);
  try {
    await clickTestId("card-store-product-4");

    // Pick monthly: base only.
    await pickFromSelect("select-store-cycle", "option-store-cycle-monthly");
    assert.equal(estimateTotalText(), "10.00 USD / monthly", "base monthly total before any options");

    // Add 2 units of the $5/mo option → 10 + 2*5 = 20.
    await typeInto("input-config-70", "2");
    assert.equal(estimateTotalText(), "20.00 USD / monthly", "estimate grows as the config option changes");

    // Switch the billing term to annually → base 100 + 2*50 = 200.
    await pickFromSelect("select-store-cycle", "option-store-cycle-annually");
    assert.equal(estimateTotalText(), "200.00 USD / annually", "estimate re-prices when the term changes");
  } finally {
    c.cleanup();
  }
});
