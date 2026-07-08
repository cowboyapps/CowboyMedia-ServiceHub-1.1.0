import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AlertDraft, InsertAlertDraft } from "../shared/schema";
import {
  onMonitorDownCreateDraft,
  onMonitorUpCreateRecoveryDraft,
  registerAlertDraftRoutes,
  type AlertDraftStorage,
} from "./alert-drafts";
import { createRequirePermission } from "./require-permission";

// Coverage for the monitor→draft hooks (episode suppression, supersede rules)
// and the two admin draft routes over real HTTP. The hard rule under test:
// nothing here ever creates a service alert or fans out to customers — only
// alert_drafts rows change.

type FakeUser = { id: string; role: string; adminRoleId: string | null; fullName: string };

function makeMemoryStorage() {
  const drafts = new Map<string, AlertDraft>();
  let seq = 0;
  const activeAlertsByService = new Map<string, string>(); // serviceId -> alertId
  const activeAlertIds = new Set<string>();

  const storage: AlertDraftStorage & {
    getAlertDrafts(status?: string): Promise<AlertDraft[]>;
    getAlertDraft(id: string): Promise<AlertDraft | undefined>;
  } = {
    async getAlertDraftsForMonitor(monitorId: string) {
      return Array.from(drafts.values()).filter(d => d.monitorId === monitorId);
    },
    async createAlertDraft(data: InsertAlertDraft) {
      const id = `draft-${++seq}`;
      const row: AlertDraft = {
        id,
        monitorId: data.monitorId,
        monitorIncidentId: data.monitorIncidentId ?? null,
        serviceId: data.serviceId ?? null,
        kind: data.kind,
        suggestedTitle: data.suggestedTitle,
        suggestedDescription: data.suggestedDescription,
        suggestedSeverity: data.suggestedSeverity ?? "critical",
        suggestedServiceImpact: data.suggestedServiceImpact ?? "outage",
        relatedAlertId: data.relatedAlertId ?? null,
        status: data.status ?? "pending",
        actedByUserId: null,
        actedAt: null,
        createdAt: new Date(),
      };
      drafts.set(id, row);
      return row;
    },
    async updateAlertDraft(id: string, data: Partial<AlertDraft>) {
      const cur = drafts.get(id);
      if (!cur) return undefined;
      const next = { ...cur, ...data };
      drafts.set(id, next);
      return next;
    },
    async serviceHasActiveAlert(serviceId: string) {
      return activeAlertsByService.has(serviceId);
    },
    async getActiveAlertIdForService(serviceId: string) {
      return activeAlertsByService.get(serviceId) ?? null;
    },
    async isAlertActive(alertId: string) {
      return activeAlertIds.has(alertId);
    },
    async getService(id: string) {
      return { id, name: `Service ${id}` };
    },
    async getAlertDrafts(status?: string) {
      const all = Array.from(drafts.values());
      return status ? all.filter(d => d.status === status) : all;
    },
    async getAlertDraft(id: string) {
      return drafts.get(id);
    },
  };

  return { storage, drafts, activeAlertsByService, activeAlertIds };
}

const MONITOR = { id: "mon-1", name: "API Monitor", serviceId: "svc-1" } as const;
// Real clock: the memory store stamps createdAt with `new Date()`, so a fixed
// past/future NOW would silently expire (or never start) the 60-min cooldown.
const NOW = new Date();

// ---------- down hook ----------

test("down: creates a pending outage draft with service name + reason and pings admins", async () => {
  const mem = makeMemoryStorage();
  const pings: string[] = [];
  const d = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1", failureReason: "HTTP 503" }, NOW, {
    storage: mem.storage,
    notifyAdminsDraftReady: (draft) => { pings.push(draft.id); },
  });
  assert.ok(d);
  assert.equal(d!.kind, "outage");
  assert.equal(d!.status, "pending");
  assert.equal(d!.suggestedTitle, "Service svc-1 is experiencing an outage");
  assert.match(d!.suggestedDescription, /HTTP 503/);
  assert.equal(d!.suggestedSeverity, "critical");
  assert.equal(d!.suggestedServiceImpact, "outage");
  assert.equal(d!.monitorIncidentId, "inc-1");
  assert.deepEqual(pings, [d!.id]);
});

test("down flap: second episode attaches the new incident to the pending draft instead of creating another", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1", failureReason: "x" }, NOW, { storage: mem.storage });
  const second = await onMonitorDownCreateDraft(MONITOR, { id: "inc-2", failureReason: "y" }, NOW, { storage: mem.storage });
  assert.ok(first);
  assert.equal(second, null);
  assert.equal(mem.drafts.size, 1);
  assert.equal(mem.drafts.get(first!.id)!.monitorIncidentId, "inc-2");
});

test("down: suppressed when an active alert already covers the service", async () => {
  const mem = makeMemoryStorage();
  mem.activeAlertsByService.set("svc-1", "alert-1");
  const d = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  assert.equal(d, null);
  assert.equal(mem.drafts.size, 0);
});

test("down after a dismissed draft within cooldown: still suppressed (admin said no — don't re-nag on flap)", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  await mem.storage.updateAlertDraft(first!.id, { status: "dismissed" });
  const second = await onMonitorDownCreateDraft(MONITOR, { id: "inc-2" }, NOW, { storage: mem.storage });
  assert.equal(second, null);
  assert.equal(mem.drafts.size, 1);
});

test("down→up→down flap with no published alert creates exactly ONE outage draft", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  assert.ok(first);
  // Up: blip self-resolved before anyone acted → draft superseded, no recovery.
  const rec = await onMonitorUpCreateRecoveryDraft(MONITOR, 90, NOW, { storage: mem.storage });
  assert.equal(rec, null);
  assert.equal(mem.drafts.get(first!.id)!.status, "superseded");
  // Down again 10 minutes later: same episode → NO second card.
  const later = new Date(NOW.getTime() + 10 * 60_000);
  const second = await onMonitorDownCreateDraft(MONITOR, { id: "inc-2" }, later, { storage: mem.storage });
  assert.equal(second, null);
  assert.equal(mem.drafts.size, 1, "flapping must never mint a second outage draft inside the cooldown");
});

test("down flap while a recovery draft is pending: recovery draft superseded, no new outage draft (alert still active)", async () => {
  const mem = makeMemoryStorage();
  mem.activeAlertsByService.set("svc-1", "alert-1");
  mem.activeAlertIds.add("alert-1");
  // Simulate an existing pending recovery draft from the last up transition.
  const rec = await mem.storage.createAlertDraft({
    monitorId: MONITOR.id, monitorIncidentId: null, serviceId: "svc-1", kind: "recovery",
    suggestedTitle: "t", suggestedDescription: "d", suggestedSeverity: "info",
    suggestedServiceImpact: "operational", relatedAlertId: "alert-1", status: "pending",
  });
  const d = await onMonitorDownCreateDraft(MONITOR, { id: "inc-3" }, NOW, { storage: mem.storage });
  assert.equal(d, null, "published alert still covers the service → no new outage draft");
  assert.equal(mem.drafts.get(rec.id)!.status, "superseded");
});

// ---------- up hook ----------

test("up: never-published pending outage draft is superseded, no recovery draft", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  const rec = await onMonitorUpCreateRecoveryDraft(MONITOR, 120, NOW, { storage: mem.storage });
  assert.equal(rec, null);
  assert.equal(mem.drafts.get(first!.id)!.status, "superseded");
  assert.equal(mem.drafts.size, 1);
});

test("up: published outage draft with still-active alert → pending recovery draft with relatedAlertId + downtime", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  await mem.storage.updateAlertDraft(first!.id, { status: "published", relatedAlertId: "alert-1" });
  mem.activeAlertIds.add("alert-1");
  const pings: string[] = [];
  const rec = await onMonitorUpCreateRecoveryDraft(MONITOR, 7500, NOW, {
    storage: mem.storage,
    notifyAdminsDraftReady: (d) => { pings.push(d.id); },
  });
  assert.ok(rec);
  assert.equal(rec!.kind, "recovery");
  assert.equal(rec!.relatedAlertId, "alert-1");
  assert.match(rec!.suggestedDescription, /2h 5m/);
  assert.deepEqual(pings, [rec!.id]);
});

test("up: published draft whose alert was already resolved falls back to the service's active alert, else nothing", async () => {
  const mem = makeMemoryStorage();
  const first = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: mem.storage });
  await mem.storage.updateAlertDraft(first!.id, { status: "published", relatedAlertId: "alert-old" });
  // alert-old resolved; no active alert on the service → no recovery draft.
  const rec = await onMonitorUpCreateRecoveryDraft(MONITOR, 60, NOW, { storage: mem.storage });
  assert.equal(rec, null);
  // Now a manual active alert covers the service → recovery draft points at it.
  mem.activeAlertsByService.set("svc-1", "alert-manual");
  const rec2 = await onMonitorUpCreateRecoveryDraft(MONITOR, 60, NOW, { storage: mem.storage });
  assert.equal(rec2!.relatedAlertId, "alert-manual");
});

test("up: an existing pending recovery draft blocks a duplicate", async () => {
  const mem = makeMemoryStorage();
  mem.activeAlertsByService.set("svc-1", "alert-1");
  const rec1 = await onMonitorUpCreateRecoveryDraft(MONITOR, 60, NOW, { storage: mem.storage });
  const rec2 = await onMonitorUpCreateRecoveryDraft(MONITOR, 60, NOW, { storage: mem.storage });
  assert.ok(rec1);
  assert.equal(rec2, null);
});

// ---------- routes ----------

function makeHarness() {
  const mem = makeMemoryStorage();
  const users = new Map<string, FakeUser>();
  users.set("master", { id: "master", role: "master_admin", adminRoleId: null, fullName: "Master" });
  users.set("admin-view", { id: "admin-view", role: "admin", adminRoleId: "role-view", fullName: "Viewer" });
  users.set("admin-manage", { id: "admin-manage", role: "admin", adminRoleId: "role-manage", fullName: "Manager" });
  users.set("cust", { id: "cust", role: "customer", adminRoleId: null, fullName: "Customer" });
  const rolePerms: Record<string, string[]> = {
    "role-view": ["alerts.view"],
    "role-manage": ["alerts.view", "alerts.manage"],
  };

  const requirePermission = createRequirePermission({
    getUser: async (id) => users.get(id),
    getAdminRole: async (id) => (rolePerms[id] ? { permissions: rolePerms[id] } : undefined),
  });

  let sessionUserId: string | null = null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = sessionUserId ? { userId: sessionUserId } : {};
    next();
  });
  registerAlertDraftRoutes(app, { requirePermission: requirePermission as any }, { storage: mem.storage });

  return { ...mem, app, setUser(id: string | null) { sessionUserId = id; } };
}

async function call(app: express.Express, method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.closeAllConnections?.(); server.close(() => resolve(out)); })
        .catch((err) => { server.closeAllConnections?.(); server.close(() => reject(err)); });
    });
  });
}

test("GET /api/admin/alert-drafts?status=pending returns only pending drafts; view permission suffices", async () => {
  const h = makeHarness();
  const a = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: h.storage });
  await h.storage.updateAlertDraft(a!.id, { status: "dismissed" });
  await onMonitorDownCreateDraft({ ...MONITOR, id: "mon-2" }, { id: "inc-2" }, NOW, { storage: h.storage });

  h.setUser("admin-view");
  const r = await call(h.app, "GET", "/api/admin/alert-drafts?status=pending");
  assert.equal(r.status, 200);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].monitorId, "mon-2");

  h.setUser(null);
  assert.equal((await call(h.app, "GET", "/api/admin/alert-drafts")).status, 401);
  h.setUser("cust");
  assert.equal((await call(h.app, "GET", "/api/admin/alert-drafts")).status, 403);
});

test("PATCH dismiss/publish updates a pending draft, stamps actor, and rejects repeats with 409", async () => {
  const h = makeHarness();
  const a = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: h.storage });

  h.setUser("admin-manage");
  const r1 = await call(h.app, "PATCH", `/api/admin/alert-drafts/${a!.id}`, { status: "published", relatedAlertId: "alert-7" });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.status, "published");
  assert.equal(r1.body.relatedAlertId, "alert-7");
  assert.equal(r1.body.actedByUserId, "admin-manage");

  const r2 = await call(h.app, "PATCH", `/api/admin/alert-drafts/${a!.id}`, { status: "dismissed" });
  assert.equal(r2.status, 409);
});

test("PATCH validates the body (bad status → 400) and requires manage permission", async () => {
  const h = makeHarness();
  const a = await onMonitorDownCreateDraft(MONITOR, { id: "inc-1" }, NOW, { storage: h.storage });

  h.setUser("admin-manage");
  assert.equal((await call(h.app, "PATCH", `/api/admin/alert-drafts/${a!.id}`, { status: "superseded" })).status, 400);
  assert.equal((await call(h.app, "PATCH", "/api/admin/alert-drafts/nope", { status: "dismissed" })).status, 404);

  h.setUser("admin-view"); // view-only cannot act on drafts
  assert.equal((await call(h.app, "PATCH", `/api/admin/alert-drafts/${a!.id}`, { status: "dismissed" })).status, 403);
  assert.equal(h.drafts.get(a!.id)!.status, "pending");
});
