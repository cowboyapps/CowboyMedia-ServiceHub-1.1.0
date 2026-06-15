import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runWhmcsServiceNotifyPass,
  RENEW_SOON_DAYS,
  categoryForKind,
  SERVICE_READY_CATEGORY_KEY,
  type WhmcsServiceNotifierDeps,
  type ServiceNotifierUser,
  type NotifierService,
  type PendingOrder,
} from "../server/whmcs-service-notifier";
import type { ServiceEventKind, ServiceMarker, ServiceMarkerMap } from "../shared/whmcs-service-notify";

// Fixed "now" so renewal thresholds are deterministic. RENEW_SOON_DAYS is 7, so
// the renewal window on 2026-06-11 is [2026-06-11 .. 2026-06-18].
const NOW = () => new Date("2026-06-11T12:00:00Z");

const mkUser = (over: Partial<ServiceNotifierUser> = {}): ServiceNotifierUser => ({
  id: "u1",
  email: "user@example.com",
  fullName: "Test User",
  whmcsClientId: 100,
  notificationPrefs: null,
  role: "customer",
  ...over,
});

const mkService = (over: Partial<NotifierService> = {}): NotifierService => ({
  id: 1,
  name: "Web Hosting",
  domain: "example.com",
  status: "Active",
  nextDueDate: "2026-09-01", // far out, no renewal
  ...over,
});

interface Recorder {
  inApp: Array<{ userId: string; serviceId: number; kind: ServiceEventKind }>;
  pushes: Array<{ userId: string; serviceId: number; kind: ServiceEventKind; notificationId: string | null }>;
  emails: Array<{ userId: string; serviceId: number; kind: ServiceEventKind }>;
  recorded: Array<{ userId: string; serviceId: number; marker: ServiceMarker }>;
  loads: Array<{ clientId: number }>;
  readyInApp: Array<{ userId: string; serviceId: number }>;
  readyPushes: Array<{ userId: string; serviceId: number; notificationId: string | null }>;
  fulfilled: string[];
}

function makeDeps(opts: {
  active?: boolean;
  baseUrl?: string | null;
  users?: ServiceNotifierUser[];
  servicesByClient?: Record<number, NotifierService[]>;
  unreachableClients?: Set<number>;
  markerState?: Record<string, ServiceMarkerMap>;
  wantsPush?: boolean;
  wantsEmail?: boolean;
  prefsOn?: boolean;
  getConfigThrows?: boolean;
  getLinkedUsersThrows?: boolean;
  createInAppReturns?: string | null;
  // Ready-detection (Task #474). Supplying pendingByUser enables all four hooks.
  pendingByUser?: Record<string, PendingOrder[]>;
  getPendingOrdersThrows?: boolean;
  readyInAppReturns?: string | null;
  wantsReadyPush?: boolean;
}): { deps: WhmcsServiceNotifierDeps; rec: Recorder; state: Record<string, ServiceMarkerMap> } {
  const rec: Recorder = {
    inApp: [],
    pushes: [],
    emails: [],
    recorded: [],
    loads: [],
    readyInApp: [],
    readyPushes: [],
    fulfilled: [],
  };
  const state: Record<string, ServiceMarkerMap> = JSON.parse(JSON.stringify(opts.markerState ?? {}));
  const unreachable = opts.unreachableClients ?? new Set<number>();
  // Mutable copy so consumed orders persist across passes within one test.
  const pending: Record<string, PendingOrder[]> = JSON.parse(JSON.stringify(opts.pendingByUser ?? {}));
  const readyEnabled = opts.pendingByUser !== undefined;

  const deps: WhmcsServiceNotifierDeps = {
    now: NOW,
    getConfig: async () => {
      if (opts.getConfigThrows) throw new Error("config boom");
      return { active: opts.active ?? true, baseUrl: opts.baseUrl ?? "https://cowboymedia.net/billing" };
    },
    getLinkedUsers: async () => {
      if (opts.getLinkedUsersThrows) throw new Error("users boom");
      return opts.users ?? [];
    },
    loadServices: async (clientId) => {
      rec.loads.push({ clientId });
      if (unreachable.has(clientId)) return { services: [], unreachable: true };
      return { services: (opts.servicesByClient ?? {})[clientId] ?? [], unreachable: false };
    },
    getMarkers: async (userId) => state[userId] ?? {},
    recordMarker: async (userId, serviceId, marker) => {
      rec.recorded.push({ userId, serviceId, marker });
      state[userId] = { ...(state[userId] ?? {}), [String(serviceId)]: marker };
    },
    createInApp: async (user, service, kind) => {
      rec.inApp.push({ userId: user.id, serviceId: service.id, kind });
      return opts.createInAppReturns === undefined ? "notif-1" : opts.createInAppReturns;
    },
    sendPush: (user, service, kind, _baseUrl, notificationId) =>
      rec.pushes.push({ userId: user.id, serviceId: service.id, kind, notificationId }),
    sendEmail: (user, service, kind) => rec.emails.push({ userId: user.id, serviceId: service.id, kind }),
    wantsPush: (_user, categoryKey) =>
      categoryKey === SERVICE_READY_CATEGORY_KEY ? (opts.wantsReadyPush ?? true) : (opts.wantsPush ?? true),
    wantsEmail: () => opts.wantsEmail ?? true,
    prefsOn: () => opts.prefsOn ?? true,
  };

  if (readyEnabled) {
    deps.getPendingOrders = async (userId) => {
      if (opts.getPendingOrdersThrows) throw new Error("pending boom");
      return pending[userId] ?? [];
    };
    deps.markPendingOrderFulfilled = async (orderId) => {
      rec.fulfilled.push(orderId);
      // Remove from every user's queue so a fulfilled order can't fire again.
      for (const uid of Object.keys(pending)) {
        pending[uid] = pending[uid].filter((o) => o.id !== orderId);
      }
    };
    deps.createReadyInApp = async (user, service) => {
      rec.readyInApp.push({ userId: user.id, serviceId: service.id });
      return opts.readyInAppReturns === undefined ? "ready-notif-1" : opts.readyInAppReturns;
    };
    deps.sendReadyPush = (user, service, _baseUrl, notificationId) =>
      rec.readyPushes.push({ userId: user.id, serviceId: service.id, notificationId });
  }

  return { deps, rec, state };
}

test("categoryForKind: renewal vs status categories", () => {
  assert.equal(categoryForKind("renewal"), "whmcs_service_renewal");
  assert.equal(categoryForKind("suspended"), "whmcs_service_status");
  assert.equal(categoryForKind("unsuspended"), "whmcs_service_status");
});

test("no-op when WHMCS is inactive: no loads, no sends, no markers", async () => {
  const { deps, rec } = makeDeps({ active: false, users: [mkUser()], servicesByClient: { 100: [mkService()] } });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(result.usersScanned, 0);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.loads.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("getConfig throwing is swallowed and reported inactive (no sends)", async () => {
  const { deps, rec } = makeDeps({ getConfigThrows: true, users: [mkUser()], servicesByClient: { 100: [mkService()] } });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.active, false);
  assert.equal(rec.loads.length, 0);
});

test("getLinkedUsers throwing yields active pass with nothing scanned", async () => {
  const { deps, rec } = makeDeps({ getLinkedUsersThrows: true });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.active, true);
  assert.equal(result.usersScanned, 0);
  assert.equal(rec.loads.length, 0);
});

test("skips users with no linked client id", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "nolink", whmcsClientId: null }), mkUser({ id: "linked", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService()] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.deepEqual(rec.loads, [{ clientId: 100 }]);
});

test("unreachable WHMCS for a user → no marker (degrades cleanly)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService()] },
    unreachableClients: new Set([100]),
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.usersScanned, 1);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);
});

test("first sighting records a silent baseline (no notifications)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.emails.length, 0);
  assert.equal(rec.inApp.length, 0);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "suspended", lastRenewalNotified: null } },
  ]);
});

test("baseline of an in-window active service suppresses the renewal (records the due date)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-06-14" })] },
  });
  await runWhmcsServiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 0);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "active", lastRenewalNotified: "2026-06-14" } },
  ]);
});

test("active->suspended fires push + email + bell and advances the status marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 1);
  assert.deepEqual(rec.inApp, [{ userId: "u1", serviceId: 7, kind: "suspended" }]);
  assert.deepEqual(rec.pushes, [{ userId: "u1", serviceId: 7, kind: "suspended", notificationId: "notif-1" }]);
  assert.deepEqual(rec.emails, [{ userId: "u1", serviceId: 7, kind: "suspended" }]);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "suspended", lastRenewalNotified: null } },
  ]);
});

test("suspended->active fires the unsuspended event", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-09-01" })] },
    markerState: { u1: { "7": { lastSeenStatus: "suspended", lastRenewalNotified: null } } },
  });
  await runWhmcsServiceNotifyPass(deps);
  assert.deepEqual(rec.pushes, [{ userId: "u1", serviceId: 7, kind: "unsuspended", notificationId: "notif-1" }]);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "active", lastRenewalNotified: null } },
  ]);
});

test("renewal event fires and records the due date as the renewal marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-06-14" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 1);
  assert.deepEqual(rec.pushes, [{ userId: "u1", serviceId: 7, kind: "renewal", notificationId: "notif-1" }]);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "active", lastRenewalNotified: "2026-06-14" } },
  ]);
});

test("no events when nothing changed: no marker write (no churn)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-09-01" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.recorded.length, 0);
});

test("non-notifying status change (active->terminated) silently advances the marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Terminated" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  await runWhmcsServiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 0);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "terminated", lastRenewalNotified: null } },
  ]);
});

test("channel gating: push-off + email-on sends only email, still bell + marker", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
    wantsPush: false,
    wantsEmail: true,
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 1);
  assert.equal(rec.pushes.length, 0);
  assert.deepEqual(rec.inApp, [{ userId: "u1", serviceId: 7, kind: "suspended" }]);
  assert.deepEqual(rec.emails, [{ userId: "u1", serviceId: 7, kind: "suspended" }]);
  assert.equal(rec.recorded.length, 1);
});

test("both channels off (prefs off): no bell row, but marker still advances", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
    wantsPush: false,
    wantsEmail: false,
    prefsOn: false,
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.inApp.length, 0);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "suspended", lastRenewalNotified: null } },
  ]);
});

test("quiet hours: prefs ON but suppressed → no delivery AND no marker advance (retries)", async () => {
  const { deps, rec, state } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
    wantsPush: false,
    wantsEmail: false,
    prefsOn: true,
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.eventsNotified, 0);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0); // marker SKIPPED so it retries
  assert.deepEqual(state["u1"]["7"], { lastSeenStatus: "active", lastRenewalNotified: null });
});

test("quiet hours then delivery: a suppressed pass re-delivers on the next pass", async () => {
  let suppressed = true;
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  deps.wantsPush = () => !suppressed;
  deps.wantsEmail = () => !suppressed;
  deps.prefsOn = () => true;

  await runWhmcsServiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 0);
  assert.equal(rec.recorded.length, 0);

  suppressed = false;
  await runWhmcsServiceNotifyPass(deps);
  assert.equal(rec.pushes.length, 1);
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "suspended", lastRenewalNotified: null } },
  ]);
});

test("push reuses created bell row id; falls back to its own row when createInApp fails", async () => {
  const reuse = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
    wantsEmail: false,
  });
  await runWhmcsServiceNotifyPass(reuse.deps);
  assert.equal(reuse.rec.pushes[0].notificationId, "notif-1");

  const fallback = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
    wantsEmail: false,
    createInAppReturns: null,
  });
  await runWhmcsServiceNotifyPass(fallback.deps);
  assert.equal(fallback.rec.pushes[0].notificationId, null);
});

test("dedupe across two passes: a suspended event fires once", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Suspended" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  await runWhmcsServiceNotifyPass(deps);
  const second = await runWhmcsServiceNotifyPass(deps);
  assert.equal(second.eventsNotified, 0);
  assert.equal(rec.pushes.length, 1);
});

test("renewal re-fires on the next billing cycle once the due date advances", async () => {
  const services = { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-06-14" })] };
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: services,
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  await runWhmcsServiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.kind), ["renewal"]);

  // Same date next pass: no re-fire.
  await runWhmcsServiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.kind), ["renewal"]);

  // WHMCS advances the due date to the next cycle (still inside the window).
  services[100][0].nextDueDate = "2026-06-16";
  await runWhmcsServiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.kind), ["renewal", "renewal"]);
});

test("a throw for one user does not abort the pass for the rest", async () => {
  const { deps, rec, state } = makeDeps({
    users: [mkUser({ id: "boom", whmcsClientId: 100 }), mkUser({ id: "ok", whmcsClientId: 200 })],
    servicesByClient: { 200: [mkService({ id: 9, status: "Suspended" })] },
    markerState: { ok: { "9": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  const realGetMarkers = deps.getMarkers;
  deps.getMarkers = async (userId) => {
    if (userId === "boom") throw new Error("markers boom");
    return realGetMarkers(userId);
  };
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.usersScanned, 2);
  assert.equal(result.eventsNotified, 1);
  assert.deepEqual(rec.recorded, [
    { userId: "ok", serviceId: 9, marker: { lastSeenStatus: "suspended", lastRenewalNotified: null } },
  ]);
  assert.equal(state["boom"], undefined);
});

test("RENEW_SOON_DAYS window boundary: service due exactly today+RENEW_SOON_DAYS fires", async () => {
  assert.equal(RENEW_SOON_DAYS, 7);
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", nextDueDate: "2026-06-18" })] },
    markerState: { u1: { "7": { lastSeenStatus: "active", lastRenewalNotified: null } } },
  });
  await runWhmcsServiceNotifyPass(deps);
  assert.deepEqual(rec.pushes.map((p) => p.kind), ["renewal"]);
});

// --- "New service is ready" detection (Task #474) ----------------------------

test("ready fires on a brand-new ACTIVE service (baseline) matching a pending order", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 1);
  assert.deepEqual(rec.readyInApp, [{ userId: "u1", serviceId: 7 }]);
  assert.deepEqual(rec.readyPushes, [{ userId: "u1", serviceId: 7, notificationId: "ready-notif-1" }]);
  assert.deepEqual(rec.fulfilled, ["ord-1"]);
  // Still records the silent baseline marker as usual.
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "active", lastRenewalNotified: null } },
  ]);
});

test("ready fires on pending->active transition matching an order", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    markerState: { u1: { "7": { lastSeenStatus: "pending", lastRenewalNotified: null } } },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 1);
  assert.deepEqual(rec.readyInApp, [{ userId: "u1", serviceId: 7 }]);
  assert.deepEqual(rec.fulfilled, ["ord-1"]);
});

test("ready does NOT fire on unsuspend (suspended->active), even with a matching order", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    markerState: { u1: { "7": { lastSeenStatus: "suspended", lastRenewalNotified: null } } },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 0);
  assert.equal(rec.readyPushes.length, 0);
  assert.equal(rec.fulfilled.length, 0);
  // The unsuspended lifecycle event still fires (unchanged behaviour).
  assert.deepEqual(rec.pushes.map((p) => p.kind), ["unsuspended"]);
});

test("ready does NOT fire on terminated->active re-enable, even with a matching order", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    markerState: { u1: { "7": { lastSeenStatus: "terminated", lastRenewalNotified: null } } },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 0);
  assert.equal(rec.readyPushes.length, 0);
  assert.equal(rec.fulfilled.length, 0);
});

test("ready does NOT fire without a matching pending order", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 999 }] }, // different pid
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 0);
  assert.equal(rec.fulfilled.length, 0);
});

test("ready is one-time: a fulfilled order never re-fires on the next pass", async () => {
  const services = { 100: [mkService({ id: 7, status: "Active", pid: 42 })] };
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: services,
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
  });
  await runWhmcsServiceNotifyPass(deps);
  const second = await runWhmcsServiceNotifyPass(deps);
  assert.equal(second.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 1);
  assert.equal(rec.readyPushes.length, 1);
  assert.deepEqual(rec.fulfilled, ["ord-1"]);
});

test("ready in-app fires regardless of push prefs; push is gated by wantsPush", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
    wantsReadyPush: false,
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 1);
  assert.deepEqual(rec.readyInApp, [{ userId: "u1", serviceId: 7 }]); // bell still created
  assert.equal(rec.readyPushes.length, 0); // push suppressed
  assert.deepEqual(rec.fulfilled, ["ord-1"]); // still fulfilled (one-time)
});

test("two new same-pid services consume two distinct orders (no double-grab)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: {
      100: [
        mkService({ id: 7, status: "Active", pid: 42 }),
        mkService({ id: 8, status: "Active", pid: 42 }),
      ],
    },
    pendingByUser: {
      u1: [
        { id: "ord-1", whmcsProductId: 42 },
        { id: "ord-2", whmcsProductId: 42 },
      ],
    },
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 2);
  assert.deepEqual(rec.readyInApp.map((r) => r.serviceId).sort(), [7, 8]);
  assert.deepEqual(rec.fulfilled.sort(), ["ord-1", "ord-2"]);
});

test("ready degrades cleanly when getPendingOrders throws (no fire, lifecycle unaffected)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    pendingByUser: { u1: [{ id: "ord-1", whmcsProductId: 42 }] },
    getPendingOrdersThrows: true,
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 0);
  // Baseline marker still written despite the pending-order failure.
  assert.deepEqual(rec.recorded, [
    { userId: "u1", serviceId: 7, marker: { lastSeenStatus: "active", lastRenewalNotified: null } },
  ]);
});

test("ready detection is OFF when hooks are not wired (lifecycle behaves as before)", async () => {
  const { deps, rec } = makeDeps({
    users: [mkUser({ id: "u1", whmcsClientId: 100 })],
    servicesByClient: { 100: [mkService({ id: 7, status: "Active", pid: 42 })] },
    // no pendingByUser → readyEnabled false
  });
  const result = await runWhmcsServiceNotifyPass(deps);
  assert.equal(result.readyNotified, 0);
  assert.equal(rec.readyInApp.length, 0);
  assert.equal(rec.readyPushes.length, 0);
});
