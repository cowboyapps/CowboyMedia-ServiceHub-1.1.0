import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createResetServicePasswordHandler,
  generateServicePassword,
  type PasswordRouteDeps,
} from "./whmcs-password-route";
import { createBillingCacheInvalidator } from "./billing-cache-invalidation";
import type { ServicesListData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the customer service-password-reset endpoint:
//   POST /api/my/services/:serviceId/password
//
// These exercise the PRODUCTION handler factory from
// server/whmcs-password-route.ts (wired into routes.ts), not a copy. The two
// security-critical contracts mirror the cancel route:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user, and
//      the target service id (from the path) must belong to that client AND be
//      active before any WHMCS write happens. A service id not owned by the
//      caller is rejected with a 404 and WHMCS is never called.
//   2. The handler never 500s: the unconfigured/unlinked paths and WHMCS
//      failures all degrade to a stable tagged JSON shape. The generated
//      password is returned ONCE in the success body.

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
    username: "user",
    password: "old-secret",
  };
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadServicesList?: PasswordRouteDeps["loadServicesList"];
  changeServicePassword?: PasswordRouteDeps["changeServicePassword"];
  generatePassword?: PasswordRouteDeps["generatePassword"];
}

function makeApp(opts: AppOpts) {
  const deps: PasswordRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    changeServicePassword: opts.changeServicePassword,
    generatePassword: opts.generatePassword ?? (() => "Generated-Pw-123!"),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.post("/api/my/services/:serviceId/password", createResetServicePasswordHandler(deps));
  return app;
}

async function call(app: express.Express, serviceId: string | number) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/my/services/${serviceId}/password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const okList = (services: ReturnType<typeof svc>[]): PasswordRouteDeps["loadServicesList"] =>
  async (): Promise<ServicesListData> => ({ services: services as any, unreachable: false });

// ---------- password generator ----------

test("generateServicePassword: length floor + all character classes", () => {
  const pw = generateServicePassword(16);
  assert.equal(pw.length, 16);
  // Requests below the floor are bumped up to a safe minimum.
  assert.ok(generateServicePassword(4).length >= 12);
  // 200 samples should always contain each class (probability of a miss is ~0).
  for (let i = 0; i < 200; i++) {
    const p = generateServicePassword();
    assert.match(p, /[a-z]/, "has lowercase");
    assert.match(p, /[A-Z]/, "has uppercase");
    assert.match(p, /[0-9]/, "has a digit");
    assert.match(p, /[^a-zA-Z0-9]/, "has a symbol");
  }
});

// ---------- ownership ----------

test("rejects a service id the caller does not own (404, WHMCS never called)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 999);
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("client id comes from the session, NOT the request; password returned once", async () => {
  let seenClientId = -1;
  let resetServiceId = -1;
  let sentPassword = "";
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (clientId): Promise<ServicesListData> => {
      seenClientId = clientId;
      return { services: [svc(100)] as any, unreachable: false };
    },
    changeServicePassword: async (serviceId, newPassword): Promise<WhmcsRawFetch> => {
      resetServiceId = serviceId;
      sentPassword = newPassword;
      return { ok: true };
    },
    generatePassword: () => "Fixed-Pw-99!",
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.password, "Fixed-Pw-99!");
  assert.equal(sentPassword, "Fixed-Pw-99!");
  assert.equal(seenClientId, 5);
  assert.equal(resetServiceId, 100);
});

test("rejects resetting a non-active service (409)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("rejects a non-numeric service id with a 404", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(app, "abc");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

// ---------- staff-account block ----------

test("admin session → 403, WHMCS never called", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "admin" } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [svc(100)] as any, unreachable: false }; },
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 403, "staff accounts must be rejected from the customer password-reset action");
  assert.equal(body.ok, false);
  assert.equal(body.password, undefined, "no password may be generated for a staff account");
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("master_admin session → 403, WHMCS never called", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "master_admin" } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [svc(100)] as any, unreachable: false }; },
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 403);
  assert.equal(body.ok, false);
  assert.equal(body.password, undefined);
  assert.equal(called, false);
});

// ---------- degraded / unconfigured paths ----------

test("no-ops with 409 when WHMCS is not configured (WHMCS never called)", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    hasCredentials: false,
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [], unreachable: false }; },
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100);
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
  const { status, body } = await call(app, 100);
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
    changeServicePassword: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 502);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("module that doesn't support password change surfaces a 409", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Module Command Not Supported" }),
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.match(body.message, /doesn't support/);
});

test("network failure degrades to 502 (no 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
  });
  const { status, body } = await call(app, 100);
  assert.equal(status, 502);
  assert.equal(body.ok, false);
});

test("never returns the generated password on any failure path", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
    generatePassword: () => "Should-Not-Leak!",
  });
  const { body } = await call(app, 100);
  assert.equal(body.password, undefined);
});

// ---------- billing-cache invalidation wiring ----------
//
// The route wraps the handler with the shared after-handler hook
// (createBillingCacheInvalidator) so the caller's cached billing data is dropped
// the moment a password reset SUCCEEDS — otherwise the billing page keeps
// serving the pre-reset snapshot until the 60s TTL expires. These tests mount
// the REAL handler factory + the REAL invalidator together (mirroring how
// routes.ts composes them) and spy on the invalidate dep to assert the exact
// gating: invalidate only on a 200, never on a degraded response, and never for
// a user with no linked WHMCS client.

function makeWiredApp(opts: AppOpts) {
  const invalidated: number[] = [];
  const deps: PasswordRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: (id: string) => Promise.resolve(opts.users[id]),
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    changeServicePassword: opts.changeServicePassword,
    generatePassword: opts.generatePassword ?? (() => "Generated-Pw-123!"),
  };
  const handler = createResetServicePasswordHandler(deps);
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
  app.post("/api/my/services/:serviceId/password", async (req, res) => {
    await handler(req, res);
    await invalidateAfter(req, res);
  });
  return { app, invalidated };
}

test("invalidates the actor's billing cache after a successful password reset (200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 100);
  assert.equal(status, 200);
  // Cache dropped exactly once, for the SESSION user's linked client id.
  assert.deepEqual(invalidated, [5]);
});

test("does NOT invalidate when the password reset fails (non-200)", async () => {
  // An unsupported-module error degrades to a 409 — nothing changed on the
  // service, so the cache must stand.
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Module Command Not Supported" }),
  });
  const { status } = await call(app, 100);
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the service isn't owned (404)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 999);
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
    changeServicePassword: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, 100);
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});
