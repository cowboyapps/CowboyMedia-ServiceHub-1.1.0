import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createAdminServiceActionHandler,
  type AdminServiceActionDeps,
} from "./whmcs-admin-service-action-route";
import type { ServicesListData } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

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
