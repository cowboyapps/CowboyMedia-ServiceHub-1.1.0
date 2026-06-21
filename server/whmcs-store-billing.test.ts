import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseStoreConfigOptions,
  parseStoreCustomFields,
  assembleStoreCatalogue,
  loadStoreCatalogue,
  type StoreCurationRow,
} from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Pure-parser + catalogue-assembly tests for the admin-curated storefront
// (Task #518). These never touch a live WHMCS — the GetProducts rows are
// hand-built and the loader's fetcher is injected. The contracts:
//   1. Config-option / custom-field parsers tolerate WHMCS's wrapper variants
//      (absent / single object / array) and yield [] when the data is missing.
//   2. assembleStoreCatalogue includes a curated product ONLY when it's enabled,
//      still exists in WHMCS, and has at least one orderable cycle; blank admin
//      overrides fall back to the live WHMCS name/description; sorted by
//      category (blank last) → sortOrder → name.
//   3. loadStoreCatalogue short-circuits (no WHMCS call) when nothing is enabled
//      and reports `unreachable` when the WHMCS read fails.

function rawProduct(over: Record<string, any> = {}): Record<string, any> {
  return {
    pid: 10,
    gid: 1,
    name: "Starter VPS",
    description: "A small VPS",
    pricing: { USD: { monthly: "10.00", annually: "100.00", msetupfee: "0.00", asetupfee: "0.00" } },
    ...over,
  };
}

test("parseStoreConfigOptions: empty / absent yields []", () => {
  assert.deepEqual(parseStoreConfigOptions({}), []);
  assert.deepEqual(parseStoreConfigOptions({ configoptions: "" }), []);
  assert.deepEqual(parseStoreConfigOptions(null), []);
});

test("parseStoreConfigOptions: parses a dropdown with sub-options", () => {
  const opts = parseStoreConfigOptions({
    configoptions: {
      configoption: {
        id: 5,
        name: "Disk size",
        type: "dropdown",
        required: "on",
        options: { option: [{ id: 51, name: "50 GB" }, { id: 52, name: "100 GB" }] },
      },
    },
  });
  assert.equal(opts.length, 1);
  assert.equal(opts[0].id, 5);
  assert.equal(opts[0].type, "dropdown");
  assert.equal(opts[0].required, true);
  assert.deepEqual(opts[0].choices, [{ id: 51, name: "50 GB" }, { id: 52, name: "100 GB" }]);
});

test("parseStoreConfigOptions: maps numeric type codes + quantity has no choices", () => {
  const opts = parseStoreConfigOptions({
    configoptions: { configoption: [{ id: 7, name: "Extra IPs", type: "4" }] },
  });
  assert.equal(opts.length, 1);
  assert.equal(opts[0].type, "quantity");
  assert.deepEqual(opts[0].choices, []);
});

test("parseStoreCustomFields: drops admin-only fields and parses dropdown options", () => {
  const fields = parseStoreCustomFields({
    customfields: {
      customfield: [
        { id: 1, name: "Hostname", type: "text", required: "on" },
        { id: 2, name: "Internal note", type: "text", adminonly: "on" },
        { id: 3, name: "Plan", type: "dropdown", options: "Basic,Pro,Max" },
      ],
    },
  });
  const ids = fields.map((f) => f.id);
  assert.ok(!ids.includes(2), "admin-only field must be dropped");
  const hostname = fields.find((f) => f.id === 1)!;
  assert.equal(hostname.required, true);
  const plan = fields.find((f) => f.id === 3)!;
  assert.deepEqual(plan.options, ["Basic", "Pro", "Max"]);
});

test("assembleStoreCatalogue: includes only enabled + present + orderable products", () => {
  const curation: StoreCurationRow[] = [
    { whmcsProductId: 10, name: "", description: "", imageUrl: null, category: "Hosting", sortOrder: 0, enabled: true },
    { whmcsProductId: 11, name: "Disabled", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: false },
    { whmcsProductId: 99, name: "Gone", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true },
  ];
  const products = assembleStoreCatalogue([rawProduct()], curation, "USD");
  assert.equal(products.length, 1);
  assert.equal(products[0].pid, 10);
  // Blank admin name falls back to the live WHMCS name.
  assert.equal(products[0].name, "Starter VPS");
  assert.equal(products[0].category, "Hosting");
});

test("assembleStoreCatalogue: admin overrides win; sorts category (blank last) → sortOrder → name", () => {
  const raws = [
    rawProduct({ pid: 10, name: "Alpha" }),
    rawProduct({ pid: 11, name: "Bravo" }),
    rawProduct({ pid: 12, name: "Charlie" }),
  ];
  const curation: StoreCurationRow[] = [
    { whmcsProductId: 12, name: "No category", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true },
    { whmcsProductId: 11, name: "Second", description: "", imageUrl: null, category: "Apps", sortOrder: 2, enabled: true },
    { whmcsProductId: 10, name: "First", description: "Custom blurb", imageUrl: "/uploads/x.png", category: "Apps", sortOrder: 1, enabled: true },
  ];
  const products = assembleStoreCatalogue(raws, curation, "USD");
  assert.deepEqual(products.map((p) => p.pid), [10, 11, 12]);
  assert.equal(products[0].name, "First");
  assert.equal(products[0].description, "Custom blurb");
  assert.equal(products[0].imageUrl, "/uploads/x.png");
  // Blank-category product sorts last.
  assert.equal(products[2].category, null);
});

test("assembleStoreCatalogue: a one-time product bills as a single 'onetime' charge, not monthly", () => {
  // WHMCS stores the one-off price in the `monthly` field; paytype marks it as
  // one-time. The storefront must surface that as a single charge.
  const raw = rawProduct({
    pid: 20,
    name: "Setup Fee",
    paytype: "onetime",
    pricing: { USD: { monthly: "25.00", msetupfee: "5.00", annually: "-1.00" } },
  });
  const curation: StoreCurationRow[] = [
    { whmcsProductId: 20, name: "", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true },
  ];
  const products = assembleStoreCatalogue([raw], curation, "USD");
  assert.equal(products.length, 1);
  assert.deepEqual(products[0].cycles, [
    { cycle: "onetime", label: "One-time", price: "25.00", setupFee: "5.00" },
  ]);
});

test("assembleStoreCatalogue: a free product bills as a single 'free' charge", () => {
  const raw = rawProduct({
    pid: 21,
    name: "Free Trial",
    paytype: "free",
    pricing: { USD: { monthly: "0.00" } },
  });
  const curation: StoreCurationRow[] = [
    { whmcsProductId: 21, name: "", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true },
  ];
  const products = assembleStoreCatalogue([raw], curation, "USD");
  assert.equal(products.length, 1);
  assert.deepEqual(products[0].cycles, [
    { cycle: "free", label: "Free", price: "0.00", setupFee: null },
  ]);
});

test("assembleStoreCatalogue: a one-time product with no usable price is dropped (fail closed)", () => {
  // monthly disabled ("-1.00"), no `onetime` key, and we deliberately do NOT fall
  // back to recurring fields — so there's no one-off price and the product is
  // dropped rather than shown with a misleading recurring price.
  const raw = rawProduct({
    pid: 22,
    paytype: "onetime",
    pricing: { USD: { monthly: "-1.00", annually: "100.00" } },
  });
  const curation: StoreCurationRow[] = [
    { whmcsProductId: 22, name: "", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true },
  ];
  const products = assembleStoreCatalogue([raw], curation, "USD");
  assert.deepEqual(products, []);
});

test("loadStoreCatalogue: no enabled rows short-circuits without a WHMCS call", async () => {
  let called = false;
  const fetcher = async (): Promise<WhmcsRawFetch> => {
    called = true;
    return { ok: true, data: { products: { product: [] } } };
  };
  const r = await loadStoreCatalogue(
    [{ whmcsProductId: 10, name: "", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: false }],
    fetcher,
  );
  assert.equal(called, false);
  assert.equal(r.unreachable, false);
  assert.deepEqual(r.products, []);
});

test("loadStoreCatalogue: WHMCS read failure reports unreachable", async () => {
  const fetcher = async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "down" });
  const r = await loadStoreCatalogue(
    [{ whmcsProductId: 10, name: "", description: "", imageUrl: null, category: null, sortOrder: 0, enabled: true }],
    fetcher,
  );
  assert.equal(r.unreachable, true);
  assert.deepEqual(r.products, []);
});

test("loadStoreCatalogue: merges live products on a reachable read", async () => {
  const fetcher = async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { products: { product: [rawProduct()] } } });
  const r = await loadStoreCatalogue(
    [{ whmcsProductId: 10, name: "Shiny", description: "", imageUrl: null, category: "Hosting", sortOrder: 0, enabled: true }],
    fetcher,
    "USD",
  );
  assert.equal(r.unreachable, false);
  assert.equal(r.products.length, 1);
  assert.equal(r.products[0].name, "Shiny");
});
