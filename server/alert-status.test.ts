import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import { inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db, pool } from "./db";
import { services, serviceAlerts, alertServices, alertUpdates } from "@shared/schema";
import {
  recomputeForCoveredServices,
  recomputeForServiceChange,
  type AlertStatusDeps,
} from "./alert-status";
import { registerAlertRoutes } from "./alert-routes";

// A spy implementation of AlertStatusDeps that records, in call order, which
// service ids were recomputed and which were broadcast. Used by the route-level
// orchestration tests below to assert each alert path drives the recompute +
// `service_updated` broadcast for the correct set of services — the class of
// bug (a route forgetting to recompute after a mutation) that motivated this
// helper. These tests need no database.
function spyDeps() {
  const recomputed: string[] = [];
  const broadcast: string[] = [];
  const deps: AlertStatusDeps = {
    recompute: async (sid) => {
      recomputed.push(sid);
    },
    broadcast: (msg) => {
      broadcast.push(msg.serviceId);
    },
  };
  return { deps, recomputed, broadcast };
}

// create / add-update / resolve / delete all recompute exactly the covered ids.
test("covered-services helper recomputes and broadcasts each covered service", async () => {
  const { deps, recomputed, broadcast } = spyDeps();
  const processed = await recomputeForCoveredServices(["s1", "s2"], deps);

  assert.deepEqual(processed, ["s1", "s2"]);
  assert.deepEqual(recomputed, ["s1", "s2"], "recomputes every covered service");
  assert.deepEqual(broadcast, ["s1", "s2"], "broadcasts service_updated for each");
});

test("covered-services helper dedupes repeated ids", async () => {
  const { deps, recomputed, broadcast } = spyDeps();
  await recomputeForCoveredServices(["s1", "s1", "s2"], deps);

  assert.deepEqual(recomputed, ["s1", "s2"], "each service recomputed once");
  assert.deepEqual(broadcast, ["s1", "s2"], "each service broadcast once");
});

test("covered-services helper is a no-op for an empty id set (e.g. deleted alert with no services)", async () => {
  const { deps, recomputed, broadcast } = spyDeps();
  const processed = await recomputeForCoveredServices([], deps);

  assert.deepEqual(processed, []);
  assert.deepEqual(recomputed, []);
  assert.deepEqual(broadcast, []);
});

// edit: recompute the union of previously- and newly-covered ids so a service
// dropped from the alert is recomputed back to baseline.
test("service-change helper recomputes the union of previous and new service ids", async () => {
  const { deps, recomputed, broadcast } = spyDeps();
  // Alert previously covered [a, b]; it now covers [a, c]. b was dropped, c added.
  const processed = await recomputeForServiceChange(["a", "b"], ["a", "c"], deps);

  assert.deepEqual(
    new Set(processed),
    new Set(["a", "b", "c"]),
    "kept (a), dropped (b), and added (c) services are all recomputed",
  );
  assert.deepEqual(
    new Set(recomputed),
    new Set(["a", "b", "c"]),
    "the dropped service is recomputed so it can return to baseline",
  );
  assert.deepEqual(new Set(broadcast), new Set(["a", "b", "c"]));
  // Union is deduped: a appears in both sets but is processed once.
  assert.equal(recomputed.length, 3);
});

// ---------------------------------------------------------------------------
// Route-level wiring tests.
//
// The helper tests above prove the orchestration is correct in isolation; these
// prove each alert *route* actually invokes it. We mount registerAlertRoutes on
// a bare Express app with spy collaborators, then drive each mutation path over
// HTTP and assert it recomputed + broadcast `service_updated` for the right set
// of services. If a future edit to a route drops the recompute/broadcast call,
// the matching test here fails — catching the bug at the route boundary, which
// is the whole point of the extraction. These tests need no database.
// ---------------------------------------------------------------------------

// Build a throwaway app wired to spy collaborators. `storageOverrides` lets a
// test control what the storage methods return (e.g. an alert's covered ids);
// recomputeServiceStatus is always the recorder under test and isn't overridable.
function routeHarness(
  storageOverrides: Record<string, any> = {},
  opts: { uploadedFile?: any } = {},
) {
  const recomputed: string[] = [];
  const serviceUpdatedBroadcasts: string[] = [];

  const baseStorage: Record<string, any> = {
    createAlert: async (data: any, serviceIds: string[]) => ({ id: "alert-1", serviceIds, title: data.title ?? "t", description: data.description ?? "d", severity: data.severity ?? "minor" }),
    getAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
    updateAlert: async (id: string, _data: any) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
    setAlertServices: async () => {},
    deleteAlert: async () => {},
    getService: async (sid: string) => ({ id: sid, name: `svc-${sid}` }),
    getAllUsers: async () => [],
    createContentNotificationBulk: async () => {},
    createAlertUpdate: async () => ({ id: "update-1" }),
    updateAlertUpdate: async () => ({ id: "update-1" }),
  };
  const storageSpy: any = { ...baseStorage, ...storageOverrides };
  storageSpy.recomputeServiceStatus = async (sid: string) => {
    recomputed.push(sid);
    return "operational";
  };

  const deps: any = {
    storage: storageSpy,
    broadcast: (msg: any) => {
      if (msg?.type === "service_updated") serviceUpdatedBroadcasts.push(msg.serviceId);
    },
    saveUploadedFile: async () => "image.png",
    parseServiceIds: (raw: any) =>
      Array.isArray(raw)
        ? raw.filter(Boolean)
        : typeof raw === "string" && raw.trim()
          ? raw.split(",").map((s: string) => s.trim()).filter(Boolean)
          : [],
    logActivity: () => {},
    customerWantsPush: () => false,
    customerWantsEmail: () => false,
    sendPushToUser: async () => {},
    sendTemplatedEmail: async () => {},
    fireDiscordForServices: () => {},
    fireTelegram: () => {},
    getBaseUrl: () => "http://test.local",
    notifyServiceSubscribers: () => {},
  };

  // Pass-through middleware: authorize every request as an admin and skip multer.
  const middleware: any = {
    requirePermission: () => (req: any, _res: any, next: any) => {
      req.session = { userId: "admin-user" };
      next();
    },
    upload: {
      single: () => (req: any, _res: any, next: any) => {
        if (opts.uploadedFile) req.file = opts.uploadedFile;
        next();
      },
    },
  };

  const app = express();
  app.use(express.json());
  registerAlertRoutes(app, middleware, deps);
  return { app, recomputed, serviceUpdatedBroadcasts };
}

// Boot `app` on an ephemeral port, issue one request, return { status, body }.
async function httpCall(
  app: express.Express,
  method: string,
  path: string,
  body?: any,
): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("route POST /api/admin/alerts recomputes + broadcasts every covered service", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness();
  const res = await httpCall(app, "POST", "/api/admin/alerts", {
    title: "t",
    description: "d",
    serviceImpact: "outage",
    serviceIds: ["s1", "s2"],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(recomputed, ["s1", "s2"]);
  assert.deepEqual(serviceUpdatedBroadcasts, ["s1", "s2"]);
});

test("route PATCH /api/admin/alerts/:id recomputes the union of previous and new services", async () => {
  // Alert previously covered [s1, s2]; the edit narrows coverage to [s1, s3].
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    updateAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
    getAlert: async (id: string) => ({ id, serviceIds: ["s1", "s3"], title: "t", description: "d", severity: "minor" }),
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1", { serviceIds: ["s1", "s3"] });
  assert.equal(res.status, 200);
  assert.deepEqual(
    new Set(recomputed),
    new Set(["s1", "s2", "s3"]),
    "dropped (s2), kept (s1), and added (s3) services are all recomputed",
  );
  assert.equal(recomputed.length, 3, "union is deduped");
  assert.deepEqual(new Set(serviceUpdatedBroadcasts), new Set(["s1", "s2", "s3"]));
});

test("route POST /api/admin/alerts/:id/updates recomputes + broadcasts every covered service", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    getAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
  });
  const res = await httpCall(app, "POST", "/api/admin/alerts/alert-1/updates", {
    status: "monitoring",
    message: "Investigating",
  });
  assert.equal(res.status, 200);
  assert.deepEqual(recomputed, ["s1", "s2"]);
  assert.deepEqual(serviceUpdatedBroadcasts, ["s1", "s2"]);
});

test("route PATCH /api/admin/alerts/:id/resolve recomputes + broadcasts every covered service", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    updateAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1/resolve", { message: "Fixed" });
  assert.equal(res.status, 200);
  assert.deepEqual(recomputed, ["s1", "s2"]);
  assert.deepEqual(serviceUpdatedBroadcasts, ["s1", "s2"]);
});

// The resolve route also lets admins attach a photo to the resolution note: an
// uploaded file runs through saveUploadedFile and the resulting URL is included
// as imageUrl on the created resolve alert-update. These two pin that branch —
// an uploaded file lands on the createAlertUpdate call, and with no file no
// imageUrl is set — so a regression that drops the photo from the note is caught.
test("route PATCH /api/admin/alerts/:id/resolve includes the uploaded image on the resolve update", async () => {
  const calls: Array<Record<string, any>> = [];
  const { app } = routeHarness(
    {
      updateAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
      createAlertUpdate: async (data: Record<string, any>) => {
        calls.push(data);
        return { id: "update-1", ...data };
      },
    },
    { uploadedFile: { originalname: "resolved.png", buffer: Buffer.from("x") } },
  );
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1/resolve", { message: "Fixed" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "exactly one resolve update is created");
  assert.equal(calls[0].status, "resolved", "the created update is the resolution note");
  assert.equal(calls[0].message, "Fixed", "the resolve message is persisted");
  assert.equal(
    calls[0].imageUrl,
    "image.png",
    "the saveUploadedFile URL is included as imageUrl on the resolve update",
  );
});

test("route PATCH /api/admin/alerts/:id/resolve sets no imageUrl when no file is uploaded", async () => {
  const calls: Array<Record<string, any>> = [];
  const { app } = routeHarness({
    updateAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
    createAlertUpdate: async (data: Record<string, any>) => {
      calls.push(data);
      return { id: "update-1", ...data };
    },
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1/resolve", { message: "Fixed" });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "exactly one resolve update is created");
  assert.equal(calls[0].message, "Fixed", "the resolve message is persisted");
  assert.ok(
    !("imageUrl" in calls[0]),
    "no imageUrl key is set on the resolve update when nothing was uploaded",
  );
});

test("route DELETE /api/admin/alerts/:id recomputes services captured before deletion", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    getAlert: async (id: string) => ({ id, serviceIds: ["s1", "s2"], title: "t", description: "d", severity: "minor" }),
  });
  const res = await httpCall(app, "DELETE", "/api/admin/alerts/alert-1");
  assert.equal(res.status, 200);
  assert.deepEqual(recomputed, ["s1", "s2"], "the pre-delete covered ids are recomputed back to baseline");
  assert.deepEqual(serviceUpdatedBroadcasts, ["s1", "s2"]);
});

// ---------------------------------------------------------------------------
// Route-level guard-rail tests.
//
// The wiring tests above prove the happy-path recompute/broadcast fires; these
// prove the input-validation and not-found branches still reject bad requests.
// A future refactor could silently weaken these guards on customer-facing alert
// mutations, so each test asserts the right status code AND that no recompute or
// broadcast happened on the rejected path. These tests need no database.
// ---------------------------------------------------------------------------

test("route POST /api/admin/alerts rejects an empty serviceIds with 400 and does not recompute", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness();
  const res = await httpCall(app, "POST", "/api/admin/alerts", {
    title: "t",
    description: "d",
    serviceImpact: "outage",
    serviceIds: [],
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, "At least one service is required");
  assert.deepEqual(recomputed, [], "no service is recomputed on a rejected create");
  assert.deepEqual(serviceUpdatedBroadcasts, [], "nothing is broadcast on a rejected create");
});

test("route PATCH /api/admin/alerts/:id rejects an empty serviceIds with 400 and does not recompute", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness();
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1", { serviceIds: [] });
  assert.equal(res.status, 400);
  assert.equal(res.body.message, "At least one service is required");
  assert.deepEqual(recomputed, [], "no service is recomputed on a rejected edit");
  assert.deepEqual(serviceUpdatedBroadcasts, [], "nothing is broadcast on a rejected edit");
});

test("route PATCH /api/admin/alerts/:id returns 404 when the alert is missing", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    updateAlert: async () => undefined,
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/missing", { serviceIds: ["s1"] });
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Alert not found");
  assert.deepEqual(recomputed, [], "no service is recomputed for a missing alert");
  assert.deepEqual(serviceUpdatedBroadcasts, []);
});

test("route PATCH /api/admin/alerts/:id/resolve returns 404 when the alert is missing", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    updateAlert: async () => undefined,
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/missing/resolve", { message: "Fixed" });
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Alert not found");
  assert.deepEqual(recomputed, [], "no service is recomputed for a missing alert");
  assert.deepEqual(serviceUpdatedBroadcasts, []);
});

test("route PATCH /api/admin/alerts/:alertId/updates/:updateId returns 404 when the update is missing", async () => {
  const { app, recomputed, serviceUpdatedBroadcasts } = routeHarness({
    updateAlertUpdate: async () => undefined,
  });
  const res = await httpCall(app, "PATCH", "/api/admin/alerts/alert-1/updates/missing", { message: "edited" });
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Alert update not found");
  assert.deepEqual(recomputed, [], "no service is recomputed when editing a missing update");
  assert.deepEqual(serviceUpdatedBroadcasts, []);
});

// Editing an existing alert update does NOT touch service-status recompute (the
// message/image of a timeline entry can't change a service's derived status), so
// it isn't part of the recompute assertions above. But it's still an admin action
// customers' incident timelines depend on, so this pair of tests pins the route's
// persistence + not-found wiring.
test("route PATCH /api/admin/alerts/:alertId/updates/:updateId persists the edited fields", async () => {
  const calls: Array<{ id: string; data: Record<string, any> }> = [];
  const { app } = routeHarness({
    updateAlertUpdate: async (id: string, data: Record<string, any>) => {
      calls.push({ id, data });
      return { id, ...data };
    },
  });
  const res = await httpCall(
    app,
    "PATCH",
    "/api/admin/alerts/alert-1/updates/update-9",
    { message: "Edited message" },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "the storage update is invoked exactly once");
  assert.equal(calls[0].id, "update-9", "the update id from the URL is forwarded");
  assert.deepEqual(calls[0].data, { message: "Edited message" }, "the edited message is persisted");
  assert.equal(res.body.message, "Edited message", "the persisted row is returned to the caller");
});

// The same edit route also lets admins swap or remove the timeline entry's photo.
// These two pin the image branches: an uploaded file runs through saveUploadedFile
// and the resulting URL is persisted; removeImage="true" nulls the stored URL.
test("route PATCH /api/admin/alerts/:alertId/updates/:updateId persists an uploaded image", async () => {
  const calls: Array<{ id: string; data: Record<string, any> }> = [];
  const { app } = routeHarness(
    {
      updateAlertUpdate: async (id: string, data: Record<string, any>) => {
        calls.push({ id, data });
        return { id, ...data };
      },
    },
    { uploadedFile: { originalname: "incident.png", buffer: Buffer.from("x") } },
  );
  const res = await httpCall(
    app,
    "PATCH",
    "/api/admin/alerts/alert-1/updates/update-9",
    { message: "Edited with a new photo" },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "the storage update is invoked exactly once");
  assert.equal(
    calls[0].data.imageUrl,
    "image.png",
    "the saveUploadedFile URL is persisted as imageUrl",
  );
  assert.equal(calls[0].data.message, "Edited with a new photo", "the message is persisted alongside the image");
  assert.equal(res.body.imageUrl, "image.png", "the persisted row is returned to the caller");
});

test("route PATCH /api/admin/alerts/:alertId/updates/:updateId clears the image when removeImage is set", async () => {
  const calls: Array<{ id: string; data: Record<string, any> }> = [];
  const { app } = routeHarness({
    updateAlertUpdate: async (id: string, data: Record<string, any>) => {
      calls.push({ id, data });
      return { id, ...data };
    },
  });
  const res = await httpCall(
    app,
    "PATCH",
    "/api/admin/alerts/alert-1/updates/update-9",
    { removeImage: "true" },
  );
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1, "the storage update is invoked exactly once");
  assert.strictEqual(calls[0].data.imageUrl, null, "imageUrl is set to null to remove the existing photo");
  assert.strictEqual(res.body.imageUrl, null, "the cleared row is returned to the caller");
});

test("route PATCH /api/admin/alerts/:alertId/updates/:updateId returns 404 for a missing update", async () => {
  const { app } = routeHarness({
    updateAlertUpdate: async () => null,
  });
  const res = await httpCall(
    app,
    "PATCH",
    "/api/admin/alerts/alert-1/updates/does-not-exist",
    { message: "Edited message" },
  );
  assert.equal(res.status, 404);
  assert.equal(res.body.message, "Alert update not found");
});

// Integration tests for the multi-service alert status recompute invariant.
//
// A service's `status` is derived: the most-severe `impact` among the still-active
// (non-resolved) alerts that cover it (outage > degraded > maintenance > operational;
// missing impact defaults to degraded). These tests exercise the REAL storage layer
// (createAlert / setAlertServices / updateAlert / deleteAlert / recomputeServiceStatus)
// against the test database, then assert each covered service lands at the right status
// across the full alert lifecycle. The recompute loops mirror what the alert routes in
// server/routes.ts run after each mutation.

const createdServiceIds: string[] = [];
const createdAlertIds: string[] = [];

async function newService(): Promise<string> {
  const [row] = await db
    .insert(services)
    .values({ name: `test-svc-${randomUUID()}`, status: "operational" })
    .returning();
  createdServiceIds.push(row.id);
  return row.id;
}

async function newAlert(
  impact: string | null,
  serviceIds: string[],
  status = "investigating",
): Promise<string> {
  const alert = await storage.createAlert(
    { title: "test alert", description: "desc", status, impact } as any,
    serviceIds,
  );
  createdAlertIds.push(alert.id);
  return alert.id;
}

// Mirror the route-side recompute loop: recompute each affected service so its
// status reflects the most-severe active alert that still covers it.
async function recompute(serviceIds: string[]): Promise<void> {
  for (const sid of Array.from(new Set(serviceIds))) {
    await storage.recomputeServiceStatus(sid);
  }
}

async function statusOf(serviceId: string): Promise<string | undefined> {
  return (await storage.getService(serviceId))?.status;
}

before(async () => {
  // Fail fast with a clear message if the test DB is unreachable.
  await db.select().from(services).limit(1);
});

after(async () => {
  if (createdAlertIds.length) {
    await db.delete(alertUpdates).where(inArray(alertUpdates.alertId, createdAlertIds));
    await db.delete(alertServices).where(inArray(alertServices.alertId, createdAlertIds));
    await db.delete(serviceAlerts).where(inArray(serviceAlerts.id, createdAlertIds));
  }
  if (createdServiceIds.length) {
    await db.delete(alertServices).where(inArray(alertServices.serviceId, createdServiceIds));
    await db.delete(services).where(inArray(services.id, createdServiceIds));
  }
  await pool.end();
});

test("create: a multi-service alert drives every covered service non-operational", async () => {
  const a = await newService();
  const b = await newService();

  const alertId = await newAlert("outage", [a, b]);
  const alert = await storage.getAlert(alertId);
  await recompute(alert!.serviceIds);

  assert.equal(await statusOf(a), "outage");
  assert.equal(await statusOf(b), "outage");
});

test("edit: dropping a service from an alert recomputes it; the kept service is unchanged", async () => {
  const a = await newService();
  const b = await newService();

  const alertId = await newAlert("degraded", [a, b]);
  await recompute([a, b]);
  assert.equal(await statusOf(a), "degraded");
  assert.equal(await statusOf(b), "degraded");

  // Drop service b. Affected set is the union of previous + new ids (mirrors the PATCH route).
  await storage.setAlertServices(alertId, [a]);
  await recompute([a, b]);

  assert.equal(await statusOf(a), "degraded", "kept service stays at the alert's impact");
  assert.equal(await statusOf(b), "operational", "dropped service returns to baseline");
});

test("add-update: changing an alert's impact recomputes covered services", async () => {
  const a = await newService();

  const alertId = await newAlert("degraded", [a]);
  await recompute([a]);
  assert.equal(await statusOf(a), "degraded");

  // An alert update can escalate impact; the route persists it then recomputes.
  await storage.updateAlert(alertId, { impact: "outage" });
  await recompute([a]);

  assert.equal(await statusOf(a), "outage");
});

test("resolve: a shared service stays non-operational while another active alert covers it", async () => {
  const a = await newService();

  const outageAlert = await newAlert("outage", [a]);
  const degradedAlert = await newAlert("degraded", [a]);
  await recompute([a]);
  assert.equal(await statusOf(a), "outage", "worst active impact wins");

  // Resolve the outage. The degraded alert still covers the service.
  await storage.updateAlert(outageAlert, { status: "resolved", resolvedAt: new Date() });
  await recompute([a]);
  assert.equal(await statusOf(a), "degraded", "still covered by the active degraded alert");

  // Resolve the last active alert → back to operational.
  await storage.updateAlert(degradedAlert, { status: "resolved", resolvedAt: new Date() });
  await recompute([a]);
  assert.equal(await statusOf(a), "operational");
});

test("delete: removing an alert recomputes every covered service back to baseline", async () => {
  const a = await newService();
  const b = await newService();

  const alertId = await newAlert("outage", [a, b]);
  await recompute([a, b]);
  assert.equal(await statusOf(a), "outage");
  assert.equal(await statusOf(b), "outage");

  // Capture the covered ids BEFORE deleting (the junction rows go away with the alert).
  const covered = (await storage.getAlert(alertId))!.serviceIds;
  await storage.deleteAlert(alertId);
  await recompute(covered);

  assert.equal(await statusOf(a), "operational");
  assert.equal(await statusOf(b), "operational");
});

test("delete: a shared service stays non-operational if another active alert still covers it", async () => {
  const a = await newService();

  const alert1 = await newAlert("outage", [a]);
  await newAlert("degraded", [a]);
  await recompute([a]);
  assert.equal(await statusOf(a), "outage");

  const covered = (await storage.getAlert(alert1))!.serviceIds;
  await storage.deleteAlert(alert1);
  await recompute(covered);

  assert.equal(await statusOf(a), "degraded", "the surviving active alert keeps it non-operational");
});

test("recompute ranking: outage > degraded > maintenance > operational", async () => {
  // outage beats degraded
  const s1 = await newService();
  await newAlert("degraded", [s1]);
  await newAlert("outage", [s1]);
  assert.equal(await storage.recomputeServiceStatus(s1), "outage");

  // degraded beats maintenance
  const s2 = await newService();
  await newAlert("maintenance", [s2]);
  await newAlert("degraded", [s2]);
  assert.equal(await storage.recomputeServiceStatus(s2), "degraded");

  // maintenance beats operational baseline
  const s3 = await newService();
  await newAlert("maintenance", [s3]);
  assert.equal(await storage.recomputeServiceStatus(s3), "maintenance");

  // no active alerts → operational
  const s4 = await newService();
  assert.equal(await storage.recomputeServiceStatus(s4), "operational");
});

test("recompute ranking: a missing impact defaults to degraded", async () => {
  // A single alert with no impact set ranks as degraded.
  const s1 = await newService();
  await newAlert(null, [s1]);
  assert.equal(await storage.recomputeServiceStatus(s1), "degraded");

  // A missing-impact (degraded) alert outranks a maintenance alert on the same service.
  const s2 = await newService();
  await newAlert("maintenance", [s2]);
  await newAlert(null, [s2]);
  assert.equal(await storage.recomputeServiceStatus(s2), "degraded");

  // But an outage still beats a missing-impact (degraded) alert.
  const s3 = await newService();
  await newAlert(null, [s3]);
  await newAlert("outage", [s3]);
  assert.equal(await storage.recomputeServiceStatus(s3), "outage");
});

test("recompute ignores resolved alerts when ranking", async () => {
  const s = await newService();
  const resolved = await newAlert("outage", [s], "resolved");
  // A resolved outage must not hold the service down.
  assert.equal(await storage.recomputeServiceStatus(s), "operational");

  // Add an active maintenance alert; the resolved outage is still ignored.
  await newAlert("maintenance", [s]);
  assert.equal(await storage.recomputeServiceStatus(s), "maintenance");
  assert.ok(resolved);
});
