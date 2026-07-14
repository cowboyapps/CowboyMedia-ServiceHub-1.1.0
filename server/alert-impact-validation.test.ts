import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAlertRoutes } from "./alert-routes";

// Server-side contract tests for impact/severity validation on
// POST /api/admin/alerts (create) and impact validation on
// POST /api/admin/alerts/:id/updates (companions to
// alert-edit-severity.test.ts and alert-severity-change.test.ts):
//   1. Create rejects (400) severity outside info/warning/critical BEFORE any
//      storage write; absent severity is fine (schema defaults it).
//   2. Create rejects (400) impact outside operational/degraded/outage/
//      maintenance; absent impact falls back to "degraded".
//   3. Post-update only persists whitelisted impacts — "no_change", absent,
//      and garbage values must NOT put an `impact` key into updateAlert, and
//      an arbitrary string must never surface as a customer-facing label.

function harness(opts: { initialImpact?: string } = {}) {
  const alertState: Record<string, any> = {
    id: "alert-1",
    serviceIds: ["s1"],
    title: "t",
    description: "d",
    severity: "info",
    status: "active",
    impact: opts.initialImpact ?? "degraded",
  };
  const createAlertCalls: Array<{ data: Record<string, any>; serviceIds: string[] }> = [];
  const updateAlertCalls: Array<{ id: string; data: Record<string, any> }> = [];
  const pushSends: any[] = [];

  const storage: any = {
    createAlert: async (data: Record<string, any>, serviceIds: string[]) => {
      createAlertCalls.push({ data, serviceIds });
      return { ...alertState, ...data, serviceIds };
    },
    createAlertUpdate: async () => ({ id: "update-1" }),
    updateAlert: async (id: string, data: Record<string, any>) => {
      updateAlertCalls.push({ id, data });
      Object.assign(alertState, data);
      return { ...alertState };
    },
    getAlert: async () => ({ ...alertState }),
    getService: async (sid: string) => ({ id: sid, name: `svc-${sid}` }),
    getAllUsers: async () => [subscriber],
    createContentNotificationBulk: async () => {},
    recomputeServiceStatus: async () => "operational",
  };

  const deps: any = {
    storage,
    broadcast: () => {},
    saveUploadedFile: async () => "image.png",
    parseServiceIds: (raw: any) => (Array.isArray(raw) ? raw : []),
    logActivity: () => {},
    customerWantsPush: () => true,
    customerWantsEmail: () => false,
    customerWantsInApp: () => false,
    sendPushToUser: async (...args: any[]) => {
      pushSends.push(args);
    },
    sendTemplatedEmail: async () => {},
    fireDiscordForServices: () => {},
    fireTelegram: () => {},
    getBaseUrl: () => "http://test.local",
    notifyServiceSubscribers: () => {},
  };

  const middleware: any = {
    requirePermission: () => (req: any, _res: any, next: any) => {
      req.session = { userId: "admin-user" };
      next();
    },
    upload: { single: () => (_req: any, _res: any, next: any) => next() },
  };

  const app = express();
  app.use(express.json());
  registerAlertRoutes(app, middleware, deps);
  return { app, createAlertCalls, updateAlertCalls, alertState, pushSends };
}

const subscriber = {
  id: "cust-1",
  role: "customer",
  email: "c@example.com",
  fullName: "Cust",
  subscribedServices: ["s1"],
};

async function request(app: express.Express, path: string, body: any): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const createAlert = (app: express.Express, body: any) => request(app, "/api/admin/alerts", body);
const postUpdate = (app: express.Express, body: any) => request(app, "/api/admin/alerts/alert-1/updates", body);

const baseCreate = { title: "t", description: "d", serviceIds: ["s1"] };

// --- Create: whitelisted values pass through ----------------------------------

for (const severity of ["info", "warning", "critical"]) {
  test(`create accepts whitelisted severity "${severity}"`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, severity, serviceImpact: "outage" });
    assert.equal(res.status, 200);
    assert.equal(createAlertCalls.length, 1);
    assert.equal(createAlertCalls[0].data.severity, severity);
  });
}

for (const impact of ["operational", "degraded", "outage", "maintenance"]) {
  test(`create accepts whitelisted impact "${impact}"`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, severity: "warning", serviceImpact: impact });
    assert.equal(res.status, 200);
    assert.equal(createAlertCalls.length, 1);
    assert.equal(createAlertCalls[0].data.impact, impact);
  });
}

test("create with absent severity still works (schema defaults it) and absent impact defaults to degraded", async () => {
  const { app, createAlertCalls } = harness();
  const res = await createAlert(app, baseCreate);
  assert.equal(res.status, 200);
  assert.equal(createAlertCalls.length, 1);
  assert.ok(!("severity" in createAlertCalls[0].data), "no severity key is injected");
  assert.equal(createAlertCalls[0].data.impact, "degraded", "impact falls back to the long-standing default");
});

// --- Create: invalid severity rejected before any write ------------------------

for (const [label, severity] of [
  ['garbage string "catastrophic"', "catastrophic"],
  ['sentinel "no_change"', "no_change"],
  ["empty string", ""],
  ["non-string (number)", 42],
  ["non-string (object)", { $ne: null }],
] as const) {
  test(`create with ${label} severity is rejected with 400 and nothing is persisted`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, severity });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /severity/i);
    assert.equal(createAlertCalls.length, 0, "no alert is created on a rejected request");
  });
}

// --- Create: invalid impact rejected before any write --------------------------

for (const [label, serviceImpact] of [
  ['garbage string "meltdown"', "meltdown"],
  ['sentinel "no_change"', "no_change"],
  ["empty string", ""],
  ["null", null],
  ["non-string (number)", 42],
  ["non-string (object)", { $ne: null }],
] as const) {
  test(`create with ${label} impact is rejected with 400 and nothing is persisted`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, severity: "warning", serviceImpact });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /impact/i);
    assert.equal(createAlertCalls.length, 0, "no alert is created on a rejected request");
  });
}

// --- Post-update: whitelisted impact persists ----------------------------------

for (const impact of ["operational", "degraded", "outage", "maintenance"]) {
  test(`post-update persists whitelisted impact "${impact}" via storage.updateAlert`, async () => {
    const { app, updateAlertCalls, alertState } = harness({ initialImpact: "degraded" });
    const res = await postUpdate(app, { message: "m", status: "investigating", serviceImpact: impact });
    assert.equal(res.status, 200);
    const impactUpdate = updateAlertCalls.find((c) => "impact" in c.data);
    assert.ok(impactUpdate, "an impact-carrying updateAlert call exists");
    assert.equal(impactUpdate!.data.impact, impact);
    assert.equal(alertState.impact, impact, "stored impact reflects the change");
  });
}

// --- Post-update: no_change / absent / invalid never touch impact ---------------

for (const [label, body] of [
  ['"no_change"', { message: "m", status: "investigating", serviceImpact: "no_change" }],
  ["absent impact", { message: "m", status: "investigating" }],
  ['garbage string "meltdown"', { message: "m", status: "investigating", serviceImpact: "meltdown" }],
  ["non-string impact", { message: "m", status: "investigating", serviceImpact: 42 }],
] as const) {
  test(`post-update with ${label} leaves impact untouched in every updateAlert call`, async () => {
    const { app, updateAlertCalls, alertState } = harness({ initialImpact: "outage" });
    const res = await postUpdate(app, body);
    assert.equal(res.status, 200);
    assert.ok(updateAlertCalls.length > 0, "the status update itself is still persisted");
    for (const call of updateAlertCalls) {
      assert.ok(!("impact" in call.data), `updateAlert payload must not contain an impact key (got ${JSON.stringify(call.data)})`);
    }
    assert.equal(alertState.impact, "outage", "the alert's stored impact is unchanged");
  });
}

// --- Post-update: an arbitrary impact string never leaks into labels ------------

test("post-update with a garbage impact never surfaces it in the push notification title", async () => {
  const { app, pushSends } = harness({ initialImpact: "degraded" });
  const res = await postUpdate(app, { message: "m", status: "investigating", serviceImpact: "TOTAL MELTDOWN" });
  assert.equal(res.status, 200);
  for (const [, payload] of pushSends) {
    assert.ok(!JSON.stringify(payload).includes("TOTAL MELTDOWN"), `raw impact string leaked into notification payload: ${JSON.stringify(payload)}`);
  }
});
