import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createWhmcsLinkHandler,
  createWhmcsUnlinkHandler,
  createWhmcsAutoMatchHandler,
  type LinkRouteDeps,
  type LinkRouteUser,
} from "./whmcs-admin-link-route";
import type { WhmcsClientLookup, WhmcsClientSummary } from "./whmcs";

// Route-level tests for the admin WHMCS account-LINKING writes:
//   POST   /api/admin/users/:id/whmcs/link
//   DELETE /api/admin/users/:id/whmcs/link
//   POST   /api/admin/users/:id/whmcs/auto-match
//
// These exercise the PRODUCTION handler factories from
// server/whmcs-admin-link-route.ts (wired into routes.ts), not a copy. The
// sibling service-lifecycle route (whmcs-admin-service-action-route.test.ts)
// proves the same boundary for the suspend/unsuspend/terminate write; this file
// is the linking replica.
//
// Contracts under test:
//   1. Authorization — POST/DELETE are WRITES, so requirePermission resolves to
//      users.MANAGE. An unauthenticated caller (401), a customer (403), a
//      view-only admin (users.view but not users.manage, 403), and an admin with
//      no role (403) must ALL be rejected before the handler runs and before
//      WHMCS is touched. A users.manage admin / master_admin succeeds.
//   2. Idempotency — auto-match on an already-linked user is a no-op
//      (matched:false, alreadyLinked:true), never re-links and never writes.
//   3. 409 on conflict — linking/auto-matching to a WHMCS client already bound to
//      a DIFFERENT ServiceHub user is rejected with 409 and no write.
//   4. Audit — every successful link/unlink/auto-match calls logActivity once.

function client(id: number, email: string, fullName = "Test Client"): WhmcsClientSummary {
  return { id, firstName: "Test", lastName: "Client", fullName, companyName: "", email, status: "Active" };
}

const okClient = (c: WhmcsClientSummary | null): WhmcsClientLookup => ({ ok: true, client: c });

interface AuditEntry {
  category: string;
  action: string;
  opts: { actorId?: string; targetId?: string; targetType?: string; summary: string };
}

interface DepSpies {
  audits: AuditEntry[];
  updates: { id: string; patch: { whmcsClientId: number | null; whmcsLinkedAt: Date | null } }[];
  whmcsCalled: () => boolean;
}

interface MakeDepsOpts {
  users: Record<string, LinkRouteUser | undefined>;
  /** keyed by client id → the user it's already linked to (for conflict tests). */
  usersByClientId?: Record<number, LinkRouteUser | undefined>;
  hasCredentials?: boolean;
  getClientById?: LinkRouteDeps["getClientById"];
  getClientByEmail?: LinkRouteDeps["getClientByEmail"];
}

function makeDeps(opts: MakeDepsOpts): { deps: LinkRouteDeps; spies: DepSpies } {
  const audits: AuditEntry[] = [];
  const updates: DepSpies["updates"] = [];
  let whmcsCalled = false;
  const wrapLookup = <T extends (...a: any[]) => Promise<WhmcsClientLookup>>(fn: T | undefined, fallback: WhmcsClientLookup) =>
    (async (...args: any[]) => {
      whmcsCalled = true;
      return fn ? fn(...args) : fallback;
    }) as unknown as T;
  const deps: LinkRouteDeps = {
    getUser: async (id) => opts.users[id],
    getUserByWhmcsClientId: async (clientId) => opts.usersByClientId?.[clientId],
    updateUser: async (id, patch) => {
      updates.push({ id, patch });
      const u = opts.users[id];
      return u ? { ...u, ...patch } : undefined;
    },
    logActivity: (category, action, o) => { audits.push({ category, action, opts: o }); },
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    getClientById: wrapLookup(opts.getClientById, { ok: true, client: client(1, "a@b.com") }),
    getClientByEmail: wrapLookup(opts.getClientByEmail, { ok: true, client: null }),
  };
  return { deps, spies: { audits, updates, whmcsCalled: () => whmcsCalled } };
}

// ---------- authorization gate (a faithful replica of routes.ts) ----------
//
// Mirrors server/routes.ts:requirePermission exactly, including the
// isWrite → managePerm selection that is the crux of this route's safety: a
// view-only admin can SEE a customer's billing link but must not be able to
// change it.

type GuardUser = { role: string; adminRoleId?: string | null };

function makeRequirePermission(
  callers: Record<string, GuardUser | undefined>,
  rolePerms: Record<string, string[] | undefined>,
) {
  return (viewPerm: string, managePerm?: string) =>
    async (req: any, res: any, next: () => void) => {
      const uid = req.session?.userId;
      if (!uid) return res.status(401).json({ message: "Unauthorized" });
      const user = callers[uid];
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "master_admin") return next();
      const isWrite = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method);
      const requiredPerm = isWrite && managePerm ? managePerm : viewPerm;
      if (!user.adminRoleId) {
        return res.status(403).json({ message: "No admin role assigned" });
      }
      const perms = rolePerms[user.adminRoleId];
      if (!perms || !perms.includes(requiredPerm)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      next();
    };
}

interface GuardedAppOpts extends MakeDepsOpts {
  /** Acting (session) user; null → unauthenticated. */
  sessionUserId?: string | null;
  callers: Record<string, GuardUser | undefined>;
  rolePerms: Record<string, string[] | undefined>;
}

function makeGuardedApp(opts: GuardedAppOpts) {
  const { deps, spies } = makeDeps(opts);
  const requirePermission = makeRequirePermission(opts.callers, opts.rolePerms);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = opts.sessionUserId === null ? {} : { userId: opts.sessionUserId ?? "admin1" };
    next();
  });
  // Mirror the production mount: permission gate THEN the real handler.
  app.post("/api/admin/users/:id/whmcs/link", requirePermission("users.view", "users.manage") as any, createWhmcsLinkHandler(deps));
  app.delete("/api/admin/users/:id/whmcs/link", requirePermission("users.view", "users.manage") as any, createWhmcsUnlinkHandler(deps));
  app.post("/api/admin/users/:id/whmcs/auto-match", requirePermission("users.view", "users.manage") as any, createWhmcsAutoMatchHandler(deps));
  return { app, spies };
}

async function call(app: express.Express, method: "POST" | "DELETE", path: string, body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const LINK_PATH = "/api/admin/users/u1/whmcs/link";
const MATCH_PATH = "/api/admin/users/u1/whmcs/auto-match";

// ---------- unauthenticated → 401 (no WHMCS, no write, no audit) ----------

test("auto-match: unauthenticated caller is rejected with 401 before the handler runs", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: null,
    callers: {},
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
  });
  const { status } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 401);
  assert.equal(spies.whmcsCalled(), false);
  assert.equal(spies.updates.length, 0);
  assert.equal(spies.audits.length, 0);
});

test("manual link: unauthenticated caller is rejected with 401", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: null,
    callers: {},
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 5 });
  assert.equal(status, 401);
  assert.equal(spies.whmcsCalled(), false);
  assert.equal(spies.updates.length, 0);
});

test("unlink: unauthenticated caller is rejected with 401 (no write, no audit)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: null,
    callers: {},
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", whmcsClientId: 5 } },
  });
  const { status } = await call(app, "DELETE", LINK_PATH);
  assert.equal(status, 401);
  assert.equal(spies.updates.length, 0);
  assert.equal(spies.audits.length, 0);
});

// ---------- customer (non-admin) → 403 ----------

test("auto-match: a customer (non-admin) is rejected with 403 (WHMCS never called)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "cust",
    callers: { cust: { role: "customer" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
  });
  const { status } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 403);
  assert.equal(spies.whmcsCalled(), false);
  assert.equal(spies.updates.length, 0);
  assert.equal(spies.audits.length, 0);
});

test("manual link: a customer (non-admin) is rejected with 403", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "cust",
    callers: { cust: { role: "customer" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice" } },
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 5 });
  assert.equal(status, 403);
  assert.equal(spies.whmcsCalled(), false);
  assert.equal(spies.updates.length, 0);
});

test("unlink: a customer (non-admin) is rejected with 403", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "cust",
    callers: { cust: { role: "customer" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", whmcsClientId: 5 } },
  });
  const { status } = await call(app, "DELETE", LINK_PATH);
  assert.equal(status, 403);
  assert.equal(spies.updates.length, 0);
});

// ---------- view-only admin → 403 (the crux) ----------

test("a view-only admin (users.view but not users.manage) cannot link/unlink/auto-match (403)", async () => {
  // The crux: POST/DELETE are writes, so the gate requires users.MANAGE. An
  // admin who can only VIEW customers must not be able to change a customer's
  // billing link.
  const cases: { method: "POST" | "DELETE"; path: string; body?: unknown }[] = [
    { method: "POST", path: LINK_PATH, body: { clientId: 5 } },
    { method: "DELETE", path: LINK_PATH },
    { method: "POST", path: MATCH_PATH },
  ];
  for (const c of cases) {
    const { app, spies } = makeGuardedApp({
      sessionUserId: "viewer",
      callers: { viewer: { role: "admin", adminRoleId: "role-view" } },
      rolePerms: { "role-view": ["users.view"] },
      users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 5 } },
    });
    const { status, body } = await call(app, c.method, c.path, c.body);
    assert.equal(status, 403, `${c.method} ${c.path} should be forbidden for a view-only admin`);
    assert.match(body.message, /Insufficient permissions/);
    assert.equal(spies.whmcsCalled(), false, `${c.method} ${c.path} must not reach WHMCS`);
    assert.equal(spies.updates.length, 0, `${c.method} ${c.path} must not write`);
    assert.equal(spies.audits.length, 0, `${c.method} ${c.path} must not be audited`);
  }
});

test("an admin with NO role assigned is rejected with 403 (auto-match, WHMCS never called)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "noRole",
    callers: { noRole: { role: "admin", adminRoleId: null } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
  });
  const { status, body } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 403);
  assert.match(body.message, /No admin role assigned/);
  assert.equal(spies.whmcsCalled(), false);
  assert.equal(spies.updates.length, 0);
});

// ---------- users.manage admin / master_admin → success ----------

test("an admin WITH users.manage passes the gate and the auto-match goes through (200 + audit)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "manager",
    callers: { manager: { role: "admin", adminRoleId: "role-manage" } },
    rolePerms: { "role-manage": ["users.view", "users.manage"] },
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientByEmail: async () => okClient(client(42, "alice@example.com")),
  });
  const { status, body } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.matched, true);
  assert.equal(spies.updates.length, 1);
  assert.equal(spies.updates[0].patch.whmcsClientId, 42);
  assert.equal(spies.audits.length, 1);
  assert.equal(spies.audits[0].action, "whmcs_auto_matched");
  assert.equal(spies.audits[0].opts.actorId, "manager");
});

test("a users.manage admin can manually link (200 + audit)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "manager",
    callers: { manager: { role: "admin", adminRoleId: "role-manage" } },
    rolePerms: { "role-manage": ["users.view", "users.manage"] },
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientById: async () => okClient(client(7, "alice@example.com")),
  });
  const { status, body } = await call(app, "POST", LINK_PATH, { clientId: 7 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.link.whmcsClientId, 7);
  assert.equal(spies.updates.length, 1);
  assert.equal(spies.updates[0].patch.whmcsClientId, 7);
  assert.equal(spies.audits.length, 1);
  assert.equal(spies.audits[0].action, "whmcs_linked");
});

test("a master_admin bypasses the per-permission check and the auto-match goes through (200)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "boss",
    callers: { boss: { role: "master_admin" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientByEmail: async () => okClient(client(99, "alice@example.com")),
  });
  const { status, body } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 200);
  assert.equal(body.matched, true);
  assert.equal(spies.updates.length, 1);
  assert.equal(spies.audits.length, 1);
});

test("a master_admin can unlink (200 + audit)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "boss",
    callers: { boss: { role: "master_admin" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", whmcsClientId: 5 } },
  });
  const { status, body } = await call(app, "DELETE", LINK_PATH);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(spies.updates.length, 1);
  assert.equal(spies.updates[0].patch.whmcsClientId, null);
  assert.equal(spies.audits.length, 1);
  assert.equal(spies.audits[0].action, "whmcs_unlinked");
});

// ---------- idempotency ----------

test("auto-match is idempotent: an already-linked user is a no-op (matched:false, no write)", async () => {
  const { deps, spies } = makeDeps({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 13, whmcsLinkedAt: new Date("2026-01-01") } },
    getClientById: async () => okClient(client(13, "alice@example.com")),
    getClientByEmail: async () => { throw new Error("getClientByEmail must not be consulted for an already-linked user"); },
  });
  const handler = createWhmcsAutoMatchHandler(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin1" }; next(); });
  app.post("/api/admin/users/:id/whmcs/auto-match", handler);
  const { status, body } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.matched, false);
  assert.equal(body.alreadyLinked, true);
  assert.equal(body.link.whmcsClientId, 13);
  assert.equal(spies.updates.length, 0, "an already-linked user must not be re-written");
  assert.equal(spies.audits.length, 0, "a no-op must not be audited");
});

// ---------- 409 on conflict ----------

test("auto-match returns 409 when the matched client is already linked to another user (no write)", async () => {
  const { deps, spies } = makeDeps({
    users: { u1: { id: "u1", username: "alice", email: "shared@example.com" } },
    usersByClientId: { 50: { id: "other", username: "bob", whmcsClientId: 50 } },
    getClientByEmail: async () => okClient(client(50, "shared@example.com")),
  });
  const handler = createWhmcsAutoMatchHandler(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin1" }; next(); });
  app.post("/api/admin/users/:id/whmcs/auto-match", handler);
  const { status, body } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 409);
  assert.match(body.message, /already linked to bob/);
  assert.equal(spies.updates.length, 0, "a conflicting auto-match must not write");
  assert.equal(spies.audits.length, 0);
});

test("manual link returns 409 when the client is already linked to another user (no write)", async () => {
  const { deps, spies } = makeDeps({
    users: { u1: { id: "u1", username: "alice" } },
    usersByClientId: { 50: { id: "other", username: "bob", whmcsClientId: 50 } },
    getClientById: async () => okClient(client(50, "bob@example.com")),
  });
  const handler = createWhmcsLinkHandler(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin1" }; next(); });
  app.post("/api/admin/users/:id/whmcs/link", handler);
  const { status, body } = await call(app, "POST", LINK_PATH, { clientId: 50 });
  assert.equal(status, 409);
  assert.match(body.message, /already linked to bob/);
  assert.equal(spies.updates.length, 0, "a conflicting link must not write");
  assert.equal(spies.audits.length, 0);
});

test("manual link to a client already linked to the SAME user succeeds (not a conflict)", async () => {
  // Re-linking u1 to the client u1 already holds is idempotent, not a 409.
  const { deps, spies } = makeDeps({
    users: { u1: { id: "u1", username: "alice", whmcsClientId: 7 } },
    usersByClientId: { 7: { id: "u1", username: "alice", whmcsClientId: 7 } },
    getClientById: async () => okClient(client(7, "alice@example.com")),
  });
  const handler = createWhmcsLinkHandler(deps);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin1" }; next(); });
  app.post("/api/admin/users/:id/whmcs/link", handler);
  const { status, body } = await call(app, "POST", LINK_PATH, { clientId: 7 });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(spies.updates.length, 1);
});

// ---------- billing-cache invalidation on link/unlink/auto-match ----------
//
// A successful (2xx) link / unlink / auto-match must drop the affected
// customer's cached billing immediately so the admin panel and the customer's
// own /api/billing reflect the new link without waiting for the 60s TTL — the
// same hygiene the service-lifecycle route applies. Because these writes CHANGE
// which client a user is bound to, the wrapper invalidates BOTH the previously
// linked client (on unlink / relink) AND the newly linked one (on link /
// auto-match), de-duped + null-skipped, and ONLY on a 2xx. These tests mount the
// real handler factory behind the SAME inline wrapper routes.ts uses and spy on
// the invalidator to assert the exact gating.

interface InvalAppOpts extends MakeDepsOpts {
  sessionUserId?: string;
}

function makeInvalApp(opts: InvalAppOpts) {
  const invalidated: number[] = [];
  // Mutable user store so updateUser is reflected in the post-handler re-read,
  // exactly like storage in production.
  const users = { ...opts.users };
  const { deps, spies } = makeDeps({ ...opts, users });
  deps.updateUser = async (id, patch) => {
    spies.updates.push({ id, patch });
    const u = users[id];
    const next = u ? { ...u, ...patch } : undefined;
    if (next) users[id] = next;
    return next;
  };
  // Mirror server/routes.ts:withBillingInvalidation exactly.
  const withBillingInvalidation =
    (handler: (req: any, res: any) => unknown) =>
    async (req: any, res: any) => {
      const userId = req.params.id;
      const before = users[userId];
      const prevClientId = before?.whmcsClientId ?? null;
      await handler(req, res);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        const after = users[userId];
        const nextClientId = after?.whmcsClientId ?? null;
        const affected = new Set<number>();
        if (prevClientId) affected.add(prevClientId);
        if (nextClientId) affected.add(nextClientId);
        for (const clientId of affected) invalidated.push(clientId);
      }
    };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: opts.sessionUserId ?? "admin1" }; next(); });
  app.post("/api/admin/users/:id/whmcs/link", withBillingInvalidation(createWhmcsLinkHandler(deps)));
  app.delete("/api/admin/users/:id/whmcs/link", withBillingInvalidation(createWhmcsUnlinkHandler(deps)));
  app.post("/api/admin/users/:id/whmcs/auto-match", withBillingInvalidation(createWhmcsAutoMatchHandler(deps)));
  return { app, invalidated, spies };
}

test("manual link drops the newly-linked client's billing cache on success (200)", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientById: async () => okClient(client(5, "alice@example.com")),
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 5 });
  assert.equal(status, 200);
  assert.deepEqual(invalidated, [5]);
});

test("relink drops BOTH the previous and the new client's cache", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 3 } },
    getClientById: async () => okClient(client(8, "alice@example.com")),
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 8 });
  assert.equal(status, 200);
  assert.deepEqual(invalidated.sort(), [3, 8]);
});

test("unlink drops the previously-linked client's cache on success", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", whmcsClientId: 7 } },
  });
  const { status } = await call(app, "DELETE", LINK_PATH);
  assert.equal(status, 200);
  assert.deepEqual(invalidated, [7]);
});

test("auto-match drops the matched client's cache on a real match (200)", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientByEmail: async () => okClient(client(11, "alice@example.com")),
  });
  const { status } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 200);
  assert.deepEqual(invalidated, [11]);
});

test("manual link does NOT invalidate when the client is not found (404)", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientById: async () => okClient(null),
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 5 });
  assert.equal(status, 404);
  assert.deepEqual(invalidated, []);
});

test("manual link does NOT invalidate on a 409 conflict", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    usersByClientId: { 5: { id: "u2", username: "bob", whmcsClientId: 5 } },
    getClientById: async () => okClient(client(5, "bob@example.com")),
  });
  const { status } = await call(app, "POST", LINK_PATH, { clientId: 5 });
  assert.equal(status, 409);
  assert.deepEqual(invalidated, []);
});

test("auto-match no-op (no email match) does not invalidate", async () => {
  const { app, invalidated } = makeInvalApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    getClientByEmail: async () => okClient(null),
  });
  const { status } = await call(app, "POST", MATCH_PATH);
  assert.equal(status, 200);
  assert.deepEqual(invalidated, []);
});
