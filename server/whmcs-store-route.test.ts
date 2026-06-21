import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createListStoreProductsHandler,
  createPlaceProductOrderHandler,
  validateStoreOrderInputs,
  type StoreRouteDeps,
} from "./whmcs-store-route";
import type { StoreCatalogueData, StoreCatalogueProduct, PaymentMethodsData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level + pure-validator tests for the customer storefront endpoints:
//   GET  /api/billing/store-products
//   POST /api/billing/store-order
//
// These exercise the PRODUCTION handler factories (wired into routes.ts) with
// the catalogue loader / payment-method loader / AddOrder writer injected so no
// live WHMCS is touched. Contracts mirror the in-app ordering route:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user only;
//      unlinked staff are blocked.
//   2. Validity — the product, cycle, config options and custom fields are all
//      validated against the live curated catalogue before any write.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the new invoice id + pay URL are returned and the validated
//      option/custom maps are forwarded to AddOrder.

function catalogueProduct(over: Partial<StoreCatalogueProduct> = {}): StoreCatalogueProduct {
  return {
    pid: 10,
    name: "Starter VPS",
    description: "",
    imageUrl: null,
    category: "Hosting",
    sortOrder: 0,
    currency: "USD",
    cycles: [
      { cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null },
      { cycle: "annually", label: "Annually", price: "100.00", setupFee: null },
    ],
    configOptions: [],
    customFields: [],
    ...over,
  };
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  catalogue?: StoreCatalogueData;
  loadPaymentMethods?: StoreRouteDeps["loadPaymentMethods"];
  addOrder?: StoreRouteDeps["addOrder"];
  recordPendingOrder?: StoreRouteDeps["recordPendingOrder"];
}

function okMethods(): StoreRouteDeps["loadPaymentMethods"] {
  return async (): Promise<PaymentMethodsData> => ({ methods: [{ module: "stripe", displayName: "Stripe" }], unreachable: false });
}

function makeDeps(opts: AppOpts): StoreRouteDeps {
  return {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadStoreCatalogue: async () => opts.catalogue ?? { products: [catalogueProduct()], unreachable: false },
    loadPaymentMethods: opts.loadPaymentMethods ?? okMethods(),
    addOrder: opts.addOrder,
    recordPendingOrder: opts.recordPendingOrder,
  };
}

function makeApp(opts: AppOpts) {
  const deps = makeDeps(opts);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/billing/store-products", createListStoreProductsHandler(deps));
  app.post("/api/billing/store-order", createPlaceProductOrderHandler(deps));
  return app;
}

async function get(app: express.Express, path: string) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

async function post(app: express.Express, path: string, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

// ---- validateStoreOrderInputs (pure) ----

test("validateStoreOrderInputs: rejects missing required dropdown", () => {
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const r = validateStoreOrderInputs(product, {}, {});
  assert.equal(r.ok, false);
});

test("validateStoreOrderInputs: rejects an invalid dropdown choice", () => {
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const r = validateStoreOrderInputs(product, { "5": 999 }, {});
  assert.equal(r.ok, false);
});

test("validateStoreOrderInputs: accepts valid choice + drops zero-quantity", () => {
  const product = catalogueProduct({
    configOptions: [
      { id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] },
      { id: 6, name: "Extra IPs", type: "quantity", required: false, choices: [] },
    ],
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const r = validateStoreOrderInputs(product, { "5": 51, "6": 0 }, { "1": "host.example.com" });
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.deepEqual(r.configOptions, { 5: 51 });
    assert.deepEqual(r.customFields, { 1: "host.example.com" });
  }
});

test("validateStoreOrderInputs: rejects missing required custom field", () => {
  const product = catalogueProduct({
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const r = validateStoreOrderInputs(product, {}, {});
  assert.equal(r.ok, false);
});

// ---- GET /api/billing/store-products ----

test("GET store-products: unconfigured returns configured:false, never 500", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 1 } }, hasCredentials: false });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.equal(body.configured, false);
  assert.deepEqual(body.products, []);
});

test("GET store-products: linked customer gets the catalogue + gateway flag", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 1 } } });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.linked, true);
  assert.equal(body.hasGateway, true);
  assert.equal(body.products.length, 1);
});

test("GET store-products: unreachable WHMCS yields empty (never 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 1 } },
    catalogue: { products: [], unreachable: true },
  });
  const { status, body } = await get(app, "/api/billing/store-products");
  assert.equal(status, 200);
  assert.deepEqual(body.products, []);
});

test("GET store-products: unlinked staff are blocked", async () => {
  const app = makeApp({ sessionUserId: "s1", users: { s1: { whmcsClientId: null, role: "admin" } } });
  const { status } = await get(app, "/api/billing/store-products");
  assert.equal(status, 403);
});

// ---- POST /api/billing/store-order ----

test("POST store-order: places the order and forwards validated config/custom maps", async () => {
  let captured: any = null;
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
    customFields: [{ id: 1, name: "Hostname", description: "", fieldType: "text", required: true, options: [] }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (input): Promise<WhmcsRawFetch> => {
      captured = input;
      return { ok: true, data: { invoiceid: 777 } };
    },
  });
  const { status, body } = await post(app, "/api/billing/store-order", {
    pid: 10,
    billingCycle: "monthly",
    configOptions: { "5": 51 },
    customFields: { "1": "host.example.com" },
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invoiceId, 777);
  assert.equal(captured.clientId, 42);
  assert.deepEqual(captured.configOptions, { 5: 51 });
  assert.deepEqual(captured.customFields, { 1: "host.example.com" });
});

test("POST store-order: unknown product/cycle is 404", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 42 } } });
  const { status } = await post(app, "/api/billing/store-order", { pid: 999, billingCycle: "monthly" });
  assert.equal(status, 404);
});

test("POST store-order: missing required option is 400 and never writes", async () => {
  let wrote = false;
  const product = catalogueProduct({
    configOptions: [{ id: 5, name: "Disk", type: "dropdown", required: true, choices: [{ id: 51, name: "50 GB" }] }],
  });
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    catalogue: { products: [product], unreachable: false },
    addOrder: async (): Promise<WhmcsRawFetch> => {
      wrote = true;
      return { ok: true, data: {} };
    },
  });
  const { status } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.equal(wrote, false);
});

test("POST store-order: unlinked customer is 409", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } } });
  const { status } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 409);
});

test("POST store-order: WHMCS rejection surfaces as 400", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 42 } },
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "nope" }),
  });
  const { status, body } = await post(app, "/api/billing/store-order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
});
