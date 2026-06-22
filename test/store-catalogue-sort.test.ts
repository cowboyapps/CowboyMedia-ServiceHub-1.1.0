import { test, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// React component coverage for the "Order a new product" catalogue price sort
// (AddProductFlow in client/src/pages/my-services-page.tsx). Task #529 added a
// "Featured / Price: low to high / Price: high to low" sort that sits next to the
// search box + category chips from Task #524. The pure pricing maths is unit
// tested in shared/store-estimate.test.ts; this locks in the React glue that
// combines all three controls:
//   - "Featured" keeps the admin-curated grouped-by-category layout
//   - a price sort flattens every (search + category) match into one list
//     ordered by starting price, dropping the category headings
//   - equal-price products fall back to name order (NOT reversed for high→low)
//   - products with no parseable price sink to the bottom either direction, and
//     two unpriced products tie-break by name
//   - the sort + filters reset to Featured when the dialog closes
// The catalogue lives inside a dialog that only mounts AddProductFlow when the
// active-services section is live + linked, so the page is mounted with a
// configured/linked active-services payload and the dialog is opened by click.

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

// Radix Select touches a few DOM APIs jsdom omits; stub them so opening the
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

// The DOM order of catalogue cards within a scope, as their product ids — the
// thing a price sort actually rearranges.
function cardOrder(scope: ParentNode): number[] {
  return Array.from(scope.querySelectorAll('[data-testid^="card-store-product-"]')).map((el) =>
    Number(el.getAttribute("data-testid")!.replace("card-store-product-", "")),
  );
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
  category: string | null;
  // Bare WHMCS decimal strings; "" / "n/a" model an unparseable price (null).
  prices: string[];
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
      description: `${p.name} description`,
      imageUrl: null,
      images: [],
      category: p.category,
      sortOrder: i + 1,
      currency: "USD",
      cycles: p.prices.map((price) => ({ cycle: "monthly", price, setupFee: null })),
      configOptions: [],
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
// grid (with its sort select + chips) is on screen.
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
      React.createElement(AuthProvider, null, React.createElement(MyServicesPage)),
    );

  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Wrapper));
  });
  await flushFrames();

  await openDialog(container);

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

async function openDialog(container: ParentNode): Promise<void> {
  const openBtn = findByTestId(container, "button-open-add-product") as HTMLButtonElement | null;
  assert.ok(openBtn, "the 'Order new product' button renders for a linked account");
  await act(async () => {
    openBtn!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  });
  await flushFrames();
}

// Drive the Radix Select the way a mouse user does: a primary-button mouse
// pointerdown on the trigger opens it (Radix only opens the menu for pointerType
// "mouse"), which mounts the items in the portal; a click on the target item
// runs its handleSelect and fires onValueChange. jsdom's PointerEvent carries
// button + pointerType, so this needs no portal faking.
async function setSort(value: "featured" | "price-asc" | "price-desc"): Promise<void> {
  const trigger = findByTestId(window.document.body, "select-sort-products") as HTMLElement | null;
  assert.ok(trigger, "the sort select trigger is present");
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

  const item = findByTestId(window.document.body, `option-sort-${value}`) as HTMLElement | null;
  assert.ok(item, `the "${value}" sort option is present once the menu opens`);
  await act(async () => {
    item!.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  await flushFrames();
}

// Catalogue ordered so categories surface Hosting → Domains → Security (by first
// product's sortOrder). Prices chosen to exercise: a clear cheapest/dearest, a
// tie at 10.00 (pid 1 "Alpha" vs pid 5 "Yota"), and two unpriced products
// (pid 6 "Apple" vs pid 4 "Zeta") that must sink to the bottom and tie by name.
const PRODUCTS: CatalogueProduct[] = [
  { pid: 1, name: "Alpha Hosting", category: "Hosting", prices: ["10.00"] },
  { pid: 2, name: "Beta Domains", category: "Domains", prices: ["5.00"] },
  { pid: 3, name: "Gamma Security", category: "Security", prices: ["20.00"] },
  { pid: 5, name: "Yota Tie", category: "Domains", prices: ["10.00"] },
  { pid: 4, name: "Zeta NoPrice", category: "Hosting", prices: [""] },
  { pid: 6, name: "Apple NoPrice", category: "Security", prices: ["n/a"] },
];

test("Featured keeps the grouped-by-category layout", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    // Category headings render (grouped view), and the flat sorted grid does not.
    assert.ok(findByTestId(doc, "heading-store-category-Hosting"), "Hosting heading shows");
    assert.ok(findByTestId(doc, "heading-store-category-Domains"), "Domains heading shows");
    assert.ok(findByTestId(doc, "heading-store-category-Security"), "Security heading shows");
    assert.equal(
      findByTestId(doc, "store-catalogue-sorted"),
      null,
      "no flattened grid while Featured is selected",
    );

    // Within each group: sortOrder then name. Hosting [1,4], Domains [2,5],
    // Security [3,6]; categories in first-product order.
    assert.deepEqual(
      cardOrder(doc),
      [1, 4, 2, 5, 3, 6],
      "cards follow the admin-curated grouped order",
    );
  } finally {
    c.cleanup();
  }
});

test("Price: low to high flattens into one price-ordered list", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    await setSort("price-asc");

    const grid = findByTestId(doc, "store-catalogue-sorted");
    assert.ok(grid, "the flattened sorted grid replaces the grouped layout");
    assert.equal(
      findByTestId(doc, "heading-store-category-Hosting"),
      null,
      "category headings disappear once a price sort is active",
    );

    // 5 → 10 (Alpha before Yota by name) → 20 → unpriced (Apple before Zeta).
    assert.deepEqual(
      cardOrder(grid!),
      [2, 1, 5, 3, 6, 4],
      "ascending price, equal prices by name, unpriced last",
    );
  } finally {
    c.cleanup();
  }
});

test("Price: high to low reverses price but keeps ties + unpriced anchored", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    await setSort("price-desc");

    const grid = findByTestId(doc, "store-catalogue-sorted");
    assert.ok(grid, "the flattened sorted grid is shown");

    // 20 → 10 (Alpha still before Yota — name tie is NOT reversed) → 5 →
    // unpriced still last (Apple before Zeta).
    assert.deepEqual(
      cardOrder(grid!),
      [3, 1, 5, 2, 6, 4],
      "descending price, ties + unpriced unaffected by direction",
    );
  } finally {
    c.cleanup();
  }
});

test("a category filter + price sort compose: only that group, flattened by price", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;

    // Narrow to Domains (pid 2 @5, pid 5 @10), then sort high→low.
    const chip = findByTestId(doc, "chip-category-Domains") as HTMLElement | null;
    assert.ok(chip, "Domains chip is present");
    await act(async () => {
      chip!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    await flushFrames();
    await setSort("price-desc");

    const grid = findByTestId(doc, "store-catalogue-sorted");
    assert.ok(grid, "sorted grid shows the filtered subset");
    assert.deepEqual(
      cardOrder(grid!),
      [5, 2],
      "only Domains products, ordered high→low by price",
    );
    assert.equal(findByTestId(doc, "card-store-product-1"), null, "other categories excluded");
    assert.equal(findByTestId(doc, "card-store-product-3"), null, "other categories excluded");
  } finally {
    c.cleanup();
  }
});

test("the chosen sort is remembered when the dialog closes and reopens", async () => {
  const c = await mountCatalogue(PRODUCTS);
  try {
    const doc = window.document.body;
    await setSort("price-asc");
    assert.ok(findByTestId(doc, "store-catalogue-sorted"), "price sort is active");

    // Close the dialog (Radix Dialog closes on Escape).
    await act(async () => {
      window.document.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    await flushFrames();
    assert.equal(
      findByTestId(window.document.body, "store-catalogue-sorted"),
      null,
      "the catalogue grid is gone once the dialog closes",
    );

    // Reopen: the previously-chosen price sort survives (it no longer resets to
    // Featured), so the flattened price-ordered grid comes straight back and the
    // grouped category layout stays hidden.
    await openDialog(c.container);
    const grid = findByTestId(window.document.body, "store-catalogue-sorted");
    assert.ok(grid, "the remembered price sort is still active on reopen");
    assert.equal(
      findByTestId(window.document.body, "heading-store-category-Hosting"),
      null,
      "the grouped layout does NOT return while the remembered sort is active",
    );
    assert.deepEqual(
      cardOrder(grid!),
      [2, 1, 5, 3, 6, 4],
      "the price-ascending order is preserved across reopen",
    );
  } finally {
    c.cleanup();
  }
});
