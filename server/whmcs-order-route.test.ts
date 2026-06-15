import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createListOrderableProductsHandler,
  createPlaceOrderHandler,
  type OrderRouteDeps,
} from "./whmcs-order-route";
import { createBillingCacheInvalidator } from "./billing-cache-invalidation";
import type { OrderableProduct, OrderableProductsData, PaymentMethodsData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the customer in-app ordering endpoints:
//   GET  /api/billing/products
//   POST /api/billing/order
//
// These exercise the PRODUCTION handler factories (wired into routes.ts), with
// the WHMCS loaders/writer injected so no live API is touched. The contracts:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user, never
//      request input; unlinked staff are blocked.
//   2. Validity — the product id + billing cycle must exist in the live catalogue
//      before any write, and a payment gateway must exist.
//   3. Never 500s — every failure degrades to a stable tagged JSON shape; on
//      success the new invoice id + a pay URL are returned.

function product(over: Partial<OrderableProduct> = {}): OrderableProduct {
  return {
    pid: 10,
    gid: 1,
    name: "Starter VPS",
    description: "",
    currency: "USD",
    cycles: [
      { cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null },
      { cycle: "annually", label: "Annually", price: "100.00", setupFee: "5.00" },
    ],
    ...over,
  };
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadOrderableProducts?: OrderRouteDeps["loadOrderableProducts"];
  loadPaymentMethods?: OrderRouteDeps["loadPaymentMethods"];
  addOrder?: OrderRouteDeps["addOrder"];
}

function makeDeps(opts: AppOpts): OrderRouteDeps {
  return {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadOrderableProducts: opts.loadOrderableProducts,
    loadPaymentMethods: opts.loadPaymentMethods,
    addOrder: opts.addOrder,
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
  app.get("/api/billing/products", createListOrderableProductsHandler(deps));
  app.post("/api/billing/order", createPlaceOrderHandler(deps));
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
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

const okCatalogue = (products: OrderableProduct[]): OrderRouteDeps["loadOrderableProducts"] =>
  async (): Promise<OrderableProductsData> => ({ products, unreachable: false });
const okMethods = (): OrderRouteDeps["loadPaymentMethods"] =>
  async (): Promise<PaymentMethodsData> => ({ methods: [{ module: "stripe", displayName: "Card" }], unreachable: false });
const noMethods = (): OrderRouteDeps["loadPaymentMethods"] =>
  async (): Promise<PaymentMethodsData> => ({ methods: [], unreachable: false });

// ---------- GET /api/billing/products ----------

test("catalogue: returns products + hasGateway for a linked customer", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
  });
  const { status, body } = await get(app, "/api/billing/products");
  assert.equal(status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.enabled, true);
  assert.equal(body.linked, true);
  assert.equal(body.hasGateway, true);
  assert.equal(body.products.length, 1);
});

test("catalogue: locked empty shape when WHMCS is unconfigured", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    hasCredentials: false,
    loadOrderableProducts: async (): Promise<OrderableProductsData> => { called = true; return { products: [], unreachable: false }; },
  });
  const { status, body } = await get(app, "/api/billing/products");
  assert.equal(status, 200);
  assert.equal(body.configured, false);
  assert.deepEqual(body.products, []);
  assert.equal(called, false);
});

test("catalogue: unlinked staff are blocked (403)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "admin" } },
    loadOrderableProducts: async (): Promise<OrderableProductsData> => { called = true; return { products: [], unreachable: false }; },
  });
  const { status, body } = await get(app, "/api/billing/products");
  assert.equal(status, 403);
  assert.equal(called, false);
  assert.equal(body.products.length, 0);
});

test("catalogue: hasGateway is false when no payment method exists", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: noMethods(),
  });
  const { body } = await get(app, "/api/billing/products");
  assert.equal(body.hasGateway, false);
});

test("catalogue: unreachable catalogue degrades to the empty shape (no 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: async (): Promise<OrderableProductsData> => ({ products: [], unreachable: true }),
    loadPaymentMethods: okMethods(),
  });
  const { status, body } = await get(app, "/api/billing/products");
  assert.equal(status, 200);
  assert.deepEqual(body.products, []);
});

// ---------- POST /api/billing/order ----------

test("order: places the order for the SESSION client and returns invoice + payUrl", async () => {
  let seenClientId = -1;
  let seenPid = -1;
  let seenCycle = "";
  let seenMethod = "";
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (input): Promise<WhmcsRawFetch> => {
      seenClientId = input.clientId;
      seenPid = input.pid;
      seenCycle = input.billingCycle;
      seenMethod = input.paymentMethod;
      return { ok: true, data: { invoiceid: 4321 } };
    },
  });
  // Attacker smuggles a foreign clientId in the body — must be ignored.
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "annually", clientid: 999 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invoiceId, 4321);
  assert.match(body.payUrl, /4321/);
  assert.equal(seenClientId, 5);
  assert.equal(seenPid, 10);
  assert.equal(seenCycle, "annually");
  assert.equal(seenMethod, "stripe");
});

test("order: rejects a product/cycle not in the catalogue (404, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  // pid 10 exists but doesn't offer "quarterly".
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "quarterly" });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("order: rejects invalid body (400, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    addOrder: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "fortnightly" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.errors);
  assert.equal(called, false);
});

test("order: unlinked staff are blocked (403, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "master_admin" } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 403);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("order: unlinked customer cannot order (409, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("order: friendly 409 when no payment gateway exists (no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: noMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.match(body.message, /payment method/i);
  assert.equal(called, false);
});

test("order: surfaces a WHMCS error as 400 with the message", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Product is out of stock" }),
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.message, /out of stock/);
});

test("order: network failure degrades to 502 (no 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 502);
  assert.equal(body.ok, false);
});

test("order: success with no invoice id still returns ok with null payUrl", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: true, data: {} }),
  });
  const { status, body } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invoiceId, null);
  assert.equal(body.payUrl, null);
});

// ---------- billing-cache invalidation wiring ----------

function makeWiredApp(opts: AppOpts) {
  const invalidated: number[] = [];
  const deps = makeDeps(opts);
  const handler = createPlaceOrderHandler(deps);
  const invalidateAfter = createBillingCacheInvalidator({
    getUser: (id: string) => Promise.resolve(opts.users[id]),
    invalidate: (clientId) => invalidated.push(clientId),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.post("/api/billing/order", async (req, res) => {
    await handler(req, res);
    await invalidateAfter(req, res);
  });
  return { app, invalidated };
}

test("order: invalidates the actor's billing cache after a successful order (200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { invoiceid: 1 } }),
  });
  const { status } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 200);
  assert.deepEqual(invalidated, [5]);
});

test("order: does NOT invalidate when the order fails (non-200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "nope" }),
  });
  const { status } = await post(app, "/api/billing/order", { pid: 10, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.deepEqual(invalidated, []);
});
