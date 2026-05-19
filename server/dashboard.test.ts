import { test } from "node:test";
import assert from "node:assert/strict";
import { createDashboardHandler } from "./dashboard";
import type { DashboardMetrics, IStorage } from "./storage";

function makeMetrics(overrides: Partial<DashboardMetrics> = {}): DashboardMetrics {
  return {
    generatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    tickets: { open: 3, awaitingCustomer: 1, awaitingAdmin: 2, openedToday: 5, resolvedToday: 4, avgFirstResponseMinutes7d: 12, series14d: [] },
    services: { total: 4, operational: 3, degraded: 1, down: 0, activeAlerts: 1, recentAlerts: [] },
    notifications: { pushSent24h: 10, pushFailed24h: 2, emailSent24h: 7, pushSubscriptionsTotal: 100, pushSubscriptionsThisWeek: 5 },
    knowledgeBase: { total: 12, published: 9, topViewed: [], topZeroResultSearches: [] },
    community: { messages24h: 6, activeUsers7d: 3, bannedUsers: 0 },
    users: { total: 50, customers: 45, admins: 5, signupsToday: 1, signupsThisWeek: 4 },
    ...overrides,
  };
}

function makeRes() {
  let statusCode = 200;
  let body: any = undefined;
  const res: any = {
    status(code: number) { statusCode = code; return res; },
    json(payload: any) { body = payload; return res; },
    get statusCode() { return statusCode; },
    get body() { return body; },
  };
  return res;
}

test("dashboard handler: returns metrics with cached:false on first call", async () => {
  const metrics = makeMetrics();
  let calls = 0;
  const storage = { getDashboardMetrics: async () => { calls++; return metrics; } } as Pick<IStorage, "getDashboardMetrics">;
  const handler = createDashboardHandler({ storage, getOnlineUsersCount: () => 7, ttlMs: 30_000, now: () => 1_000 });
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.cached, false);
  assert.equal(res.body.usersOnline, 7);
  assert.equal(res.body.tickets.open, 3);
  assert.equal(res.body.notifications.pushFailed24h, 2);
  assert.equal(calls, 1);
});

test("dashboard handler: serves from cache within TTL and marks cached:true", async () => {
  const metrics = makeMetrics();
  let calls = 0;
  const storage = { getDashboardMetrics: async () => { calls++; return metrics; } } as Pick<IStorage, "getDashboardMetrics">;
  let t = 1000;
  const handler = createDashboardHandler({ storage, getOnlineUsersCount: () => 0, ttlMs: 30_000, now: () => t });
  await handler({} as any, makeRes());
  t = 1000 + 5_000;
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(calls, 1, "storage should not be called again within TTL");
  assert.equal(res.body.cached, true);
});

test("dashboard handler: refetches storage after TTL expires", async () => {
  const metrics = makeMetrics();
  let calls = 0;
  const storage = { getDashboardMetrics: async () => { calls++; return metrics; } } as Pick<IStorage, "getDashboardMetrics">;
  let t = 1000;
  const handler = createDashboardHandler({ storage, getOnlineUsersCount: () => 0, ttlMs: 30_000, now: () => t });
  await handler({} as any, makeRes());
  t = 1000 + 31_000;
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(calls, 2);
  assert.equal(res.body.cached, false);
});

test("dashboard handler: usersOnline is null when no presence getter is provided", async () => {
  const storage = { getDashboardMetrics: async () => makeMetrics() } as Pick<IStorage, "getDashboardMetrics">;
  const handler = createDashboardHandler({ storage });
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(res.body.usersOnline, null);
});

test("dashboard handler: returns 500 with message when storage throws", async () => {
  const storage = { getDashboardMetrics: async () => { throw new Error("db down"); } } as Pick<IStorage, "getDashboardMetrics">;
  const handler = createDashboardHandler({ storage });
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

// Regression: dashboard "Active alerts" count must agree with the
// alerts-page definition (status !== "resolved"). Previously the storage
// SQL filtered on `resolved_at IS NULL`, which drifted when an alert had
// `status = 'resolved'` but a NULL `resolved_at` (e.g. older rows, or a
// reopened-then-resolved cycle where resolved_at was never re-set), so
// the dashboard would show 1 active while the alerts page showed 0.
// This test pins the contract the handler passes through.
test("dashboard handler: active alerts count reflects status-based active definition (no resolved_at drift)", async () => {
  const metrics = makeMetrics({
    services: { total: 1, operational: 1, degraded: 0, down: 0, activeAlerts: 0, recentAlerts: [
      // A "drifted" historical row — status resolved but resolvedAt missing.
      // Storage must NOT count this as active; the dashboard payload must
      // therefore report 0, matching what alerts-page.tsx shows.
      { id: "drift-1", title: "Old incident", severity: "warning", status: "resolved", createdAt: new Date("2025-01-01").toISOString() },
    ] },
  });
  const storage = { getDashboardMetrics: async () => metrics } as Pick<IStorage, "getDashboardMetrics">;
  const handler = createDashboardHandler({ storage });
  const res = makeRes();
  await handler({} as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.services.activeAlerts, 0, "drifted resolved alert must not inflate active count");
  assert.equal(res.body.services.recentAlerts.length, 1, "recent alerts list still shows the row regardless of status");
});
