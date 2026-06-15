import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createWhmcsLinkReadHandler,
  type LinkReadRouteDeps,
  type LinkReadRouteUser,
  type LinkReadSettings,
} from "./whmcs-admin-link-read-route";
import type { WhmcsClientLookup, WhmcsClientSummary } from "./whmcs";

// Route-level tests for the admin WHMCS account-link READ:
//   GET /api/admin/users/:id/whmcs
//
// These exercise the PRODUCTION handler factory from
// server/whmcs-admin-link-read-route.ts (wired into routes.ts), not a copy. The
// sibling LINKING writes (whmcs-admin-link-route.test.ts) prove the same
// authorization boundary for the suspend/link/unlink/auto-match writes; this
// file is the READ replica and additionally pins the "locked shape" + "pure
// read" contract the admin customer-detail billing panel depends on.
//
// Contracts under test:
//   1. Locked shape — the response is EXACTLY
//      { configured, enabled, link, linkedClient, suggestion } (no more, no less).
//   2. Graceful degradation — linkedClient/suggestion fall back to null when
//      WHMCS is unreachable; the handler never 500s on a lookup failure.
//   3. Pure read — no updateUser, no logActivity, ever. WHMCS lookups are
//      skipped entirely when not configured.
//   4. Authorization — GET is a READ, so requirePermission resolves to
//      users.VIEW. An unauthenticated caller (401), a customer (403), and an
//      admin with no role (403) are rejected before the handler runs and before
//      WHMCS is touched. A view-only admin (users.view) CAN read.

function client(id: number, email: string, fullName = "Test Client"): WhmcsClientSummary {
  return { id, firstName: "Test", lastName: "Client", fullName, companyName: "", email, status: "Active" };
}

const okClient = (c: WhmcsClientSummary | null): WhmcsClientLookup => ({ ok: true, client: c });
const failLookup = async (): Promise<WhmcsClientLookup> => ({ ok: false, reason: "network", error: "WHMCS unreachable" });

interface DepSpies {
  /** Forbidden side-effects for a pure read — these must stay empty. */
  writes: string[];
  byIdCalled: () => boolean;
  byEmailCalled: () => boolean;
}

interface MakeDepsOpts {
  users: Record<string, LinkReadRouteUser | undefined>;
  settings?: LinkReadSettings | null;
  configured?: boolean;
  getClientById?: LinkReadRouteDeps["getClientById"];
  getClientByEmail?: LinkReadRouteDeps["getClientByEmail"];
}

function makeDeps(opts: MakeDepsOpts): { deps: LinkReadRouteDeps; spies: DepSpies } {
  const writes: string[] = [];
  let byIdCalled = false;
  let byEmailCalled = false;
  const deps: LinkReadRouteDeps = {
    getUser: async (id) => opts.users[id],
    getWhmcsSettings: async () => opts.settings ?? null,
    hasWhmcsCredentials: () => opts.configured ?? true,
    // The handler only treats WHMCS as configured when BOTH credentials and a
    // usable base URL are present; mirror that by deriving from the same flag.
    normalizeBaseUrl: () => ((opts.configured ?? true) ? "https://billing.example.com" : null),
    getClientById: async (id) => {
      byIdCalled = true;
      return opts.getClientById ? opts.getClientById(id) : okClient(client(id, "linked@example.com"));
    },
    getClientByEmail: async (email) => {
      byEmailCalled = true;
      return opts.getClientByEmail ? opts.getClientByEmail(email) : okClient(null);
    },
  };
  return { deps, spies: { writes, byIdCalled: () => byIdCalled, byEmailCalled: () => byEmailCalled } };
}

// ---------- authorization gate (a faithful replica of routes.ts) ----------
//
// Mirrors server/routes.ts:requirePermission exactly, including the
// isWrite → managePerm selection. For a GET the gate resolves to the VIEW perm,
// which is the crux of the READ contract: a view-only admin CAN see a
// customer's billing link even though the sibling writes would reject them.

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
  app.get("/api/admin/users/:id/whmcs", requirePermission("users.view", "users.manage") as any, createWhmcsLinkReadHandler(deps));
  return { app, spies };
}

function makeUnguardedApp(opts: MakeDepsOpts) {
  const { deps, spies } = makeDeps(opts);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).session = { userId: "admin1" }; next(); });
  app.get("/api/admin/users/:id/whmcs", createWhmcsLinkReadHandler(deps));
  return { app, spies };
}

async function call(app: express.Express, path: string) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method: "GET" });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const PATH = "/api/admin/users/u1/whmcs";
const EXPECTED_KEYS = ["configured", "enabled", "link", "linkedClient", "suggestion"];

// ---------- locked shape ----------

test("response is EXACTLY { configured, enabled, link, linkedClient, suggestion } for an unlinked user", async () => {
  const { app, spies } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientByEmail: async () => okClient(null), // no suggestion match
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), [...EXPECTED_KEYS].sort());
  assert.equal(body.configured, true);
  assert.equal(body.enabled, true);
  assert.equal(body.link, null);
  assert.equal(body.linkedClient, null);
  assert.equal(body.suggestion, null);
  assert.equal(spies.writes.length, 0);
});

test("a linked user resolves link + linkedClient and never reaches the suggestion path", async () => {
  const { app, spies } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 42, whmcsLinkedAt: new Date("2026-01-02T00:00:00Z") } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientById: async () => okClient(client(42, "alice@example.com")),
    getClientByEmail: async () => { throw new Error("a linked user must not trigger a suggestion lookup"); },
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), [...EXPECTED_KEYS].sort());
  assert.equal(body.link.whmcsClientId, 42);
  assert.equal(body.linkedClient.id, 42);
  assert.equal(body.suggestion, null);
  assert.equal(spies.byIdCalled(), true);
  assert.equal(spies.byEmailCalled(), false, "a linked user must not consult getClientByEmail");
  assert.equal(spies.writes.length, 0);
});

test("an unlinked user with an email match surfaces a suggestion (still the locked shape)", async () => {
  const { app, spies } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientByEmail: async () => okClient(client(7, "alice@example.com")),
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), [...EXPECTED_KEYS].sort());
  assert.equal(body.link, null);
  assert.equal(body.linkedClient, null);
  assert.equal(body.suggestion.id, 7);
  assert.equal(spies.writes.length, 0, "surfacing a suggestion must NOT persist it");
});

// ---------- graceful degradation (never 500s on WHMCS failure) ----------

test("linkedClient degrades to null (not a 500) when the WHMCS lookup fails for a linked user", async () => {
  const { app } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 99, whmcsLinkedAt: new Date() } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientById: failLookup,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200, "a WHMCS lookup failure must not 500");
  assert.equal(body.link.whmcsClientId, 99, "the stored link is still returned");
  assert.equal(body.linkedClient, null, "an unreachable WHMCS degrades linkedClient to null");
});

test("suggestion degrades to null (not a 500) when the WHMCS email lookup fails", async () => {
  const { app } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientByEmail: failLookup,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.equal(body.suggestion, null);
});

test("when WHMCS is not configured, no lookups run and linkedClient/suggestion are null", async () => {
  const { app, spies } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 5, whmcsLinkedAt: new Date() } },
    settings: { baseUrl: null, enabled: true, autoMatchByEmail: true },
    configured: false,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.equal(body.configured, false);
  assert.equal(body.link.whmcsClientId, 5, "the stored link is still surfaced even when unconfigured");
  assert.equal(body.linkedClient, null);
  assert.equal(body.suggestion, null);
  assert.equal(spies.byIdCalled(), false, "an unconfigured WHMCS must not be queried");
  assert.equal(spies.byEmailCalled(), false);
});

test("no suggestion lookup when auto-match-by-email is disabled, even if configured + enabled", async () => {
  const { app, spies } = makeUnguardedApp({
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: false },
    configured: true,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.equal(body.suggestion, null);
  assert.equal(spies.byEmailCalled(), false, "auto-match disabled must skip the email lookup");
});

// ---------- not found ----------

test("an unknown user id returns 404 (no WHMCS lookups)", async () => {
  const { app, spies } = makeUnguardedApp({
    users: {},
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 404);
  assert.match(body.message, /User not found/);
  assert.equal(spies.byIdCalled(), false);
  assert.equal(spies.byEmailCalled(), false);
});

// ---------- authorization ----------

test("unauthenticated caller is rejected with 401 before the handler runs (no WHMCS)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: null,
    callers: {},
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
  });
  const { status } = await call(app, PATH);
  assert.equal(status, 401);
  assert.equal(spies.byIdCalled(), false);
  assert.equal(spies.byEmailCalled(), false);
});

test("a customer (non-admin) is rejected with 403 (WHMCS never called)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "cust",
    callers: { cust: { role: "customer" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
  });
  const { status } = await call(app, PATH);
  assert.equal(status, 403);
  assert.equal(spies.byIdCalled(), false);
  assert.equal(spies.byEmailCalled(), false);
});

test("an admin with NO role assigned is rejected with 403 (WHMCS never called)", async () => {
  const { app, spies } = makeGuardedApp({
    sessionUserId: "noRole",
    callers: { noRole: { role: "admin", adminRoleId: null } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 403);
  assert.match(body.message, /No admin role assigned/);
  assert.equal(spies.byIdCalled(), false);
});

test("a view-only admin (users.view only) CAN read the billing link (GET resolves to users.view)", async () => {
  // The crux of the READ contract: unlike the sibling writes, a view-only admin
  // is allowed to SEE a customer's billing link.
  const { app, spies } = makeGuardedApp({
    sessionUserId: "viewer",
    callers: { viewer: { role: "admin", adminRoleId: "role-view" } },
    rolePerms: { "role-view": ["users.view"] },
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com", whmcsClientId: 42, whmcsLinkedAt: new Date() } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientById: async () => okClient(client(42, "alice@example.com")),
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), [...EXPECTED_KEYS].sort());
  assert.equal(body.linkedClient.id, 42);
  assert.equal(spies.writes.length, 0);
});

test("a master_admin can read the billing link (200, locked shape)", async () => {
  const { app } = makeGuardedApp({
    sessionUserId: "boss",
    callers: { boss: { role: "master_admin" } },
    rolePerms: {},
    users: { u1: { id: "u1", username: "alice", email: "alice@example.com" } },
    settings: { baseUrl: "https://billing.example.com", enabled: true, autoMatchByEmail: true },
    configured: true,
    getClientByEmail: async () => okClient(null),
  });
  const { status, body } = await call(app, PATH);
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), [...EXPECTED_KEYS].sort());
});
