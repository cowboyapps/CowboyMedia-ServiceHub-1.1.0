import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAlertRoutes } from "./alert-routes";

// Server-side contract tests for the optional severity change riding along with
// POST /api/admin/alerts/:id/updates:
//   1. Only whitelisted values (info/warning/critical) are persisted via
//      storage.updateAlert — "no_change", absent, and garbage values must NOT
//      put a `severity` key into the update payload.
//   2. The new severity is persisted BEFORE notification fan-out, so the
//      customerWantsPush/customerWantsEmail preference checks (keyed on
//      alert.severity) evaluate against the post-update value. A regression
//      here could silently blast critical-level notifications for an info
//      alert, or drop an admin's severity correction.
// These tests need no database: storage is a stateful in-memory spy so the
// getAlert read after updateAlert reflects whatever severity was persisted.

function harness(opts: { initialSeverity?: string; subscribers?: any[] } = {}) {
  // Stateful alert record: updateAlert mutates it, getAlert reads it — exactly
  // how the real storage behaves, so ordering bugs (fan-out before persist)
  // become observable through the severity the preference checks receive.
  const alertState: Record<string, any> = {
    id: "alert-1",
    serviceIds: ["s1"],
    title: "t",
    description: "d",
    severity: opts.initialSeverity ?? "info",
    status: "active",
  };
  const updateAlertCalls: Array<{ id: string; data: Record<string, any> }> = [];
  const callOrder: string[] = [];
  const pushSeveritiesSeen: (string | null | undefined)[] = [];
  const emailSeveritiesSeen: (string | null | undefined)[] = [];
  const pushSends: any[] = [];
  const emailSends: any[] = [];

  const storage: any = {
    createAlertUpdate: async () => ({ id: "update-1" }),
    updateAlert: async (id: string, data: Record<string, any>) => {
      callOrder.push("updateAlert");
      updateAlertCalls.push({ id, data });
      Object.assign(alertState, data);
      return { ...alertState };
    },
    getAlert: async () => {
      callOrder.push("getAlert");
      return { ...alertState };
    },
    getService: async (sid: string) => ({ id: sid, name: `svc-${sid}` }),
    getAllUsers: async () => opts.subscribers ?? [],
    createContentNotificationBulk: async () => {},
    recomputeServiceStatus: async () => "operational",
  };

  const deps: any = {
    storage,
    broadcast: () => {},
    saveUploadedFile: async () => "image.png",
    parseServiceIds: () => [],
    logActivity: () => {},
    customerWantsPush: (_u: any, _cat: string, severity?: string | null) => {
      callOrder.push("customerWantsPush");
      pushSeveritiesSeen.push(severity);
      return true;
    },
    customerWantsEmail: (_u: any, _cat: string, severity?: string | null) => {
      callOrder.push("customerWantsEmail");
      emailSeveritiesSeen.push(severity);
      return true;
    },
    customerWantsInApp: () => false,
    sendPushToUser: async (...args: any[]) => {
      pushSends.push(args);
    },
    sendTemplatedEmail: async (...args: any[]) => {
      emailSends.push(args);
    },
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
  return { app, updateAlertCalls, callOrder, pushSeveritiesSeen, emailSeveritiesSeen, pushSends, emailSends, alertState };
}

async function postUpdate(app: express.Express, body: any): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/alerts/alert-1/updates`, {
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

// --- Whitelist: valid values persist -----------------------------------------

for (const severity of ["info", "warning", "critical"]) {
  test(`post-update persists whitelisted severity "${severity}" via storage.updateAlert`, async () => {
    const { app, updateAlertCalls } = harness();
    const res = await postUpdate(app, { message: "m", status: "investigating", severity });
    assert.equal(res.status, 200);
    const statusUpdate = updateAlertCalls.find((c) => c.data.status !== undefined);
    assert.ok(statusUpdate, "the status-carrying updateAlert call exists");
    assert.equal(statusUpdate!.data.severity, severity, "new severity rides along on the same persist");
    assert.equal(statusUpdate!.id, "alert-1");
  });
}

test("post-update persists severity on the resolve path too (status=resolved)", async () => {
  const { app, updateAlertCalls } = harness();
  const res = await postUpdate(app, { message: "fixed", status: "resolved", severity: "warning" });
  assert.equal(res.status, 200);
  const statusUpdate = updateAlertCalls.find((c) => c.data.status === "resolved");
  assert.ok(statusUpdate, "resolve still goes through updateAlert");
  assert.equal(statusUpdate!.data.severity, "warning", "severity change is not dropped on resolve");
  assert.ok(statusUpdate!.data.resolvedAt instanceof Date, "resolve still stamps resolvedAt");
});

// --- Whitelist: no_change / absent / invalid never touch severity ------------

for (const [label, body] of [
  ['"no_change"', { message: "m", status: "investigating", severity: "no_change" }],
  ["absent severity", { message: "m", status: "investigating" }],
  ['invalid value "catastrophic"', { message: "m", status: "investigating", severity: "catastrophic" }],
  ["non-string severity", { message: "m", status: "investigating", severity: 42 }],
] as const) {
  test(`post-update with ${label} leaves severity untouched in every updateAlert call`, async () => {
    const { app, updateAlertCalls, alertState } = harness({ initialSeverity: "critical" });
    const res = await postUpdate(app, body);
    assert.equal(res.status, 200);
    assert.ok(updateAlertCalls.length > 0, "the status update itself is still persisted");
    for (const call of updateAlertCalls) {
      assert.ok(!("severity" in call.data), `updateAlert payload must not contain a severity key (got ${JSON.stringify(call.data)})`);
    }
    assert.equal(alertState.severity, "critical", "the alert's stored severity is unchanged");
  });
}

// --- Persist-before-fan-out ---------------------------------------------------

const subscriber = {
  id: "cust-1",
  role: "customer",
  email: "c@example.com",
  fullName: "Cust",
  subscribedServices: ["s1"],
};

test("push/email preference checks see the POST-update severity, not the old one", async () => {
  const { app, pushSeveritiesSeen, emailSeveritiesSeen, pushSends, emailSends } = harness({
    initialSeverity: "info",
    subscribers: [subscriber],
  });
  const res = await postUpdate(app, { message: "escalating", status: "investigating", severity: "critical" });
  assert.equal(res.status, 200);
  assert.deepEqual(pushSeveritiesSeen, ["critical"], "customerWantsPush is keyed on the new severity");
  assert.deepEqual(emailSeveritiesSeen, ["critical"], "customerWantsEmail is keyed on the new severity");
  assert.equal(pushSends.length, 1, "push actually fanned out");
  assert.equal(emailSends.length, 1, "email actually fanned out");
});

test("severity downgrade is visible to preference checks before fan-out", async () => {
  const { app, pushSeveritiesSeen, emailSeveritiesSeen } = harness({
    initialSeverity: "critical",
    subscribers: [subscriber],
  });
  const res = await postUpdate(app, { message: "less bad than feared", status: "monitoring", severity: "info" });
  assert.equal(res.status, 200);
  assert.deepEqual(pushSeveritiesSeen, ["info"], "a downgrade must not blast critical-level pushes");
  assert.deepEqual(emailSeveritiesSeen, ["info"], "a downgrade must not blast critical-level emails");
});

test("updateAlert (persist) happens before getAlert re-read and preference checks", async () => {
  const { app, callOrder } = harness({ initialSeverity: "info", subscribers: [subscriber] });
  const res = await postUpdate(app, { message: "m", status: "investigating", severity: "critical" });
  assert.equal(res.status, 200);
  const persistIdx = callOrder.indexOf("updateAlert");
  const readIdx = callOrder.indexOf("getAlert");
  const pushCheckIdx = callOrder.indexOf("customerWantsPush");
  assert.ok(persistIdx !== -1 && readIdx !== -1 && pushCheckIdx !== -1, `all three phases ran (order: ${callOrder.join(" → ")})`);
  assert.ok(persistIdx < readIdx, "severity is persisted before the alert is re-read for fan-out");
  assert.ok(readIdx < pushCheckIdx, "the re-read feeding the preference checks comes after persist");
});

test("with no severity change, preference checks see the existing severity", async () => {
  const { app, pushSeveritiesSeen } = harness({ initialSeverity: "warning", subscribers: [subscriber] });
  const res = await postUpdate(app, { message: "m", status: "investigating", severity: "no_change" });
  assert.equal(res.status, 200);
  assert.deepEqual(pushSeveritiesSeen, ["warning"], "no_change keeps the stored severity for preference checks");
});
