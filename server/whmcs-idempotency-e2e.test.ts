import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createIdempotencyMiddleware, __resetIdempotencyStore } from "./idempotency";
import {
  createPlaceOrderHandler,
  type OrderRouteDeps,
  type OrderableProduct,
} from "./whmcs-order-route";
import {
  createRequestCancellationHandler,
  type CancelRouteDeps,
} from "./whmcs-cancel-route";
import type { OrderableProductsData, PaymentMethodsData, ServicesListData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// End-to-end money-flow idempotency test (Task #597).
//
// Task #591 unit-tested the middleware in isolation against a *synthetic*
// handler. This file proves the same guarantee through the REAL customer-flow
// code path: the production order/cancel handlers mounted behind the production
// idempotency middleware, in the SAME order routes.ts mounts them
// (requireAuth-equivalent session → idempotency → handler). Only the live WHMCS
// writer is injected (WHMCS is unreachable from the dev IP), so the request
// chain a browser submission actually triggers runs unchanged.
//
// The flow under test mirrors the real incident: a customer places an order /
// cancellation, WHMCS is slow, the browser hits its 30s timeout and ABORTS the
// socket, then the customer manually retries with the SAME Idempotency-Key. The
// assertion that matters: the underlying WHMCS write (addOrder / addCancelRequest)
// runs exactly once, and the retry replays the first response — never a second
// order/invoice or a second cancellation.

const KEY = "550e8400-e29b-41d4-a716-446655440000";

function product(over: Partial<OrderableProduct> = {}): OrderableProduct {
  return {
    pid: 10,
    gid: 1,
    name: "Starter VPS",
    description: "",
    currency: "USD",
    cycles: [{ cycle: "monthly", label: "Monthly", price: "10.00", setupFee: null }],
    ...over,
  };
}

const okCatalogue = (products: OrderableProduct[]): OrderRouteDeps["loadOrderableProducts"] =>
  async (): Promise<OrderableProductsData> => ({ products, unreachable: false });
const okMethods = (): OrderRouteDeps["loadPaymentMethods"] =>
  async (): Promise<PaymentMethodsData> => ({
    methods: [{ module: "stripe", displayName: "Card" }],
    unreachable: false,
  });

// Spin up a throwaway HTTP server for one app and hand the caller its base URL.
async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

function post(url: string, body: unknown, signal?: AbortSignal) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": KEY },
    body: JSON.stringify(body),
    signal,
  });
}

// ---------- order flow ----------

// Mount the REAL place-order handler exactly as routes.ts does: session
// (requireAuth stand-in) → billing idempotency → handler. `addOrder` is gated so
// the test can hold the WHMCS write "in flight" and abort the client during it.
function makeOrderApp(addOrder: OrderRouteDeps["addOrder"]) {
  const deps: OrderRouteDeps = {
    getWhmcsSettings: async () => ({ baseUrl: "https://billing.example.com", enabled: true }),
    getUser: async () => ({ whmcsClientId: 5 }),
    hasWhmcsCredentials: () => true,
    normalizeBaseUrl: (raw) => raw,
    loadOrderableProducts: okCatalogue([product()]),
    loadPaymentMethods: okMethods(),
    addOrder,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "u1" };
    next();
  });
  app.post("/api/billing/order", createIdempotencyMiddleware({ ttlMs: 60_000 }), createPlaceOrderHandler(deps));
  return app;
}

test("order: a 30s-timeout abort mid-write then a retry never places a second order", async () => {
  __resetIdempotencyStore();
  let orderRuns = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  // The real WHMCS write: counts invocations and blocks (slow WHMCS) so the
  // client can abort while it's in flight. Returns a fresh invoice id per run so
  // a second real run would be detectable.
  const addOrder: OrderRouteDeps["addOrder"] = async (): Promise<WhmcsRawFetch> => {
    orderRuns += 1;
    await gate;
    return { ok: true, data: { invoiceid: 7000 + orderRuns } };
  };

  await withServer(makeOrderApp(addOrder), async (baseUrl) => {
    const url = `${baseUrl}/api/billing/order`;
    const orderBody = { pid: 10, billingCycle: "monthly" };

    // 1. Customer submits; WHMCS is slow; the browser's 30s timeout aborts.
    const ac = new AbortController();
    const firstP = post(url, orderBody, ac.signal).catch((e) => ({ aborted: true, e }) as any);
    await new Promise((r) => setTimeout(r, 50)); // let it claim the key + reach the gated write
    ac.abort();
    await firstP;

    // 2. The customer retries while the original write is STILL in flight: the
    //    guard must refuse it (409), not start a second order.
    await new Promise((r) => setTimeout(r, 30));
    const inFlightRetry = await post(url, orderBody);
    assert.equal(inFlightRetry.status, 409, "a retry during the in-flight write must be refused");
    assert.equal(orderRuns, 1, "the WHMCS order write must not run a second time");

    // 3. The original (slow) write finally lands.
    release();
    await new Promise((r) => setTimeout(r, 50));

    // 4. A later retry replays the original order response — same invoice, no
    //    second order placed.
    const replay = await post(url, orderBody);
    const body = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.invoiceId, 7001, "the retry must replay the original invoice, not mint a new one");
    assert.equal(orderRuns, 1, "exactly one order was ever placed");
  });
  release();
});

test("order: a retry after the slow write already finished replays the same invoice", async () => {
  __resetIdempotencyStore();
  // The other half of the timeout race: the slow WHMCS write actually completed
  // server-side just after the browser gave up. The retry must replay it, not
  // place a second order.
  let orderRuns = 0;
  const addOrder: OrderRouteDeps["addOrder"] = async (): Promise<WhmcsRawFetch> => {
    orderRuns += 1;
    return { ok: true, data: { invoiceid: 8000 + orderRuns } };
  };

  await withServer(makeOrderApp(addOrder), async (baseUrl) => {
    const url = `${baseUrl}/api/billing/order`;
    const orderBody = { pid: 10, billingCycle: "monthly" };

    const first = await post(url, orderBody);
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.invoiceId, 8001);

    const retry = await post(url, orderBody);
    const retryBody = await retry.json();
    assert.equal(retry.status, 200);
    assert.equal(retryBody.invoiceId, 8001, "the timeout retry replays the first order");
    assert.equal(orderRuns, 1, "the order was placed exactly once");
  });
});

// ---------- cancel flow ----------

function makeCancelApp(addCancelRequest: CancelRouteDeps["addCancelRequest"]) {
  const services: ServicesListData = {
    services: [{ id: 42, pid: 10, status: "Active" } as any],
    unreachable: false,
  };
  const deps: CancelRouteDeps = {
    getWhmcsSettings: async () => ({ baseUrl: "https://billing.example.com", enabled: true }),
    getUser: async () => ({ whmcsClientId: 5 }),
    hasWhmcsCredentials: () => true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: async () => services,
    addCancelRequest,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "u1" };
    next();
  });
  app.post(
    "/api/billing/services/:serviceId/cancel",
    createIdempotencyMiddleware({ ttlMs: 60_000 }),
    createRequestCancellationHandler(deps),
  );
  return app;
}

test("cancel: a 30s-timeout abort mid-write then a retry never submits a second cancellation", async () => {
  __resetIdempotencyStore();
  let cancelRuns = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const addCancelRequest: CancelRouteDeps["addCancelRequest"] = async (): Promise<WhmcsRawFetch> => {
    cancelRuns += 1;
    await gate;
    return { ok: true, data: {} };
  };

  await withServer(makeCancelApp(addCancelRequest), async (baseUrl) => {
    const url = `${baseUrl}/api/billing/services/42/cancel`;
    const cancelBody = { type: "Immediate" };

    // 1. Submit; WHMCS slow; browser 30s timeout aborts.
    const ac = new AbortController();
    const firstP = post(url, cancelBody, ac.signal).catch((e) => ({ aborted: true, e }) as any);
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    await firstP;

    // 2. Retry while still in flight → refused, no second cancellation.
    await new Promise((r) => setTimeout(r, 30));
    const inFlightRetry = await post(url, cancelBody);
    assert.equal(inFlightRetry.status, 409, "a retry during the in-flight cancel must be refused");
    assert.equal(cancelRuns, 1, "the cancellation must not be submitted a second time");

    // 3. The original cancel lands.
    release();
    await new Promise((r) => setTimeout(r, 50));

    // 4. A later retry replays the original success — no second cancellation.
    const replay = await post(url, cancelBody);
    const body = await replay.json();
    assert.equal(replay.status, 200);
    assert.equal(body.ok, true);
    assert.equal(cancelRuns, 1, "exactly one cancellation was ever submitted");
  });
  release();
});

test("cancel: a retry after the cancellation already submitted replays the same response", async () => {
  __resetIdempotencyStore();
  let cancelRuns = 0;
  const addCancelRequest: CancelRouteDeps["addCancelRequest"] = async (): Promise<WhmcsRawFetch> => {
    cancelRuns += 1;
    return { ok: true, data: {} };
  };

  await withServer(makeCancelApp(addCancelRequest), async (baseUrl) => {
    const url = `${baseUrl}/api/billing/services/42/cancel`;
    const cancelBody = { type: "Immediate" };

    const first = await post(url, cancelBody);
    assert.equal(first.status, 200);

    const retry = await post(url, cancelBody);
    const retryBody = await retry.json();
    assert.equal(retry.status, 200);
    assert.equal(retryBody.ok, true);
    assert.equal(cancelRuns, 1, "the cancellation was submitted exactly once");
  });
});
