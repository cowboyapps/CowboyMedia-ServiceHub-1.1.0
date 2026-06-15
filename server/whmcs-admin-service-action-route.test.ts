import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createAdminServiceActionHandler,
  type AdminServiceActionDeps,
} from "./whmcs-admin-service-action-route";
import { getParam } from "./http-params";
import type { ServicesListData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";
import { createRequirePermission } from "./require-permission";

// Route-level tests for the admin service-lifecycle endpoint:
//   POST /api/admin/users/:id/whmcs/services/:serviceId/:action
//   (action ∈ suspend | unsuspend | terminate)
//
// These exercise the PRODUCTION handler factory from
// server/whmcs-admin-service-action-route.ts (wired into routes.ts), not a copy.
// The contracts under test:
//   1. Ownership — the WHMCS client id is resolved from the SELECTED customer
//      (the :id path param), and the target service id (from the path) must
//      belong to that client before any WHMCS write happens. A service id not
//      owned by that customer collapses to a 404 and WHMCS is never called.
//   2. Status guards — suspend only from active, unsuspend only from suspended,
//      terminate from anything not already terminated.
//   3. Audit — every successful action calls the injected logActivity exactly
//      once with category "admin" and the right action.
//   4. Never 500s — unconfigured/unlinked/unreachable + WHMCS errors all degrade
//      to a stable tagged JSON shape.

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

interface AuditEntry {
  category: string;
  action: string;
  opts: { actorId?: string; targetId?: string; targetType?: string; summary: string };
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadServicesList?: AdminServiceActionDeps["loadServicesList"];
  moduleSuspend?: AdminServiceActionDeps["moduleSuspend"];
  moduleUnsuspend?: AdminServiceActionDeps["moduleUnsuspend"];
  moduleTerminate?: AdminServiceActionDeps["moduleTerminate"];
}

function makeApp(opts: AppOpts) {
  const audits: AuditEntry[] = [];
  const deps: AdminServiceActionDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    logActivity: (category, action, o) => { audits.push({ category, action, opts: o }); },
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    moduleSuspend: opts.moduleSuspend,
    moduleUnsuspend: opts.moduleUnsuspend,
    moduleTerminate: opts.moduleTerminate,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? "admin1" };
    next();
  });
  app.post("/api/admin/users/:id/whmcs/services/:serviceId/:action", createAdminServiceActionHandler(deps));
  return { app, audits };
}

async function call(app: express.Express, userId: string, serviceId: string | number, action: string, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/${userId}/whmcs/services/${serviceId}/${action}`, {
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

const okList = (services: ReturnType<typeof svc>[]): AdminServiceActionDeps["loadServicesList"] =>
  async (): Promise<ServicesListData> => ({ services, unreachable: false });

// ---------- ownership ----------

test("rejects a service id the selected customer does not own (404, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 999, "suspend");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("client id comes from the SELECTED customer, not the session/request", async () => {
  let seenClientId = -1;
  let suspendedServiceId = -1;
  const { app } = makeApp({
    sessionUserId: "admin1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (clientId): Promise<ServicesListData> => {
      seenClientId = clientId;
      return { services: [svc(100)], unreachable: false };
    },
    moduleSuspend: async (serviceId): Promise<WhmcsRawFetch> => { suspendedServiceId = serviceId; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(seenClientId, 5);
  assert.equal(suspendedServiceId, 100);
});

// ---------- unknown action / bad input ----------

test("rejects an unknown action (404, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "delete");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("rejects a non-numeric service id with a 404", async () => {
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(app, "u1", "abc", "suspend");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
});

test("rejects an over-long suspend reason (400, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend", { reason: "x".repeat(256) });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.errors);
  assert.equal(called, false);
});

// ---------- status guards ----------

test("suspend rejects a non-active service (409, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("unsuspend rejects a non-suspended service (409, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Active")]),
    moduleUnsuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "unsuspend");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("terminate rejects an already-terminated service (409, WHMCS never called)", async () => {
  let called = false;
  const { app } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Terminated")]),
    moduleTerminate: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "terminate");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

// ---------- success + audit ----------

test("suspend succeeds, forwards the reason, and writes an audit entry", async () => {
  let seenReason: string | undefined = "UNSET";
  const { app, audits } = makeApp({
    sessionUserId: "admin1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (_id, reason): Promise<WhmcsRawFetch> => { seenReason = reason; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend", { reason: "Overdue invoice" });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.action, "suspend");
  assert.equal(seenReason, "Overdue invoice");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].category, "admin");
  assert.equal(audits[0].action, "whmcs_service_suspended");
  assert.equal(audits[0].opts.actorId, "admin1");
  assert.equal(audits[0].opts.targetId, "u1");
});

test("unsuspend succeeds and writes the right audit action", async () => {
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    moduleUnsuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status, body } = await call(app, "u1", 100, "unsuspend");
  assert.equal(status, 200);
  assert.equal(body.action, "unsuspend");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "whmcs_service_unsuspended");
});

test("terminate succeeds and writes the right audit action", async () => {
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Active")]),
    moduleTerminate: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status, body } = await call(app, "u1", 100, "terminate");
  assert.equal(status, 200);
  assert.equal(body.action, "terminate");
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "whmcs_service_terminated");
});

// ---------- degraded / unconfigured paths (never 500, never audits) ----------

test("no-ops with 409 when WHMCS is not configured (WHMCS never called, no audit)", async () => {
  let called = false;
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    hasCredentials: false,
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [], unreachable: false }; },
    moduleSuspend: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
  assert.equal(audits.length, 0);
});

test("rejects with 404 when the selected customer doesn't exist", async () => {
  const { app, audits } = makeApp({
    users: {},
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(app, "ghost", 100, "suspend");
  assert.equal(status, 404);
  assert.equal(body.ok, false);
  assert.equal(audits.length, 0);
});

test("rejects with 409 when the selected customer isn't linked", async () => {
  let called = false;
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: null } },
    loadServicesList: async (): Promise<ServicesListData> => { called = true; return { services: [], unreachable: false }; },
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
  assert.equal(audits.length, 0);
});

test("degrades to 502 when the services list is unreachable", async () => {
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (): Promise<ServicesListData> => ({ services: [], unreachable: true }),
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 502);
  assert.equal(body.ok, false);
  assert.equal(audits.length, 0);
});

test("surfaces a WHMCS error as a 400 with the message and no audit", async () => {
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Module does not support suspend" }),
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.message, /does not support suspend/);
  assert.equal(audits.length, 0);
});

test("network failure degrades to 502 (no 500, no audit)", async () => {
  const { app, audits } = makeApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
  });
  const { status, body } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 502);
  assert.equal(body.ok, false);
  assert.equal(audits.length, 0);
});

// ---------- billing-cache invalidation wiring ----------
//
// registerRoutes wraps this handler with an after-hook that drops the SELECTED
// customer's cached billing the moment an action SUCCEEDS — otherwise the admin
// panel (and the customer's own /api/billing) keeps serving the pre-action
// status until the 60s TTL expires. Unlike the customer cancel route (which
// keys off the SESSION user via createBillingCacheInvalidator), this route
// resolves the client id from the SELECTED customer's :id path param. These
// tests mount the REAL handler factory + the SAME inline wrapper routes.ts uses
// and spy on the invalidator to assert the exact gating: invalidate only on a
// 200, for the target customer's client id, and never on a degraded response.

function makeWiredApp(opts: AppOpts) {
  const invalidated: number[] = [];
  const audits: AuditEntry[] = [];
  const deps: AdminServiceActionDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    logActivity: (category, action, o) => { audits.push({ category, action, opts: o }); },
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    moduleSuspend: opts.moduleSuspend,
    moduleUnsuspend: opts.moduleUnsuspend,
    moduleTerminate: opts.moduleTerminate,
  };
  const handler = createAdminServiceActionHandler(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? "admin1" };
    next();
  });
  // Mirror exactly how registerRoutes composes the route: run the handler, then
  // on a 200 re-resolve the SELECTED customer (path :id) and drop their cache.
  app.post("/api/admin/users/:id/whmcs/services/:serviceId/:action", async (req, res) => {
    await handler(req, res);
    if (res.statusCode === 200) {
      const target = opts.users[getParam(req, "id")];
      if (target?.whmcsClientId) invalidated.push(target.whmcsClientId);
    }
  });
  return { app, invalidated };
}

test("invalidates the SELECTED customer's billing cache after a successful action (200)", async () => {
  const { app, invalidated } = makeWiredApp({
    sessionUserId: "admin1",
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 200);
  // Cache dropped exactly once, for the TARGET customer's linked client id —
  // not the acting admin's (admin1 has no client).
  assert.deepEqual(invalidated, [5]);
});

test("unsuspend and terminate also drop the target customer's cache on success", async () => {
  const un = makeWiredApp({
    users: { u1: { whmcsClientId: 7 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    moduleUnsuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const unRes = await call(un.app, "u1", 100, "unsuspend");
  assert.equal(unRes.status, 200);
  assert.deepEqual(un.invalidated, [7]);

  const term = makeWiredApp({
    users: { u1: { whmcsClientId: 9 } },
    loadServicesList: okList([svc(100, "Active")]),
    moduleTerminate: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const termRes = await call(term.app, "u1", 100, "terminate");
  assert.equal(termRes.status, 200);
  assert.deepEqual(term.invalidated, [9]);
});

test("does NOT invalidate when the action surfaces a WHMCS error (400)", async () => {
  const { app, invalidated } = makeWiredApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Module does not support suspend" }),
  });
  const { status } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 400);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the service isn't the customer's (404)", async () => {
  const { app, invalidated } = makeWiredApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, "u1", 999, "suspend");
  assert.equal(status, 404);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate on a status-guard rejection (409)", async () => {
  const { app, invalidated } = makeWiredApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the services list is unreachable (502)", async () => {
  const { app, invalidated } = makeWiredApp({
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: async (): Promise<ServicesListData> => ({ services: [], unreachable: true }),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 502);
  assert.deepEqual(invalidated, []);
});

test("does NOT invalidate when the selected customer has no linked client (409)", async () => {
  // The handler itself 409s here, but even on a hypothetical 200 there is no
  // client id to act on — so nothing is dropped either way.
  const { app, invalidated } = makeWiredApp({
    users: { u1: { whmcsClientId: null } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status } = await call(app, "u1", 100, "suspend");
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});

// ---------- authorization gate (the real server-side safety boundary) ----------
//
// In production this endpoint is mounted behind
//   requirePermission("users.view", "users.manage")
// and the action (suspend/unsuspend/terminate) is always a POST. Because POST is
// a WRITE method, requirePermission resolves the REQUIRED permission to the
// MANAGE perm — so a view-only admin (or a customer, or an unauthenticated
// caller, or an admin with no role) MUST be rejected before the handler runs and
// before WHMCS is ever touched. The tests above mount the bare handler; these
// mount the REAL production gate (server/require-permission.ts) — the same
// factory routes.ts ships, no local replica — IN FRONT of the REAL handler so
// the full chain (authorization + the WHMCS write) is exercised, including the
// isWrite → managePerm selection that is the crux of this route's safety: a
// view-only admin can SEE a customer's services but must not change their
// lifecycle.

type GuardUser = { role: string; adminRoleId?: string | null };

function makeRequirePermission(
  users: Record<string, GuardUser | undefined>,
  rolePerms: Record<string, string[] | undefined>,
) {
  return createRequirePermission({
    getUser: async (id) => users[id],
    getAdminRole: async (id) => (rolePerms[id] ? { permissions: rolePerms[id] } : undefined),
  });
}

interface GuardedAppOpts extends AppOpts {
  /** Acting (session) user's role + admin role; absent uid → unauthenticated. */
  callers: Record<string, GuardUser | undefined>;
  rolePerms: Record<string, string[] | undefined>;
}

function makeGuardedApp(opts: GuardedAppOpts) {
  const audits: AuditEntry[] = [];
  let whmcsCalled = false;
  const wrap = <T extends (...args: any[]) => Promise<WhmcsRawFetch>>(fn: T | undefined) =>
    (async (...args: any[]) => {
      whmcsCalled = true;
      return fn ? fn(...args) : { ok: true };
    }) as unknown as T;
  const deps: AdminServiceActionDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    logActivity: (category, action, o) => { audits.push({ category, action, opts: o }); },
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadServicesList: opts.loadServicesList,
    moduleSuspend: wrap(opts.moduleSuspend),
    moduleUnsuspend: wrap(opts.moduleUnsuspend),
    moduleTerminate: wrap(opts.moduleTerminate),
  };
  const requirePermission = makeRequirePermission(opts.callers, opts.rolePerms);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = opts.sessionUserId === null ? {} : { userId: opts.sessionUserId ?? "admin1" };
    next();
  });
  // Mirror the production mount: permission gate THEN the real handler.
  app.post(
    "/api/admin/users/:id/whmcs/services/:serviceId/:action",
    requirePermission("users.view", "users.manage") as any,
    createAdminServiceActionHandler(deps),
  );
  return { app, audits, whmcsCalled: () => whmcsCalled };
}

test("unauthenticated caller is rejected with 401 before the handler runs", async () => {
  const g = makeGuardedApp({
    sessionUserId: null,
    callers: {},
    rolePerms: {},
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(g.app, "u1", 100, "suspend");
  assert.equal(status, 401);
  assert.equal(g.whmcsCalled(), false);
  assert.equal(g.audits.length, 0);
});

test("a customer (non-admin) is rejected with 403 (WHMCS never called)", async () => {
  const g = makeGuardedApp({
    sessionUserId: "cust",
    callers: { cust: { role: "customer" } },
    rolePerms: {},
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status } = await call(g.app, "u1", 100, "terminate");
  assert.equal(status, 403);
  assert.equal(g.whmcsCalled(), false);
  assert.equal(g.audits.length, 0);
});

test("a view-only admin (users.view but not users.manage) cannot suspend/unsuspend/terminate (403)", async () => {
  // The crux: POST is a write, so the gate requires users.MANAGE. An admin who
  // can only VIEW customers must not be able to change a service's lifecycle.
  for (const action of ["suspend", "unsuspend", "terminate"] as const) {
    const g = makeGuardedApp({
      sessionUserId: "viewer",
      callers: { viewer: { role: "admin", adminRoleId: "role-view" } },
      rolePerms: { "role-view": ["users.view"] },
      users: { u1: { whmcsClientId: 5 } },
      loadServicesList: okList([svc(100, action === "unsuspend" ? "Suspended" : "Active")]),
    });
    const { status, body } = await call(g.app, "u1", 100, action);
    assert.equal(status, 403, `${action} should be forbidden for a view-only admin`);
    assert.match(body.message, /Insufficient permissions/);
    assert.equal(g.whmcsCalled(), false, `${action} must not reach WHMCS`);
    assert.equal(g.audits.length, 0, `${action} must not be audited`);
  }
});

test("an admin with NO role assigned is rejected with 403 (WHMCS never called)", async () => {
  const g = makeGuardedApp({
    sessionUserId: "noRole",
    callers: { noRole: { role: "admin", adminRoleId: null } },
    rolePerms: {},
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
  });
  const { status, body } = await call(g.app, "u1", 100, "suspend");
  assert.equal(status, 403);
  assert.match(body.message, /No admin role assigned/);
  assert.equal(g.whmcsCalled(), false);
  assert.equal(g.audits.length, 0);
});

test("an admin WITH users.manage passes the gate and the action goes through (200 + audit)", async () => {
  const g = makeGuardedApp({
    sessionUserId: "manager",
    callers: { manager: { role: "admin", adminRoleId: "role-manage" } },
    rolePerms: { "role-manage": ["users.view", "users.manage"] },
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100)]),
    moduleSuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status, body } = await call(g.app, "u1", 100, "suspend");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(g.whmcsCalled(), true);
  assert.equal(g.audits.length, 1);
  assert.equal(g.audits[0].opts.actorId, "manager");
});

test("a master_admin bypasses the per-permission check and the action goes through (200)", async () => {
  const g = makeGuardedApp({
    sessionUserId: "boss",
    callers: { boss: { role: "master_admin" } },
    rolePerms: {},
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Suspended")]),
    moduleUnsuspend: async (): Promise<WhmcsRawFetch> => ({ ok: true }),
  });
  const { status, body } = await call(g.app, "u1", 100, "unsuspend");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(g.whmcsCalled(), true);
  assert.equal(g.audits.length, 1);
});

test("the authorization gate runs BEFORE status guards — a view-only admin is blocked even when the action would also be a no-op", async () => {
  // Defense-in-depth ordering check: authorization must not leak the service's
  // status. A view-only admin terminating an already-terminated service should
  // get 403 (not the 409 a permitted admin would see), proving the gate fires
  // first and WHMCS is never consulted.
  const g = makeGuardedApp({
    sessionUserId: "viewer",
    callers: { viewer: { role: "admin", adminRoleId: "role-view" } },
    rolePerms: { "role-view": ["users.view"] },
    users: { u1: { whmcsClientId: 5 } },
    loadServicesList: okList([svc(100, "Terminated")]),
  });
  const { status } = await call(g.app, "u1", 100, "terminate");
  assert.equal(status, 403);
  assert.equal(g.whmcsCalled(), false);
});
