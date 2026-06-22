import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the "Order a new product" catalogue filtering
// (AddProductFlow in client/src/pages/my-services-page.tsx). Task #524 added a
// live search box (case-insensitive name + description match) and category
// filter chips above the catalogue grid. This locks in:
//   - typing narrows cards by name AND description, case-insensitive, and shows
//     the "No products match your search." empty state when nothing matches
//   - selecting a category chip narrows to that group, "All" resets, and chips
//     only render when more than one category exists
// The catalogue lives inside a dialog that only mounts AddProductFlow when the
// active-services section is live + linked, so the page is mounted with a
// configured/linked active-services payload and the dialog is opened by click.

// --- jsdom globals + polyfills (mirrors test/my-services-empty-state.test.ts)
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
// refetchOnMount:"always", so priming the cache isn't enough — it always
// refetches when the dialog opens. Route that endpoint through fetch so both the
// initial load and the refetch return the catalogue under test; everything else
// resolves empty.
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

interface CatalogueProduct {
  pid: number;
  name: string;
  description: string;
  category: string | null;
}

function makeCatalogue(products: CatalogueProduct[]) {
  return {
    configured: true,
    enabled: true,
    linked: true,
    unreachable: false,
    hasGateway: true,
    products: products.map((p, i) => ({
      pid: p.pid,
      name: p.name,
      description: p.description,
      imageUrl: null,
      category: p.category,
      sortOrder: i + 1,
      currency: "USD",
      cycles: [{ cycle: "monthly", price: "5.00", setupFee: null }],
      configOptions: [],
      customFields: [],
    })),
  };
}

interface MountResult {
  container: HTMLElement;
  root: Root;
  input: HTMLInputElement | null;
  cleanup: () => void;
}

// Mount the page, then open the "Order a new product" dialog so the catalogue
// grid (and its search box + chips) is on screen.
async function mountCatalogue(products: CatalogueProduct[]): Promise<MountResult> {
  catalogue = jsonResponse(makeCatalogue(products));

  const container = window.document.createElement("div");
  window.document.body.appendChild(container);

  queryClient.setQueryData(["/api/my/services"], LINKED_ACTIVE);
  queryClient.setQueryData(["/api/my/whmcs-services"], NOT_WIRED_MON);

  const Wrapper: React.FC = () =>
    React.createElement(
      QueryClientProvider,
      { client: queryClient },
      React.createElement(MyServicesPage),
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

  const input = findByTestId(window.document.body, "input-search-products") as HTMLInputElement | null;

  return {
    container,
    root,
    input,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
      queryClient.clear();
    },
  };
}

// Drive the controlled search input the way React expects: set the value via the
// native setter (bypassing React's value tracker) then dispatch a bubbling input
// event so onChange fires.
async function typeSearch(input: HTMLInputElement, value: string): Promise<void> {
  const proto = window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
  await flushFrames();
}

async function clickTestId(scope: ParentNode, id: string): Promise<void> {
  const el = findByTestId(scope, id) as HTMLElement | null;
  assert.ok(el, `element ${id} is present to click`);
  await act(async () => {
    el!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

const PRODUCTS: CatalogueProduct[] = [
  { pid: 1, name: "Cloud Backup", description: "Automatic offsite storage", category: "Hosting" },
  { pid: 2, name: "Domain Privacy", description: "Hide your WHOIS details", category: "Domains" },
  { pid: 3, name: "SSL Certificate", description: "Secure your site with encryption", category: "Security" },
];

test("search narrows cards by name (case-insensitive) and hides the rest", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    assert.ok(findByTestId(doc, "card-store-product-1"), "all cards show before searching");
    assert.ok(findByTestId(doc, "card-store-product-2"));
    assert.ok(findByTestId(doc, "card-store-product-3"));

    // Mixed case query still matches "Cloud Backup" by name.
    await typeSearch(c.input!, "ClOuD");
    assert.ok(findByTestId(doc, "card-store-product-1"), "name match survives the search");
    assert.equal(findByTestId(doc, "card-store-product-2"), null, "non-matching card is hidden");
    assert.equal(findByTestId(doc, "card-store-product-3"), null, "non-matching card is hidden");
  } finally {
    c.cleanup();
  }
});

test("search matches the product description, case-insensitive", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    // "whois" only appears in product 2's description ("Hide your WHOIS details").
    await typeSearch(c.input!, "whois");
    assert.ok(findByTestId(doc, "card-store-product-2"), "description match is found");
    assert.equal(findByTestId(doc, "card-store-product-1"), null, "name-only mismatch hidden");
    assert.equal(findByTestId(doc, "card-store-product-3"), null, "name-only mismatch hidden");
  } finally {
    c.cleanup();
  }
});

test("a query that matches nothing shows the empty state", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    await typeSearch(c.input!, "no-such-product-xyz");
    assert.ok(findByTestId(doc, "text-no-products-match"), "the 'No products match' notice shows");
    assert.equal(findByTestId(doc, "card-store-product-1"), null);
    assert.equal(findByTestId(doc, "card-store-product-2"), null);
    assert.equal(findByTestId(doc, "card-store-product-3"), null);

    // Clearing the search restores the full catalogue.
    await clickTestId(doc, "button-clear-search");
    assert.equal(findByTestId(doc, "text-no-products-match"), null, "empty state clears");
    assert.ok(findByTestId(doc, "card-store-product-1"), "cards return after clearing");
  } finally {
    c.cleanup();
  }
});

test("category chip narrows to its group and 'All' resets", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    assert.ok(findByTestId(doc, "store-category-chips"), "chips render with multiple categories");

    await clickTestId(doc, "chip-category-Hosting");
    assert.ok(findByTestId(doc, "card-store-product-1"), "Hosting card stays");
    assert.equal(findByTestId(doc, "card-store-product-2"), null, "Domains card hidden");
    assert.equal(findByTestId(doc, "card-store-product-3"), null, "Security card hidden");

    await clickTestId(doc, "chip-category-all");
    assert.ok(findByTestId(doc, "card-store-product-1"), "All restores every card");
    assert.ok(findByTestId(doc, "card-store-product-2"));
    assert.ok(findByTestId(doc, "card-store-product-3"));
  } finally {
    c.cleanup();
  }
});

test("category chips are hidden when only one category exists", async () => {
  const c = await mountCatalogue([
    { pid: 10, name: "Starter Plan", description: "Entry tier", category: "Hosting" },
    { pid: 11, name: "Pro Plan", description: "More power", category: "Hosting" },
  ]);
  try {
    const doc = window.document.body;
    assert.ok(findByTestId(doc, "card-store-product-10"), "catalogue renders");
    assert.equal(
      findByTestId(doc, "store-category-chips"),
      null,
      "no chip row when there's nothing to switch between",
    );
  } finally {
    c.cleanup();
  }
});
