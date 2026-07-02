import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { ErrorLog, InsertErrorLog } from "../shared/schema";
import { createErrorLogClearAllHandler, createErrorLogResolveAllHandler } from "./error-log-bulk-routes";
import { createRequirePermission, createRequireMasterAdmin } from "./require-permission";

// Route-level coverage for the two bulk error-log routes:
//   DELETE /api/admin/error-logs            (master_admin-gated clear-all)
//   POST   /api/admin/error-logs/resolve-all (error_log.view-gated resolve-all)
// The point (vs the storage tests in test/error-logs-bulk-filter-storage.test.ts)
// is proving the REAL handlers parse the query string and forward the matching
// filter object into storage — a wrong query key or a `resolved` param leaking
// into resolve-all would slip past both the client and storage tests.

type FakeUser = { id: string; role: string; adminRoleId: string | null; fullName: string };

function makeMemoryStorage() {
  const rows = new Map<string, ErrorLog>();
  let seq = 0;
  // Every filter object the handlers forward, recorded verbatim so tests can
  // assert exact shape (including which keys are undefined vs present).
  const received: { deleteFilters: any[]; resolveCalls: Array<{ by: string | null; filters: any }> } = {
    deleteFilters: [],
    resolveCalls: [],
  };
  const users = new Map<string, FakeUser>();

  const storage = {
    async createErrorLog(data: InsertErrorLog): Promise<ErrorLog> {
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
    async deleteAllErrorLogs(filters?: { severity?: string; source?: string; search?: string; resolved?: boolean }): Promise<number> {
      received.deleteFilters.push(filters);
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
    async resolveAllErrorLogs(by: string | null, filters?: { severity?: string; source?: string; search?: string }): Promise<number> {
      received.resolveCalls.push({ by, filters });
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
    async getUser(id: string) {
      return users.get(id);
    },
  };

  return { storage, rows, received, users };
}

function seedRows(storage: { createErrorLog(d: InsertErrorLog): Promise<ErrorLog> }) {
  const base = { details: null, userId: null, referenceType: null, referenceId: null };
  return Promise.all([
    storage.createErrorLog({ severity: "error", source: "email", summary: "smtp boom", ...base }),
    storage.createErrorLog({ severity: "error", source: "push", summary: "push died", ...base }),
    storage.createErrorLog({ severity: "warn", source: "email", summary: "smtp slow", ...base }),
    storage.createErrorLog({ severity: "fatal", source: "discord", summary: "discord 500", ...base }),
  ]);
}

// Real express app, real production gates (require-permission.ts), real
// handlers (error-log-bulk-routes.ts) — mirrors exactly how routes.ts mounts
// them. Only session + storage are injected.
function makeHarness() {
  const mem = makeMemoryStorage();
  mem.users.set("master", { id: "master", role: "master_admin", adminRoleId: null, fullName: "Master Max" });
  mem.users.set("admin-view", { id: "admin-view", role: "admin", adminRoleId: "role-errlog", fullName: "Viewer Vera" });
  mem.users.set("admin-empty", { id: "admin-empty", role: "admin", adminRoleId: "role-empty", fullName: "Empty Ed" });
  mem.users.set("cust", { id: "cust", role: "customer", adminRoleId: null, fullName: "Customer Carl" });
  const rolePerms: Record<string, string[]> = { "role-errlog": ["error_log.view"], "role-empty": [] };

  const requirePermission = createRequirePermission({
    getUser: async (id) => mem.users.get(id),
    getAdminRole: async (id) => (rolePerms[id] ? { permissions: rolePerms[id] } : undefined),
  });
  const requireMasterAdmin = createRequireMasterAdmin({
    getUser: async (id) => mem.users.get(id),
  });

  const activity: Array<{ category: string; action: string; opts: any }> = [];
  const logActivity = (category: string, action: string, opts: any) => {
    activity.push({ category, action, opts });
  };

  let sessionUserId: string | null = null;
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  app.delete("/api/admin/error-logs", requireMasterAdmin as any, createErrorLogClearAllHandler({ storage: mem.storage, logActivity }));
  app.post("/api/admin/error-logs/resolve-all", requirePermission("error_log.view") as any, createErrorLogResolveAllHandler({ storage: mem.storage, logActivity }));

  return {
    ...mem,
    activity,
    app,
    setUser(id: string | null) { sessionUserId = id; },
  };
}

async function call(app: express.Express, method: string, pathWithQuery: string): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${pathWithQuery}`, { method })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.closeAllConnections?.(); server.close(() => resolve(out)); })
        .catch((err) => { server.closeAllConnections?.(); server.close(() => reject(err)); });
    });
  });
}

// ---------- DELETE /api/admin/error-logs (clear-all) ----------

test("clear-all forwards ?severity&source into the storage filter and deletes only matching rows", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("master");

  const r = await call(h.app, "DELETE", "/api/admin/error-logs?severity=error&source=email");
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 1);

  // The exact filter object storage received — search/resolved stay undefined.
  assert.equal(h.received.deleteFilters.length, 1);
  assert.deepEqual(h.received.deleteFilters[0], {
    severity: "error",
    source: "email",
    search: undefined,
    resolved: undefined,
  });

  // Only the error+email row is gone; the other three survive.
  const remaining = Array.from(h.rows.values()).map((x) => x.summary).sort();
  assert.deepEqual(remaining, ["discord 500", "push died", "smtp slow"]);
});

test("clear-all parses ?resolved=false and search, deleting only unresolved matches", async () => {
  const h = makeHarness();
  const [smtpBoom] = await seedRows(h.storage);
  // Mark "smtp boom" resolved so resolved=false must skip it.
  h.rows.set(smtpBoom.id, { ...smtpBoom, resolvedAt: new Date(), resolvedBy: "master" });
  h.setUser("master");

  const r = await call(h.app, "DELETE", "/api/admin/error-logs?resolved=false&search=smtp");
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 1); // only unresolved "smtp slow"
  assert.deepEqual(h.received.deleteFilters[0], {
    severity: undefined,
    source: undefined,
    search: "smtp",
    resolved: false,
  });
  assert.ok(h.rows.has(smtpBoom.id), "resolved smtp row must survive resolved=false clear");
});

test("clear-all with no query string clears everything (filters all undefined)", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("master");

  const r = await call(h.app, "DELETE", "/api/admin/error-logs");
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 4);
  assert.deepEqual(h.received.deleteFilters[0], {
    severity: undefined,
    source: undefined,
    search: undefined,
    resolved: undefined,
  });
  assert.equal(h.rows.size, 0);
});

test("clear-all ignores a junk resolved value (neither true nor false → undefined)", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("master");

  const r = await call(h.app, "DELETE", "/api/admin/error-logs?resolved=banana");
  assert.equal(r.status, 200);
  assert.equal(h.received.deleteFilters[0].resolved, undefined);
  assert.equal(r.body.deleted, 4);
});

test("clear-all is master_admin-gated: anonymous 401, customer/delegated-admin 403, storage untouched", async () => {
  const h = makeHarness();
  await seedRows(h.storage);

  h.setUser(null);
  assert.equal((await call(h.app, "DELETE", "/api/admin/error-logs")).status, 401);
  h.setUser("cust");
  assert.equal((await call(h.app, "DELETE", "/api/admin/error-logs")).status, 403);
  h.setUser("admin-view"); // has error_log.view but is NOT master_admin
  assert.equal((await call(h.app, "DELETE", "/api/admin/error-logs")).status, 403);

  assert.equal(h.received.deleteFilters.length, 0, "storage must never be reached on a rejected request");
  assert.equal(h.rows.size, 4);
});

test("clear-all writes an activity-log entry naming the actor and the filter in effect", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("master");

  await call(h.app, "DELETE", "/api/admin/error-logs?source=email");
  assert.equal(h.activity.length, 1);
  assert.equal(h.activity[0].action, "error_logs_cleared");
  assert.equal(h.activity[0].opts.actorId, "master");
  assert.match(h.activity[0].opts.summary, /Master Max cleared 2 error log entries \(filter — source: email\)/);
});

// ---------- POST /api/admin/error-logs/resolve-all ----------

test("resolve-all forwards ?severity&source and stamps only matching unresolved rows with the session user", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("admin-view");

  const r = await call(h.app, "POST", "/api/admin/error-logs/resolve-all?severity=error&source=email");
  assert.equal(r.status, 200);
  assert.equal(r.body.resolved, 1);

  assert.equal(h.received.resolveCalls.length, 1);
  assert.equal(h.received.resolveCalls[0].by, "admin-view");
  assert.deepEqual(h.received.resolveCalls[0].filters, {
    severity: "error",
    source: "email",
    search: undefined,
  });

  const rows = Array.from(h.rows.values());
  const touched = rows.filter((x) => x.resolvedAt !== null);
  assert.equal(touched.length, 1);
  assert.equal(touched[0].summary, "smtp boom");
  assert.equal(touched[0].resolvedBy, "admin-view");
});

test("resolve-all deliberately does NOT forward a resolved query param — it only ever touches unresolved rows", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("admin-view");

  // A hostile/buggy client tacking on ?resolved=true must not change semantics.
  const r = await call(h.app, "POST", "/api/admin/error-logs/resolve-all?resolved=true&source=push");
  assert.equal(r.status, 200);
  assert.equal(r.body.resolved, 1);
  const filters = h.received.resolveCalls[0].filters;
  assert.equal("resolved" in filters, false, "resolved key must not exist in the resolve-all filter object");
  assert.deepEqual(filters, { severity: undefined, source: "push", search: undefined });
});

test("resolve-all with a search filter only resolves matching rows and skips already-resolved ones", async () => {
  const h = makeHarness();
  const [smtpBoom] = await seedRows(h.storage);
  h.rows.set(smtpBoom.id, { ...smtpBoom, resolvedAt: new Date(), resolvedBy: "earlier-admin" });
  h.setUser("admin-view");

  const r = await call(h.app, "POST", "/api/admin/error-logs/resolve-all?search=smtp");
  assert.equal(r.status, 200);
  assert.equal(r.body.resolved, 1); // only "smtp slow"; "smtp boom" already resolved
  assert.equal(h.rows.get(smtpBoom.id)?.resolvedBy, "earlier-admin", "pre-resolved row keeps its original resolver");
  const unresolved = Array.from(h.rows.values()).filter((x) => x.resolvedAt === null).map((x) => x.summary).sort();
  assert.deepEqual(unresolved, ["discord 500", "push died"]);
});

test("resolve-all is permission-gated on error_log.view: anonymous 401, customer/empty-role admin 403, master passes", async () => {
  const h = makeHarness();
  await seedRows(h.storage);

  h.setUser(null);
  assert.equal((await call(h.app, "POST", "/api/admin/error-logs/resolve-all")).status, 401);
  h.setUser("cust");
  assert.equal((await call(h.app, "POST", "/api/admin/error-logs/resolve-all")).status, 403);
  h.setUser("admin-empty");
  assert.equal((await call(h.app, "POST", "/api/admin/error-logs/resolve-all")).status, 403);
  assert.equal(h.received.resolveCalls.length, 0, "storage must never be reached on a rejected request");

  h.setUser("master");
  const r = await call(h.app, "POST", "/api/admin/error-logs/resolve-all");
  assert.equal(r.status, 200);
  assert.equal(r.body.resolved, 4);
  assert.equal(h.received.resolveCalls[0].by, "master");
});

test("resolve-all writes an activity-log entry naming the actor and the filter in effect", async () => {
  const h = makeHarness();
  await seedRows(h.storage);
  h.setUser("admin-view");

  await call(h.app, "POST", "/api/admin/error-logs/resolve-all?severity=warn");
  assert.equal(h.activity.length, 1);
  assert.equal(h.activity[0].action, "error_logs_resolved_all");
  assert.equal(h.activity[0].opts.actorId, "admin-view");
  assert.match(h.activity[0].opts.summary, /Viewer Vera resolved 1 error log entry \(filter — severity: warn\)/);
});
