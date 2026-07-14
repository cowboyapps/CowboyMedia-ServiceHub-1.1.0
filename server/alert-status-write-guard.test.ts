import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { registerAlertRoutes } from "./alert-routes";

// Server-side contract tests pinning the alert-row `status` write guards on the
// two routes NOT already covered by alert-impact-validation.test.ts:
//   1. POST /api/admin/alerts (create) spreads req.body into the insert, so it
//      must whitelist status (investigating/identified/monitoring). "resolved"
//      and "active" are rejected — resolving is a lifecycle action that stamps
//      resolvedAt, and create-time garbage would poison the "active alerts"
//      filters. Absent status is fine (schema defaults to "investigating").
//   2. PATCH /api/admin/alerts/:id (edit) builds its update payload
//      field-by-field and must NEVER copy a status key from req.body — edits
//      are corrections; status changes go through post-update / resolve.

function harness(opts: { initialStatus?: string } = {}) {
  const alertState: Record<string, any> = {
    id: "alert-1",
    serviceIds: ["s1"],
    title: "t",
    description: "d",
    severity: "info",
    status: opts.initialStatus ?? "investigating",
    impact: "degraded",
  };
  const createAlertCalls: Array<{ data: Record<string, any>; serviceIds: string[] }> = [];
  const updateAlertCalls: Array<{ id: string; data: Record<string, any> }> = [];

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
    getAllUsers: async () => [],
    createContentNotificationBulk: async () => {},
    recomputeServiceStatus: async () => "operational",
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
  return { app, createAlertCalls, updateAlertCalls, alertState };
}

async function request(app: express.Express, method: string, path: string, body: any): Promise<{ status: number; body: any }> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", () => resolve()));
  try {
    const port = (server.address() as any).port;
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const createAlert = (app: express.Express, body: any) => request(app, "POST", "/api/admin/alerts", body);
const editAlert = (app: express.Express, body: any) => request(app, "PATCH", "/api/admin/alerts/alert-1", body);

const baseCreate = { title: "t", description: "d", serviceIds: ["s1"], silent: true };

// --- Create: whitelisted statuses pass through ---------------------------------

for (const status of ["investigating", "identified", "monitoring"]) {
  test(`create accepts whitelisted status "${status}" and passes it to the insert`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, status });
    assert.equal(res.status, 200);
    assert.equal(createAlertCalls.length, 1);
    assert.equal(createAlertCalls[0].data.status, status);
  });
}

test("create with absent status still works (schema defaults it)", async () => {
  const { app, createAlertCalls } = harness();
  const res = await createAlert(app, baseCreate);
  assert.equal(res.status, 200);
  assert.equal(createAlertCalls.length, 1);
  assert.ok(!("status" in createAlertCalls[0].data), "no status key is injected");
});

// --- Create: invalid status rejected before any write --------------------------

for (const [label, status] of [
  ['garbage string "on_fire"', "on_fire"],
  ['terminal "resolved" (must go through the resolve/post-update routes)', "resolved"],
  ['legacy row value "active"', "active"],
  ['sentinel "no_change"', "no_change"],
  ["empty string", ""],
  ["non-string (number)", 42],
  ["non-string (object)", { $ne: null }],
] as const) {
  test(`create with ${label} status is rejected with 400 and nothing is persisted`, async () => {
    const { app, createAlertCalls } = harness();
    const res = await createAlert(app, { ...baseCreate, status });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /status/i);
    assert.equal(createAlertCalls.length, 0, "no alert is created on a rejected request");
  });
}

// --- Create: server-owned / unknown keys never reach storage.createAlert -------

test("create with injected server-owned and unknown keys strips them all from the insert", async () => {
  const { app, createAlertCalls } = harness();
  const res = await createAlert(app, {
    ...baseCreate,
    status: "identified",
    severity: "critical",
    id: "attacker-chosen-id",
    createdAt: "1999-01-01T00:00:00.000Z",
    resolvedAt: "1999-01-01T00:00:00.000Z",
    postmortemHtml: "<script>alert(1)</script>",
    postmortemPublishedAt: "1999-01-01T00:00:00.000Z",
    postmortemAuthorId: "someone-else",
    imageUrl: "https://evil.example/x.png",
    impact: "outage",
    totallyUnknownKey: "x",
  });
  assert.equal(res.status, 200);
  assert.equal(createAlertCalls.length, 1);
  const data = createAlertCalls[0].data;
  for (const key of ["id", "createdAt", "resolvedAt", "postmortemHtml", "postmortemPublishedAt", "postmortemAuthorId", "imageUrl", "totallyUnknownKey"]) {
    assert.ok(!(key in data), `injected key "${key}" must never reach storage.createAlert (got ${JSON.stringify(data)})`);
  }
  // Only the explicit allowlist survives; impact comes from serviceImpact (defaulted), not the body's impact key.
  assert.deepEqual(Object.keys(data).sort(), ["description", "impact", "severity", "status", "title"].sort());
  assert.equal(data.impact, "degraded", "body `impact` key is ignored; only serviceImpact drives impact");
});

test("create insert payload contains only allowlisted keys for a plain request", async () => {
  const { app, createAlertCalls } = harness();
  const res = await createAlert(app, baseCreate);
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(createAlertCalls[0].data).sort(), ["description", "impact", "title"].sort());
});

// --- Edit: status from req.body is never copied into the update payload --------

for (const [label, status] of [
  ['whitelisted lifecycle value "monitoring"', "monitoring"],
  ['terminal "resolved"', "resolved"],
  ['garbage string "on_fire"', "on_fire"],
  ["non-string (object)", { $ne: null }],
] as const) {
  test(`edit with ${label} status in the body leaves status untouched in every updateAlert call`, async () => {
    const { app, updateAlertCalls, alertState } = harness({ initialStatus: "identified" });
    const res = await editAlert(app, { title: "new title", status });
    assert.equal(res.status, 200);
    assert.ok(updateAlertCalls.length > 0, "the edit itself is still persisted");
    for (const call of updateAlertCalls) {
      assert.ok(!("status" in call.data), `updateAlert payload must not contain a status key (got ${JSON.stringify(call.data)})`);
    }
    assert.equal(alertState.status, "identified", "the alert's stored status is unchanged");
    assert.equal(alertState.title, "new title", "the legitimate edit still landed");
  });
}
