import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createDashboardHandler } from "./dashboard";
import type { DashboardMetrics } from "./storage";
import { createRequirePermission } from "./require-permission";

// Authorization is enforced by the REAL production gate
// (server/require-permission.ts) — no local replica. We inject a fake user/role
// lookup and a session middleware so the same factory routes.ts mounts is what
// guards this route under test.
type FakeUser = { id: string; role: string; adminRoleId: string | null };
type FakeRole = { id: string; permissions: string[] };

function metrics(): DashboardMetrics {
  return {
    generatedAt: new Date("2026-01-01").toISOString(),
    tickets: { open: 1, awaitingCustomer: 0, awaitingAdmin: 1, openedToday: 0, resolvedToday: 0, avgFirstResponseMinutes7d: null, series14d: [] },
    services: { total: 0, operational: 0, degraded: 0, down: 0, activeAlerts: 0, recentAlerts: [] },
    notifications: { pushSent24h: 0, pushFailed24h: 0, emailSent24h: 0, pushSubscriptionsTotal: 0, pushSubscriptionsThisWeek: 0 },
    knowledgeBase: { total: 0, published: 0, topViewed: [], topZeroResultSearches: [] },
    community: { messages24h: 0, activeUsers7d: 0, bannedUsers: 0 },
    users: { total: 0, customers: 0, admins: 0, signupsToday: 0, signupsThisWeek: 0 },
  };
}

function makeApp(sessionUserId: string | null) {
  const users = new Map<string, FakeUser>([
    ["customer-1", { id: "customer-1", role: "customer", adminRoleId: null }],
    ["admin-no-perm", { id: "admin-no-perm", role: "admin", adminRoleId: "role-empty" }],
    ["admin-with-perm", { id: "admin-with-perm", role: "admin", adminRoleId: "role-dashboard" }],
    ["master", { id: "master", role: "master_admin", adminRoleId: null }],
  ]);
  const roles = new Map<string, FakeRole>([
    ["role-empty", { id: "role-empty", permissions: ["users.view"] }],
    ["role-dashboard", { id: "role-dashboard", permissions: ["dashboard.view"] }],
  ]);
  const requirePermission = createRequirePermission({
    getUser: async (id) => users.get(id),
    getAdminRole: async (id) => roles.get(id),
  });
  const handler = createDashboardHandler({ storage: { getDashboardMetrics: async () => metrics() } });
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  app.get("/api/admin/dashboard", requirePermission("dashboard.view") as any, handler);
  return app;
}

async function call(app: express.Express): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}/api/admin/dashboard`)
        .then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then(out => { server.close(); resolve(out); })
        .catch(err => { server.close(); reject(err); });
    });
  });
}

test("dashboard route authz: anonymous gets 401", async () => {
  const r = await call(makeApp(null));
  assert.equal(r.status, 401);
});

test("dashboard route authz: customer is rejected with 403", async () => {
  const r = await call(makeApp("customer-1"));
  assert.equal(r.status, 403);
});

test("dashboard route authz: admin without dashboard.view is rejected", async () => {
  const r = await call(makeApp("admin-no-perm"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Insufficient permissions");
});

test("dashboard route authz: admin with dashboard.view receives metrics", async () => {
  const r = await call(makeApp("admin-with-perm"));
  assert.equal(r.status, 200);
  assert.equal(r.body.tickets.open, 1);
  assert.equal(r.body.cached, false);
  assert.equal(r.body.usersOnline, null);
});

test("dashboard route authz: master_admin bypasses permission list", async () => {
  const r = await call(makeApp("master"));
  assert.equal(r.status, 200);
  assert.equal(r.body.tickets.open, 1);
});
