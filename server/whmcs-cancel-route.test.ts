import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createRequestCancellationHandler,
  type CancelRouteDeps,
} from "./whmcs-cancel-route";
import { createBillingCacheInvalidator } from "./billing-cache-invalidation";
import type { ServicesListData } from "./whmcs-billing";
import type { WhmcsCancellationType, WhmcsRawFetch } from "./whmcs";

// Route-level tests for the customer service-cancellation endpoint:
//   POST /api/billing/services/:serviceId/cancel
//
// These exercise the PRODUCTION handler factory from
// server/whmcs-cancel-route.ts (wired into routes.ts), not a copy. The two
// security-critical contracts:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user, and
//      the target service id (from the path) must belong to that client AND be
//      active before any WHMCS write happens. A service id not owned by the
//      caller is rejected with a 404 and WHMCS is never called.
//   2. The handler never 500s: input validation, the unconfigured/unlinked
//      paths, and WHMCS failures all degrade to a stable tagged JSON shape.

function svc(id: number, status = "Active") {
  return {
    id,
    pid: 1,
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

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadServicesList?: CancelRouteDeps["loadServicesList"];
  addCancelRequest?: CancelRouteDeps["addCancelRequest"];
}

function makeApp(opts: AppOpts) {
  const deps: CancelRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    addCancelRequest: opts.addCancelRequest,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.post("/api/billing/services/:serviceId/cancel", createRequestCancellationHandler(deps));
  return app;
}

async function call(app: express.Express, serviceId: string | number, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/services/${serviceId}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const okList = (services: ReturnType<typeof svc>[]): CancelRouteDeps["loadServicesList"] =>
  async (): Promise<ServicesListData> => ({ services, unreachable: false });

// ---------- ownership ----------

test("rejects a service id the caller does not own (404, WHMCS never called)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    // The client owns service 100, but the request targets 999.
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 999, { type: "Immediate" });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("client id comes from the session, NOT the request", async () => {
  let seenClientId = -1;
  let cancelledServiceId = -1;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (clientId): Promise<ServicesListData> => {
      seenClientId = clientId;
      return { services: [svc(100)], unreachable: false };
    },
    addCancelRequest: async (serviceId): Promise<WhmcsRawFetch> => {
      cancelledServiceId = serviceId;
      return { ok: true };
    },
  });
  // Attacker tries to smuggle a foreign clientId in the body — must be ignored.
  const { status, body } = await call(app, 100, { type: "Immediate", clientId: 999, clientid: 999 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(seenClientId, 5);
  assert.equal(cancelledServiceId, 100);
});

test("rejects cancelling a non-active service (409)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

// ---------- staff-account block ----------

test("admin session → 403, WHMCS never called", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5, role: "admin" } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [svc(100)], unreachable: false }; },
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 403, "staff accounts must be rejected from the customer cancellation action");
  assert.equal(body.ok, false);
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("master_admin session → 403, WHMCS never called", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5, role: "master_admin" } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [svc(100)], unreachable: false }; },
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 403);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

// ---------- input validation ----------

test("rejects an invalid cancellation type (400, WHMCS never called)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Whenever" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.errors);
  assert.equal(called, false);
});

test("rejects a non-numeric service id with a 404", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(app, "abc", { type: "Immediate" });
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("accepts an optional reason and forwards it to WHMCS", async () => {
  let seenReason: string | undefined = "UNSET";
  let seenType: WhmcsCancellationType | undefined;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (_id, type, reason): Promise<WhmcsRawFetch> => {
      seenType = type;
      seenReason = reason;
      return { ok: true };
    },
  });
  const { status } = await call(app, 100, { type: "End of Billing Period", reason: "Too expensive" });
  assert.equal(status, 200);
  assert.equal(seenType, "End of Billing Period");
  assert.equal(seenReason, "Too expensive");
});

// ---------- degraded / unconfigured paths ----------

test("no-ops with 409 when WHMCS is not configured (WHMCS never called)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    hasCredentials: false,
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [], unreachable: false }; },
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("rejects when the session user has no linked client (409)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [], unreachable: false }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("degrades to 502 when the services list is unreachable", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (): Promise<ServicesListData> => ({ services: [], unreachable: true }),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 502);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("surfaces a WHMCS error as a 400 with the message", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "There is no active service to cancel" }),
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.message, /no active service/);
});

test("network failure degrades to 502 (no 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
  });
  const { status, body } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 502);
  assert.equal(body.ok, false);
});

// ---------- billing-cache invalidation wiring ----------
//
// The route wraps the handler with the shared after-handler hook
// (createBillingCacheInvalidator) so the caller's cached billing data is dropped
// the moment a cancellation SUCCEEDS — otherwise the billing page keeps serving
// the pre-cancel snapshot until the 60s TTL expires. These tests mount the REAL
// handler factory + the REAL invalidator together (mirroring how routes.ts
// composes them) and spy on the invalidate dep to assert the exact gating:
// invalidate only on a 200, never on a degraded response, and never for a user
// with no linked WHMCS client.

function makeWiredApp(opts: AppOpts) {
  const invalidated: number[] = [];
  const deps: CancelRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: (id: string) => Promise.resolve(opts.users[id]),
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    addCancelRequest: opts.addCancelRequest,
  };
  const handler = createRequestCancellationHandler(deps);
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
  app.post("/api/billing/services/:serviceId/cancel", async (req, res) => {
    await handler(req, res);
    await invalidateAfter(req, res);
  });
  return { app, invalidated };
}

test("invalidates the actor's billing cache after a successful cancellation (200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 200);
  // Cache dropped exactly once, for the SESSION user's linked client id.
  assert.deepEqual(invalidated, [5]);
});

test("does NOT invalidate when the cancellation fails (non-200)", async () => {
  // A WHMCS error degrades to a 400 — nothing changed, so the cache must stand.
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "There is no active service to cancel" }),
  });
  const { status } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 400);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the service isn't owned (404)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 999, { type: "Immediate" });
  assert.equal(status, 404);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the user has no linked WHMCS client", async () => {
  // The handler itself 409s here, but even on a hypothetical 200 the invalidator
  // has no client id to act on — so nothing is dropped either way.
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null } },
    loadServicesList: okList([svc(100)]),
    addCancelRequest: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 100, { type: "Immediate" });
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});
