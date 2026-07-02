import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorLog, InsertErrorLog } from "../shared/schema";
import { createRequirePermission, createRequireMasterAdmin } from "./require-permission";

type ErrorLogStorage = {
  createErrorLog(data: InsertErrorLog): Promise<ErrorLog>;
  getErrorLogs(filters: { severity?: string; source?: string; resolved?: boolean; search?: string; page?: number; limit?: number }): Promise<{ logs: ErrorLog[]; total: number }>;
  getErrorLog(id: string): Promise<ErrorLog | undefined>;
  setErrorLogResolved(id: string, resolved: boolean, by?: string | null): Promise<ErrorLog | undefined>;
  resolveAllErrorLogs(by: string | null, filters?: { severity?: string; source?: string; search?: string }): Promise<number>;
  countUnresolvedErrorLogsSince(since: Date): Promise<number>;
  deleteOldErrorLogs(days: number): Promise<number>;
  deleteAllErrorLogs(filters?: { severity?: string; source?: string; resolved?: boolean; search?: string }): Promise<number>;
};

function makeMemoryStorage(): ErrorLogStorage {
  const rows = new Map<string, ErrorLog>();
  let seq = 0;
  return {
    async createErrorLog(data) {
      const id = `e-${++seq}`;
      const row: ErrorLog = {
        id,
        severity: data.severity,
        source: data.source,
        summary: data.summary,
        details: data.details ?? null,
        userId: data.userId ?? null,
        referenceType: data.referenceType ?? null,
        referenceId: data.referenceId ?? null,
        resolvedAt: null,
        resolvedBy: null,
        createdAt: new Date(),
      };
      rows.set(id, row);
      return row;
    },
    async getErrorLogs(filters) {
      let logs = Array.from(rows.values());
      if (filters.severity) logs = logs.filter(l => l.severity === filters.severity);
      if (filters.source) logs = logs.filter(l => l.source === filters.source);
      if (filters.resolved === true) logs = logs.filter(l => l.resolvedAt !== null);
      if (filters.resolved === false) logs = logs.filter(l => l.resolvedAt === null);
      if (filters.search) {
        const s = filters.search.toLowerCase();
        logs = logs.filter(l => l.summary.toLowerCase().includes(s) || (l.details || "").toLowerCase().includes(s));
      }
      logs.sort((a, b) => +b.createdAt - +a.createdAt);
      const total = logs.length;
      const page = filters.page || 1;
      const limit = filters.limit || 50;
      logs = logs.slice((page - 1) * limit, (page - 1) * limit + limit);
      return { logs, total };
    },
    async getErrorLog(id) { return rows.get(id); },
    async setErrorLogResolved(id, resolved, by) {
      const r = rows.get(id);
      if (!r) return undefined;
      const updated = { ...r, resolvedAt: resolved ? new Date() : null, resolvedBy: resolved ? (by ?? null) : null };
      rows.set(id, updated);
      return updated;
    },
    async resolveAllErrorLogs(by, filters) {
      let n = 0;
      for (const [id, r] of Array.from(rows.entries())) {
        if (r.resolvedAt !== null) continue;
        if (filters?.severity && r.severity !== filters.severity) continue;
        if (filters?.source && r.source !== filters.source) continue;
        if (filters?.search) {
          const s = filters.search.toLowerCase();
          if (!r.summary.toLowerCase().includes(s) && !(r.details || "").toLowerCase().includes(s)) continue;
        }
        rows.set(id, { ...r, resolvedAt: new Date(), resolvedBy: by ?? null });
        n++;
      }
      return n;
    },
    async countUnresolvedErrorLogsSince(since) {
      return Array.from(rows.values()).filter(r => r.resolvedAt === null && r.createdAt >= since).length;
    },
    async deleteOldErrorLogs(days) {
      const cutoff = Date.now() - days * 86400000;
      let n = 0;
      for (const [id, r] of rows) {
        if (+r.createdAt < cutoff) { rows.delete(id); n++; }
      }
      return n;
    },
    async deleteAllErrorLogs(filters) {
      let n = 0;
      for (const [id, r] of Array.from(rows.entries())) {
        if (filters?.severity && r.severity !== filters.severity) continue;
        if (filters?.source && r.source !== filters.source) continue;
        if (filters?.resolved === true && r.resolvedAt === null) continue;
        if (filters?.resolved === false && r.resolvedAt !== null) continue;
        if (filters?.search) {
          const s = filters.search.toLowerCase();
          if (!r.summary.toLowerCase().includes(s) && !(r.details || "").toLowerCase().includes(s)) continue;
        }
        rows.delete(id);
        n++;
      }
      return n;
    },
  };
}

// ---------- Storage CRUD ----------

test("createErrorLog persists row and getErrorLog reads it back", async () => {
  const s = makeMemoryStorage();
  const created = await s.createErrorLog({
    severity: "error", source: "push", summary: "Push failed", details: null,
    userId: "u-1", referenceType: null, referenceId: null,
  });
  const found = await s.getErrorLog(created.id);
  assert.equal(found?.summary, "Push failed");
  assert.equal(found?.userId, "u-1");
  assert.equal(found?.resolvedAt, null);
});

test("getErrorLogs filters by severity, source, resolved, and search", async () => {
  const s = makeMemoryStorage();
  await s.createErrorLog({ severity: "warn", source: "push", summary: "warn one", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "smtp boom", details: "stack", userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "fatal", source: "discord", summary: "discord 500", details: null, userId: null, referenceType: null, referenceId: null });
  assert.equal((await s.getErrorLogs({ severity: "fatal" })).total, 1);
  assert.equal((await s.getErrorLogs({ source: "push" })).total, 1);
  assert.equal((await s.getErrorLogs({ search: "smtp" })).total, 1);
  assert.equal((await s.getErrorLogs({ resolved: false })).total, 3);
  assert.equal((await s.getErrorLogs({ resolved: true })).total, 0);
});

test("setErrorLogResolved toggles state and tracks resolver", async () => {
  const s = makeMemoryStorage();
  const e = await s.createErrorLog({ severity: "error", source: "route", summary: "x", details: null, userId: null, referenceType: null, referenceId: null });
  const r = await s.setErrorLogResolved(e.id, true, "admin-1");
  assert.ok(r?.resolvedAt);
  assert.equal(r?.resolvedBy, "admin-1");
  const r2 = await s.setErrorLogResolved(e.id, false);
  assert.equal(r2?.resolvedAt, null);
  assert.equal(r2?.resolvedBy, null);
});

test("countUnresolvedErrorLogsSince counts only unresolved within window", async () => {
  const s = makeMemoryStorage();
  const a = await s.createErrorLog({ severity: "error", source: "push", summary: "a", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "push", summary: "b", details: null, userId: null, referenceType: null, referenceId: null });
  await s.setErrorLogResolved(a.id, true, "x");
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  assert.equal(await s.countUnresolvedErrorLogsSince(since), 1);
});

test("deleteAllErrorLogs with no filter removes everything and returns count", async () => {
  const s = makeMemoryStorage();
  await s.createErrorLog({ severity: "warn", source: "push", summary: "a", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "b", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "fatal", source: "route", summary: "c", details: null, userId: null, referenceType: null, referenceId: null });
  const deleted = await s.deleteAllErrorLogs();
  assert.equal(deleted, 3);
  assert.equal((await s.getErrorLogs({})).total, 0);
});

test("deleteAllErrorLogs is a safe no-op when the log is already empty", async () => {
  const s = makeMemoryStorage();
  const deleted = await s.deleteAllErrorLogs();
  assert.equal(deleted, 0);
});

test("deleteAllErrorLogs honors filters, leaving non-matching rows intact", async () => {
  const s = makeMemoryStorage();
  await s.createErrorLog({ severity: "warn", source: "push", summary: "keep me", details: null, userId: null, referenceType: null, referenceId: null });
  const e = await s.createErrorLog({ severity: "error", source: "email", summary: "smtp boom", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "smtp again", details: null, userId: null, referenceType: null, referenceId: null });
  await s.setErrorLogResolved(e.id, true, "admin-1");

  // Only unresolved email errors should go.
  const deleted = await s.deleteAllErrorLogs({ source: "email", resolved: false });
  assert.equal(deleted, 1);
  assert.equal((await s.getErrorLogs({})).total, 2);
  assert.equal((await s.getErrorLogs({ source: "push" })).total, 1);
  assert.equal((await s.getErrorLogs({ source: "email", resolved: true })).total, 1);
});

test("resolveAllErrorLogs resolves every unresolved row and stamps the resolver", async () => {
  const s = makeMemoryStorage();
  await s.createErrorLog({ severity: "warn", source: "push", summary: "a", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "b", details: null, userId: null, referenceType: null, referenceId: null });
  const resolved = await s.resolveAllErrorLogs("admin-9");
  assert.equal(resolved, 2);
  assert.equal((await s.getErrorLogs({ resolved: false })).total, 0);
  const all = await s.getErrorLogs({ resolved: true });
  assert.equal(all.total, 2);
  assert.ok(all.logs.every(l => l.resolvedBy === "admin-9" && l.resolvedAt !== null));
});

test("resolveAllErrorLogs skips already-resolved rows and returns only the count it changed", async () => {
  const s = makeMemoryStorage();
  const a = await s.createErrorLog({ severity: "warn", source: "push", summary: "a", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "b", details: null, userId: null, referenceType: null, referenceId: null });
  await s.setErrorLogResolved(a.id, true, "earlier-admin");
  const resolved = await s.resolveAllErrorLogs("admin-9");
  assert.equal(resolved, 1);
  // The pre-resolved row keeps its original resolver.
  assert.equal((await s.getErrorLog(a.id))?.resolvedBy, "earlier-admin");
});

test("resolveAllErrorLogs honors filters, leaving non-matching unresolved rows untouched", async () => {
  const s = makeMemoryStorage();
  await s.createErrorLog({ severity: "warn", source: "push", summary: "keep me", details: null, userId: null, referenceType: null, referenceId: null });
  await s.createErrorLog({ severity: "error", source: "email", summary: "smtp boom", details: null, userId: null, referenceType: null, referenceId: null });
  const resolved = await s.resolveAllErrorLogs("admin-9", { source: "email" });
  assert.equal(resolved, 1);
  assert.equal((await s.getErrorLogs({ resolved: false })).total, 1);
  assert.equal((await s.getErrorLogs({ source: "push", resolved: false })).total, 1);
});

test("resolveAllErrorLogs is a safe no-op when nothing is unresolved", async () => {
  const s = makeMemoryStorage();
  assert.equal(await s.resolveAllErrorLogs("admin-9"), 0);
});

// ---------- Permission gating ----------

// The Clear-all route is gated on master_admin, NOT the plain error_log.view
// permission used by the read/resolve routes — bulk delete is destructive.
test("clear-all master-admin gate blocks customers and delegated admins", async () => {
  const users: Record<string, { role: string }> = {
    cust: { role: "customer" },
    adminA: { role: "admin" },
    master: { role: "master_admin" },
  };
  const requireMasterAdmin = createRequireMasterAdmin({
    getUser: async (id) => users[id],
  });

  const cases: Array<{ uid: string | undefined; expected: number }> = [
    { uid: undefined, expected: 401 },
    { uid: "cust", expected: 403 },
    { uid: "adminA", expected: 403 },
    { uid: "master", expected: 200 },
  ];
  for (const c of cases) {
    const res = makeRes();
    let nextCalled = false;
    const req: any = { session: c.uid ? { userId: c.uid } : {}, method: "DELETE" };
    await requireMasterAdmin(req, res as any, () => { nextCalled = true; });
    if (c.expected === 200) {
      assert.equal(nextCalled, true, `uid=${c.uid} should pass`);
    } else {
      assert.equal(res.statusCode, c.expected, `uid=${c.uid}`);
    }
  }
});

type Res = { statusCode: number; body?: any; status: (n: number) => Res; json: (b: any) => Res };
function makeRes(): Res {
  const r: any = { statusCode: 200, status(n: number) { r.statusCode = n; return r; }, json(b: any) { r.body = b; return r; } };
  return r;
}

// Uses the REAL production gate (server/require-permission.ts) — admins are
// keyed to an adminRoleId whose permission list is resolved via getAdminRole.
test("permission gate blocks customers and admins lacking error_log.view", async () => {
  const users: Record<string, { role: string; adminRoleId: string | null }> = {
    cust: { role: "customer", adminRoleId: null },
    adminA: { role: "admin", adminRoleId: "role-empty" },
    adminB: { role: "admin", adminRoleId: "role-errlog" },
    master: { role: "master_admin", adminRoleId: null },
  };
  const rolePerms: Record<string, string[]> = { "role-empty": [], "role-errlog": ["error_log.view"] };
  const requirePermission = createRequirePermission({
    getUser: async (id) => users[id],
    getAdminRole: async (id) => (rolePerms[id] ? { permissions: rolePerms[id] } : undefined),
  });
  const handler = requirePermission("error_log.view");

  const cases: Array<{ uid: string | undefined; expected: number }> = [
    { uid: undefined, expected: 401 },
    { uid: "cust", expected: 403 },
    { uid: "adminA", expected: 403 },
    { uid: "adminB", expected: 200 },
    { uid: "master", expected: 200 },
  ];
  for (const c of cases) {
    const res = makeRes();
    let nextCalled = false;
    const req: any = { session: c.uid ? { userId: c.uid } : {}, method: "GET" };
    await handler(req, res as any, () => { nextCalled = true; });
    if (c.expected === 200) {
      assert.equal(nextCalled, true, `uid=${c.uid} should pass`);
    } else {
      assert.equal(res.statusCode, c.expected, `uid=${c.uid}`);
    }
  }
});

// ---------- Integration: failed push triggers logError ----------

test("integration: failed web-push call logs an error row via logError", async () => {
  const s = makeMemoryStorage();
  // Fake push send that always rejects
  const fakeWebpush = {
    sendNotification: async () => {
      const err: any = new Error("push gone");
      err.statusCode = 500;
      throw err;
    },
  };
  // Mirror the catch path in routes.ts
  async function trySendPush(userId: string) {
    try {
      await fakeWebpush.sendNotification();
    } catch (err: any) {
      const { buildErrorLogInsert } = await import("./error-log");
      const insert = buildErrorLogInsert("push", err, {
        severity: "warn",
        userId,
        summary: `Push failed (${err.statusCode}): hello`,
        extra: { statusCode: err.statusCode },
      });
      await s.createErrorLog(insert);
    }
  }
  await trySendPush("u-42");
  const { logs, total } = await s.getErrorLogs({ source: "push" });
  assert.equal(total, 1);
  assert.equal(logs[0].severity, "warn");
  assert.equal(logs[0].userId, "u-42");
  assert.match(logs[0].summary, /Push failed \(500\)/);
  assert.ok(logs[0].details && logs[0].details.includes("push gone"));
});
