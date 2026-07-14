import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAlertRoutes } from "./alert-routes";

// Server-side contract tests for severity validation on the edit route
// PATCH /api/admin/alerts/:id (companion to alert-severity-change.test.ts,
// which covers POST /:id/updates):
//   1. Whitelisted values (info/warning/critical) persist via storage.updateAlert.
//   2. Anything else (garbage strings, non-strings) is rejected with 400 BEFORE
//      any storage write — an arbitrary severity string would poison the
//      severity-keyed push/email preference checks and the UI badge.
//   3. An absent severity leaves the field untouched (partial edits still work).

function harness(opts: { initialSeverity?: string } = {}) {
  const alertState: Record<string, any> = {
    id: "alert-1",
    serviceIds: ["s1"],
    title: "t",
    description: "d",
    severity: opts.initialSeverity ?? "info",
    status: "active",
  };
  const updateAlertCalls: Array<{ id: string; data: Record<string, any> }> = [];

  const storage: any = {
    updateAlert: async (id: string, data: Record<string, any>) => {
      updateAlertCalls.push({ id, data });
      Object.assign(alertState, data);
      return { ...alertState };
    },
    getAlert: async () => ({ ...alertState }),
    setAlertServices: async () => {},
  };

  const deps: any = {
    storage,
    broadcast: () => {},
    saveUploadedFile: async () => "image.png",
    parseServiceIds: (raw: any) => (Array.isArray(raw) ? raw : []),
    logActivity: () => {},
    customerWantsPush: () => false,
    customerWantsEmail: () => false,
    customerWantsInApp: () => false,
    sendPushToUser: async () => {},
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
  return { app, updateAlertCalls, alertState };
}

async function patchAlert(app: express.Express, body: any): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/alerts/alert-1`, {
      method: "PATCH",
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
  test(`edit persists whitelisted severity "${severity}" via storage.updateAlert`, async () => {
    const { app, updateAlertCalls, alertState } = harness();
    const res = await patchAlert(app, { severity });
    assert.equal(res.status, 200);
    assert.equal(updateAlertCalls.length, 1);
    assert.equal(updateAlertCalls[0].data.severity, severity);
    assert.equal(updateAlertCalls[0].id, "alert-1");
    assert.equal(alertState.severity, severity, "stored severity reflects the edit");
  });
}

// --- Invalid values are rejected with 400 before any write --------------------

for (const [label, severity] of [
  ['garbage string "catastrophic"', "catastrophic"],
  ['sentinel "no_change"', "no_change"],
  ["empty string", ""],
  ["non-string (number)", 42],
  ["non-string (object)", { $ne: null }],
] as const) {
  test(`edit with ${label} severity is rejected with 400 and nothing is persisted`, async () => {
    const { app, updateAlertCalls, alertState } = harness({ initialSeverity: "critical" });
    const res = await patchAlert(app, { title: "new title", severity });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /severity/i);
    assert.equal(updateAlertCalls.length, 0, "no storage write happens on a rejected edit");
    assert.equal(alertState.severity, "critical", "stored severity is unchanged");
    assert.equal(alertState.title, "t", "the rest of the edit is not partially applied");
  });
}

// --- Absent severity: partial edits leave the field untouched ------------------

test("edit without a severity field still works and leaves severity untouched", async () => {
  const { app, updateAlertCalls, alertState } = harness({ initialSeverity: "warning" });
  const res = await patchAlert(app, { title: "typo fixed" });
  assert.equal(res.status, 200);
  assert.equal(updateAlertCalls.length, 1);
  assert.ok(!("severity" in updateAlertCalls[0].data), "updateAlert payload has no severity key");
  assert.equal(alertState.severity, "warning");
  assert.equal(alertState.title, "typo fixed");
});
