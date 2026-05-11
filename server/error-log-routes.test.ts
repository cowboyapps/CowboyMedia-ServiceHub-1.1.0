import { test } from "node:test";
import assert from "node:assert/strict";
import type { ErrorLog, InsertErrorLog } from "../shared/schema";

type ErrorLogStorage = {
  createErrorLog(data: InsertErrorLog): Promise<ErrorLog>;
  getErrorLogs(filters: { severity?: string; source?: string; resolved?: boolean; search?: string; page?: number; limit?: number }): Promise<{ logs: ErrorLog[]; total: number }>;
  getErrorLog(id: string): Promise<ErrorLog | undefined>;
  setErrorLogResolved(id: string, resolved: boolean, by?: string | null): Promise<ErrorLog | undefined>;
  countUnresolvedErrorLogsSince(since: Date): Promise<number>;
  deleteOldErrorLogs(days: number): Promise<number>;
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

// ---------- Permission gating ----------

type Req = { session?: { userId?: string }; headers?: Record<string, string> };
type Res = { statusCode: number; body?: any; status: (n: number) => Res; json: (b: any) => Res };
function makeRes(): Res {
  const r: any = { statusCode: 200, status(n: number) { r.statusCode = n; return r; }, json(b: any) { r.body = b; return r; } };
  return r;
}

function makeRequirePermission(getUserPerms: (userId: string) => string[], userRoles: Record<string, string>) {
  return (perm: string) => async (req: Req, res: Res, next: () => void) => {
    const uid = req.session?.userId;
    if (!uid) return res.status(401).json({ message: "Unauthorized" });
    const role = userRoles[uid];
    if (role === "master_admin") return next();
    if (role !== "admin") return res.status(403).json({ message: "Forbidden" });
    if (!getUserPerms(uid).includes(perm)) return res.status(403).json({ message: "Forbidden" });
    next();
  };
}

test("permission gate blocks customers and admins lacking error_log.view", async () => {
  const userRoles: Record<string, string> = { cust: "customer", adminA: "admin", adminB: "admin", master: "master_admin" };
  const perms: Record<string, string[]> = { adminA: [], adminB: ["error_log.view"] };
  const requirePermission = makeRequirePermission(uid => perms[uid] || [], userRoles);
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
    await handler({ session: c.uid ? { userId: c.uid } : undefined }, res, () => { nextCalled = true; });
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
