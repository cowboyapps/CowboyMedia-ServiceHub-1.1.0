import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createUpgradeOptionsHandler,
  createSubmitUpgradeHandler,
  type UpgradeRouteDeps,
} from "./whmcs-upgrade-route";
import { createBillingCacheInvalidator } from "./billing-cache-invalidation";
import type {
  ServicesListData,
  OrderableProduct,
  OrderableProductsData,
  PaymentMethodsData,
} from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the customer in-app upgrade/change-plan endpoints:
//   GET  /api/billing/services/:serviceId/upgrade-options
//   POST /api/billing/services/:serviceId/upgrade
//
// These exercise the PRODUCTION handler factories (wired into routes.ts), with
// all WHMCS loaders/writers injected so no live API is touched. The contracts:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user; the
//      target service must belong to that client and be active; unlinked staff
//      are blocked.
//   2. Validity — the chosen target must be another product in the SAME group as
//      the current one and offer the chosen cycle, before any write.
//   3. Never 500s — failures degrade to a stable tagged JSON shape; on success
//      the upgrade invoice id + a pay URL are returned.

function svc(id: number, pid = 10, status = "Active") {
  return {
    id,
    pid,
    name: `Service ${id}`,
    domain: "",
    status,
    nextDueDate: null,
    billingCycle: "Monthly",
    amount: "10.00",
    username: "",
    password: "",
  };
}

function product(pid: number, gid: number, name: string): OrderableProduct {
  return {
    pid,
    gid,
    name,
    description: "",
    currency: "USD",
    cycles: [
      { cycle: "monthly", label: "Monthly", price: `${pid}.00`, setupFee: null },
      { cycle: "annually", label: "Annually", price: `${pid}0.00`, setupFee: null },
    ],
  };
}

// Current product pid 10 + two upgrade targets in the SAME group, plus one in a
// DIFFERENT group that must never be offered or accepted.
const CATALOGUE: OrderableProduct[] = [
  product(10, 1, "Starter"),
  product(11, 1, "Pro"),
  product(12, 1, "Business"),
  product(20, 2, "Unrelated"),
];

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadServicesList?: UpgradeRouteDeps["loadServicesList"];
  loadOrderableProducts?: UpgradeRouteDeps["loadOrderableProducts"];
  loadPaymentMethods?: UpgradeRouteDeps["loadPaymentMethods"];
  calcUpgrade?: UpgradeRouteDeps["calcUpgrade"];
  submitUpgrade?: UpgradeRouteDeps["submitUpgrade"];
  getOrders?: UpgradeRouteDeps["getOrders"];
}

function makeDeps(opts: AppOpts): UpgradeRouteDeps {
  return {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    loadOrderableProducts: opts.loadOrderableProducts,
    loadPaymentMethods: opts.loadPaymentMethods,
    calcUpgrade: opts.calcUpgrade,
    submitUpgrade: opts.submitUpgrade,
    getOrders: opts.getOrders,
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
  app.get("/api/billing/services/:serviceId/upgrade-options", createUpgradeOptionsHandler(deps));
  app.post("/api/billing/services/:serviceId/upgrade", createSubmitUpgradeHandler(deps));
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

const okServices = (services: ReturnType<typeof svc>[]): UpgradeRouteDeps["loadServicesList"] =>
  async (): Promise<ServicesListData> => ({ services, unreachable: false });
const okCatalogue = (): UpgradeRouteDeps["loadOrderableProducts"] =>
  async (): Promise<OrderableProductsData> => ({ products: CATALOGUE, unreachable: false });
const okMethods = (): UpgradeRouteDeps["loadPaymentMethods"] =>
  async (): Promise<PaymentMethodsData> => ({ methods: [{ module: "stripe", displayName: "Card" }], unreachable: false });
const noMethods = (): UpgradeRouteDeps["loadPaymentMethods"] =>
  async (): Promise<PaymentMethodsData> => ({ methods: [], unreachable: false });
const noCalc = (): UpgradeRouteDeps["calcUpgrade"] =>
  async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "n/a" });

// ---------- GET upgrade-options ----------

test("options: lists same-group alternatives only, excluding the current product", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    calcUpgrade: noCalc(),
  });
  const { status, body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  const pids = body.options.map((o: any) => o.pid).sort();
  assert.deepEqual(pids, [11, 12]);
  // Different-group product 20 and the current product 10 are never offered.
  assert.ok(!pids.includes(20));
  assert.ok(!pids.includes(10));
});

test("options: includes the prorated price when WHMCS calc succeeds", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    calcUpgrade: async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { price: "7.50" } }),
  });
  const { body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.ok(body.options.every((o: any) => o.proratedPrice === "7.50"));
});

test("options: 404 for a service the caller does not own", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
  });
  const { status, body } = await get(app, "/api/billing/services/999/upgrade-options");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("options: unlinked staff blocked (403)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "admin" } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
  });
  const { status, body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.equal(status, 403);
  assert.equal(body.ok, false);
});

test("options: 409 for a non-active service", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10, "Suspended")]),
    loadOrderableProducts: okCatalogue(),
  });
  const { status, body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
});

test("options: empty set when the current product isn't in the catalogue", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 999)]),
    loadOrderableProducts: okCatalogue(),
  });
  const { status, body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.deepEqual(body.options, []);
});

test("options: 502 when the services list is unreachable", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (): Promise<ServicesListData> => ({ services: [], unreachable: true }),
    loadOrderableProducts: okCatalogue(),
  });
  const { status, body } = await get(app, "/api/billing/services/100/upgrade-options");
  assert.equal(status, 502);
  assert.equal(body.ok, false);
});

// ---------- POST upgrade ----------

test("upgrade: submits for the owned service and returns invoice + payUrl", async () => {
  let seenServiceId = -1;
  let seenPid = -1;
  let seenCycle = "";
  let seenMethod = "";
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (serviceId, pid, cycle, method): Promise<WhmcsRawFetch> => {
      seenServiceId = serviceId;
      seenPid = pid;
      seenCycle = cycle;
      seenMethod = method;
      return { ok: true, data: { invoiceid: 8888 } };
    },
  });
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "annually" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.invoiceId, 8888);
  assert.match(body.payUrl, /8888/);
  assert.equal(seenServiceId, 100);
  assert.equal(seenPid, 11);
  assert.equal(seenCycle, "annually");
  assert.equal(seenMethod, "stripe");
});

test("upgrade: resolves the invoice id via the order when not returned directly", async () => {
  let getOrdersCalledWith = -1;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { orderid: 555 } }),
    getOrders: async (orderId): Promise<WhmcsRawFetch> => {
      getOrdersCalledWith = orderId;
      return { ok: true, data: { orders: { order: [{ invoiceid: 9001 }] } } };
    },
  });
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 200);
  assert.equal(body.invoiceId, 9001);
  assert.equal(getOrdersCalledWith, 555);
});

test("upgrade: rejects a target in a different group (404, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  // pid 20 is in group 2, not the current group 1.
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 20, billingCycle: "monthly" });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("upgrade: rejects switching to the current product (404, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 10, billingCycle: "monthly" });
  assert.equal(status, 404);
  assert.equal(called, false);
});

test("upgrade: rejects a cycle the target doesn't offer (404, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "quarterly" });
  assert.equal(status, 404);
  assert.equal(called, false);
});

test("upgrade: 404 for a service the caller does not own (no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status } = await post(app, "/api/billing/services/999/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 404);
  assert.equal(called, false);
});

test("upgrade: unlinked staff blocked (403, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "master_admin" } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 403);
  assert.equal(called, false);
});

test("upgrade: friendly 409 when no payment gateway exists (no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: noMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 409);
  assert.match(body.message, /payment method/i);
  assert.equal(called, false);
});

test("upgrade: rejects invalid body (400, no write)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "weekly" });
  assert.equal(status, 400);
  assert.ok(body.errors);
  assert.equal(called, false);
});

test("upgrade: surfaces a WHMCS error as 400", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Upgrade not permitted" }),
  });
  const { status, body } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.match(body.message, /not permitted/);
});

// ---------- billing-cache invalidation wiring ----------

function makeWiredApp(opts: AppOpts) {
  const invalidated: number[] = [];
  const deps = makeDeps(opts);
  const handler = createSubmitUpgradeHandler(deps);
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
  app.post("/api/billing/services/:serviceId/upgrade", async (req, res) => {
    await handler(req, res);
    await invalidateAfter(req, res);
  });
  return { app, invalidated };
}

test("upgrade: invalidates the actor's billing cache after a successful change (200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { invoiceid: 1 } }),
  });
  const { status } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 200);
  assert.deepEqual(invalidated, [5]);
});

test("upgrade: does NOT invalidate when the change fails (non-200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okServices([svc(100, 10)]),
    loadOrderableProducts: okCatalogue(),
    loadPaymentMethods: okMethods(),
    submitUpgrade: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "nope" }),
  });
  const { status } = await post(app, "/api/billing/services/100/upgrade", { newProductId: 11, billingCycle: "monthly" });
  assert.equal(status, 400);
  assert.deepEqual(invalidated, []);
});
