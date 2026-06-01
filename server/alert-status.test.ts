import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { storage } from "./storage";
import { db, pool } from "./db";
import { services, serviceAlerts, alertServices, alertUpdates } from "@shared/schema";

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
