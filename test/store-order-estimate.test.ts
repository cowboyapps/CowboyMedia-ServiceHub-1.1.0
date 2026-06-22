import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the live "Estimated total" line in the customer
// "Order a new product" flow (AddProductFlow step 2 in
// client/src/pages/my-services-page.tsx). The pure maths (computeOrderEstimate /
// priceForCycle) is unit tested in shared/store-estimate.test.ts; this locks in
// the React glue that feeds it:
//   - the figure stays hidden until a billing term is chosen (cycleOpt null)
//   - it reflects the selected billing cycle and every selected config option
//     (dropdown, yes/no switch, quantity) and updates as each one changes
//   - switching the billing cycle re-prices the base + options and surfaces the
//     one-off setup fee on its own line
//   - it disappears when a *present* option price can't be parsed
//     (estimate.complete === false) rather than show a wrong number
// AddProductFlow only mounts when the active-services section is live + linked,
// so the page is primed with a configured/linked payload and the dialog opened
// by click, exactly as test/store-catalogue-sort.test.ts does.

// --- jsdom globals + polyfills (mirrors test/store-catalogue-sort.test.ts)
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

// Radix Select touches a few DOM APIs jsdom omits; stub them so opening a
// trigger (and Dialog's Escape-to-close) never throws.
interface HEStub {
  hasPointerCapture?: (pointerId: number) => boolean;
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
  scrollIntoView?: () => void;
}
const HEProto = window.HTMLElement.prototype as unknown as HEStub;
HEProto.hasPointerCapture ??= () => false;
HEProto.setPointerCapture ??= () => {};
HEProto.releasePointerCapture ??= () => {};
HEProto.scrollIntoView ??= () => {};

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

// The catalogue query (/api/billing/store-products) uses staleTime:0 +
// refetchOnMount:"always", so it always refetches when the dialog opens. Route
// that endpoint through fetch so both the initial load and the refetch return
// the catalogue under test; everything else resolves empty.
let catalogue: unknown = jsonResponse({});
g.fetch = (async (url: unknown) => {
  if (String(url).includes("/api/billing/store-products")) return catalogue;
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

interface TestChoice {
  id: number;
  name: string;
  prices?: Record<string, string>;
}
interface TestConfigOption {
  id: number;
  name: string;
  type: "dropdown" | "radio" | "yesno" | "quantity";
  required: boolean;
  choices: TestChoice[];
}
interface TestCycle {
  cycle: string;
  label: string;
  price: string;
  setupFee: string | null;
}
interface TestProduct {
  pid: number;
  name: string;
  category: string | null;
  cycles: TestCycle[];
  configOptions: TestConfigOption[];
}

function makeCatalogue(products: TestProduct[]) {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    hasGateway: true,
    products: products.map((p, i) => ({
      pid: p.pid,
      name: p.name,
      description: `${p.name} description`,
      imageUrl: null,
      images: [],
      category: p.category,
      sortOrder: i + 1,
      currency: "USD",
      cycles: p.cycles,
      configOptions: p.configOptions,
      customFields: [],
    })),
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  cleanup: () => void;
}

// Mount the page, then open the "Order a new product" dialog so the catalogue
// grid (step 1) is on screen.
async function mountCatalogue(products: TestProduct[]): Promise<MountResult> {
  catalogue = jsonResponse(makeCatalogue(products));

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/my/services"], LINKED_ACTIVE);
  queryClient.setQueryData(["/api/my/whmcs-services"], NOT_WIRED_MON);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
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
    container,
    root,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

// Step 1 → step 2: tap a catalogue card to select the product.
async function selectCard(pid: number): Promise<void> {
  const card = findByTestId(window.document.body, `card-store-product-${pid}`) as HTMLElement | null;
  assert.ok(card, `the catalogue card for product ${pid} renders`);
  await act(async () => {
    card!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

// Drive a Radix Select the way a mouse user does: a primary-button mouse
// pointerdown on the trigger opens it (Radix only opens for pointerType
// "mouse"), mounting the items in the portal; a click on the item runs its
// handleSelect and fires onValueChange. (Pattern copied from
// test/store-catalogue-sort.test.ts.)
async function pickFromSelect(triggerTestId: string, optionTestId: string): Promise<void> {
  const trigger = findByTestId(window.document.body, triggerTestId) as HTMLElement | null;
  assert.ok(trigger, `the "${triggerTestId}" select trigger is present`);
  await act(async () => {
    trigger!.dispatchEvent(
      new window.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerType: "mouse",
      }),
    );
  });
  await flushFrames();

  const item = findByTestId(window.document.body, optionTestId) as HTMLElement | null;
  assert.ok(item, `the "${optionTestId}" option is present once the menu opens`);
  await act(async () => {
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flushFrames();
}

// Click a Radix Switch (yes/no config option) to toggle it.
async function toggleSwitch(testId: string): Promise<void> {
  const sw = findByTestId(window.document.body, testId) as HTMLElement | null;
  assert.ok(sw, `the "${testId}" switch is present`);
  await act(async () => {
    sw!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

// Type into a controlled <Input> by going through the native value setter so
// React's onChange sees the new value (the standard jsdom controlled-input
// trick).
async function typeQuantity(testId: string, value: string): Promise<void> {
  const input = findByTestId(window.document.body, testId) as HTMLInputElement | null;
  assert.ok(input, `the "${testId}" quantity input is present`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    setter.call(input, value);
    input!.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flushFrames();
}

// Trimmed text of the running-estimate total line, or null when it's hidden.
function estimateTotal(): string | null {
  const el = findByTestId(window.document.body, "text-order-estimate-total");
  return el ? el.textContent!.trim() : null;
}
function estimateGroup(): Element | null {
  return findByTestId(window.document.body, "group-order-estimate");
}
function estimateSetup(): string | null {
  const el = findByTestId(window.document.body, "text-order-estimate-setup");
  return el ? el.textContent!.replace(/\s+/g, " ").trim() : null;
}

// A product with two billing terms (annually carries a setup fee) and one of
// every priced option kind, so each control's contribution to the estimate can
// be exercised.
const PRICED_PRODUCT: TestProduct = {
  pid: 1,
  name: "Configurable Hosting",
  category: "Hosting",
  cycles: [
    { cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null },
    { cycle: "annually", label: "Annually", price: "100.00", setupFee: "25.00" },
  ],
  configOptions: [
    {
      id: 7,
      name: "Disk",
      type: "dropdown",
      required: false,
      choices: [
        { id: 71, name: "Small", prices: { monthly: "5.00", annually: "50.00" } },
        { id: 72, name: "Large", prices: { monthly: "9.00", annually: "90.00" } },
      ],
    },
    {
      id: 3,
      name: "Backups",
      type: "yesno",
      required: false,
      choices: [{ id: 31, name: "Backups", prices: { monthly: "4.00", annually: "40.00" } }],
    },
    {
      id: 9,
      name: "Extra IPs",
      type: "quantity",
      required: false,
      choices: [{ id: 91, name: "IP", prices: { monthly: "2.50", annually: "25.00" } }],
    },
  ],
};

test("estimate is hidden until a billing term is chosen, then shows the cycle price", async () => {
  const c = await mountCatalogue([PRICED_PRODUCT]);
  try {
    await selectCard(1);
    // Two billing terms, so none is auto-picked → cycleOpt null → no estimate.
    assert.equal(estimateGroup(), null, "estimate stays hidden before a term is chosen");

    await pickFromSelect("select-store-cycle", "option-store-cycle-monthly");
    assert.ok(estimateGroup(), "estimate appears once a billing term is chosen");
    assert.equal(estimateTotal(), "10.00 USD / monthly", "shows just the monthly base price");
    assert.equal(estimateSetup(), null, "no setup-fee line for the monthly term");
  } finally {
    c.cleanup();
  }
});

test("estimate updates as each config option is toggled", async () => {
  const c = await mountCatalogue([PRICED_PRODUCT]);
  try {
    await selectCard(1);
    await pickFromSelect("select-store-cycle", "option-store-cycle-monthly");
    assert.equal(estimateTotal(), "10.00 USD / monthly", "base monthly price");

    // Dropdown: +9.00 → 19.00
    await pickFromSelect("select-config-7", "option-config-7-72");
    assert.equal(estimateTotal(), "19.00 USD / monthly", "dropdown option adds its price");

    // Yes/no switch on: +4.00 → 23.00
    await toggleSwitch("switch-config-3");
    assert.equal(estimateTotal(), "23.00 USD / monthly", "yes/no option adds when switched on");

    // Quantity 3 × 2.50 = 7.50 → 30.50
    await typeQuantity("input-config-9", "3");
    assert.equal(estimateTotal(), "30.50 USD / monthly", "quantity multiplies the unit price");

    // Yes/no switch back off: −4.00 → 26.50
    await toggleSwitch("switch-config-3");
    assert.equal(estimateTotal(), "26.50 USD / monthly", "turning an option off removes its price");
  } finally {
    c.cleanup();
  }
});

test("switching the billing cycle re-prices everything and surfaces the setup fee", async () => {
  const c = await mountCatalogue([PRICED_PRODUCT]);
  try {
    await selectCard(1);
    await pickFromSelect("select-store-cycle", "option-store-cycle-monthly");
    await pickFromSelect("select-config-7", "option-config-7-72");
    await toggleSwitch("switch-config-3");
    await typeQuantity("input-config-9", "3");
    assert.equal(estimateTotal(), "30.50 USD / monthly", "monthly total before switching term");

    // Annually: base 100 + disk 90 + backups 40 + 3×25 = 305.00, plus a 25.00
    // one-off setup fee surfaced on its own line.
    await pickFromSelect("select-store-cycle", "option-store-cycle-annually");
    assert.equal(
      estimateTotal(),
      "305.00 USD / annually",
      "the base price and every option re-price for the new term",
    );
    assert.equal(
      estimateSetup(),
      "+ 25.00 USD one-time setup",
      "the annual term's setup fee shows on its own line",
    );
  } finally {
    c.cleanup();
  }
});

test("estimate hides when a selected option's present price can't be parsed", async () => {
  const c = await mountCatalogue([
    {
      pid: 2,
      name: "Broken Pricing",
      category: "Hosting",
      // Single term → auto-picked on select, so the estimate shows immediately.
      cycles: [{ cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null }],
      configOptions: [
        {
          id: 8,
          name: "Mystery",
          type: "dropdown",
          required: false,
          choices: [{ id: 81, name: "Unpriced", prices: { monthly: "n/a" } }],
        },
      ],
    },
  ]);
  try {
    await selectCard(2);
    // One billing term is auto-selected, so the estimate is live right away.
    assert.equal(estimateTotal(), "10.00 USD / monthly", "estimate shows before the bad option");

    // Selecting the option whose present price is unparseable marks the estimate
    // incomplete, so the whole figure is hidden rather than show a wrong number.
    await pickFromSelect("select-config-8", "option-config-8-81");
    assert.equal(estimateGroup(), null, "estimate disappears when a present price can't be parsed");
  } finally {
    c.cleanup();
  }
});
