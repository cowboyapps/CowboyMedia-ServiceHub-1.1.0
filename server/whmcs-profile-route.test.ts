import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createGetProfileHandler,
  createUpdateProfileHandler,
  type ProfileRouteDeps,
} from "./whmcs-profile-route";
import {
  toClientProfile,
  buildClientUpdateParams,
  EDITABLE_PROFILE_FIELDS,
  type WhmcsClientProfile,
  type WhmcsClientProfileResult,
  type WhmcsRawFetch,
} from "./whmcs";

// Route-level tests for the customer WHMCS-profile endpoints:
//   GET   /api/billing/profile
//   PATCH /api/billing/profile
//
// These exercise the PRODUCTION handler factories from
// server/whmcs-profile-route.ts (wired into routes.ts), not a copy. The two
// contracts under test:
//   1. The WHMCS client id is resolved from the SESSION user and NEVER from
//      request input. A client id sent in the body is ignored; an unlinked user
//      can't write.
//   2. The GET never 500s and degrades to a stable shape; the PATCH validates
//      input, applies the field whitelist, and surfaces WHMCS errors cleanly.

const GET_SHAPE = ["configured", "enabled", "linked", "unreachable", "profile"] as const;

const SAMPLE: WhmcsClientProfile = {
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: "Analytical Engines",
  email: "ada@example.com",
  address1: "1 Computing Way",
  address2: "",
  city: "London",
  state: "",
  postcode: "EC1",
  country: "GB",
  phoneNumber: "+44 20 0000 0000",
};

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  getClientProfile?: ProfileRouteDeps["getClientProfile"];
  updateClient?: ProfileRouteDeps["updateClient"];
}

function makeApp(opts: AppOpts) {
  const deps: ProfileRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    getClientProfile: opts.getClientProfile,
    updateClient: opts.updateClient,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/billing/profile", createGetProfileHandler(deps));
  app.patch("/api/billing/profile", createUpdateProfileHandler(deps));
  return app;
}

async function call(app: express.Express, method: "GET" | "PATCH", body?: unknown) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/billing/profile`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

// ---------- pure helpers ----------

test("toClientProfile maps WHMCS fields to the normalized shape", () => {
  const p = toClientProfile({
    firstname: " Ada ",
    lastname: "Lovelace",
    companyname: "",
    email: "ada@example.com",
    address1: "1 Computing Way",
    city: "London",
    country: "GB",
    countryname: "United Kingdom",
    phonenumber: "+44 20",
    postcode: "EC1",
  });
  assert.equal(p.firstName, "Ada");
  assert.equal(p.companyName, "");
  assert.equal(p.country, "GB");
  assert.equal(p.phoneNumber, "+44 20");
  assert.equal(p.address2, "");
});

test("buildClientUpdateParams whitelists fields and always sets clientid", () => {
  const params = buildClientUpdateParams(42, {
    firstName: "Ada",
    email: "ada@example.com",
    // Non-whitelisted fields must be dropped by the whitelist loop.
    password2: "hunter2",
    status: "Closed",
  } as any);
  assert.equal(params.clientid, 42);
  assert.equal(params.firstname, "Ada");
  assert.equal(params.email, "ada@example.com");
  assert.ok(!("password2" in params), "password2 must be dropped");
  assert.ok(!("status" in params), "status must be dropped");
});

test("buildClientUpdateParams skips undefined so unspecified fields are untouched", () => {
  const params = buildClientUpdateParams(7, { city: "London" });
  assert.deepEqual(params, { clientid: 7, city: "London" });
});

test("EDITABLE_PROFILE_FIELDS excludes sensitive fields", () => {
  const keys = EDITABLE_PROFILE_FIELDS.map(([, w]) => w);
  for (const forbidden of ["password", "password2", "status", "credit", "twofa"]) {
    assert.ok(!keys.includes(forbidden), `${forbidden} must not be editable`);
  }
});

// ---------- GET ----------

test("GET: degrades cleanly when WHMCS is not configured", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 5 } }, hasCredentials: false });
  const { status, body } = await call(app, "GET");
  assert.equal(status, 200);
  for (const k of GET_SHAPE) assert.ok(k in body);
  assert.equal(body.configured, false);
  assert.equal(body.profile, null);
});

test("GET: linked=false when the session user has no linked client", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } } });
  const { body } = await call(app, "GET");
  assert.equal(body.linked, false);
  assert.equal(body.profile, null);
});

test("GET: admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "admin" } },
    getClientProfile: async (): Promise<WhmcsClientProfileResult> => { called = true; return { ok: true, profile: SAMPLE }; },
  });
  const { status, body } = await call(app, "GET");
  assert.equal(status, 403, "staff accounts must be rejected from the customer profile read");
  assert.equal(body.profile, null);
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("GET: master_admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "master_admin" } },
    getClientProfile: async (): Promise<WhmcsClientProfileResult> => { called = true; return { ok: true, profile: SAMPLE }; },
  });
  const { status } = await call(app, "GET");
  assert.equal(status, 403);
  assert.equal(called, false);
});

test("GET: returns the profile for a linked user", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProfile: async (clientId): Promise<WhmcsClientProfileResult> => {
      assert.equal(clientId, 5);
      return { ok: true, profile: SAMPLE };
    },
  });
  const { body } = await call(app, "GET");
  assert.equal(body.linked, true);
  assert.equal(body.unreachable, false);
  assert.equal(body.profile.firstName, "Ada");
});

test("GET: unreachable when the WHMCS read fails", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProfile: async (): Promise<WhmcsClientProfileResult> => ({ ok: false, reason: "network", error: "boom" }),
  });
  const { body } = await call(app, "GET");
  assert.equal(body.linked, true);
  assert.equal(body.unreachable, true);
  assert.equal(body.profile, null);
});

// ---------- PATCH ----------

test("PATCH: client id comes from the session, NOT the body", async () => {
  let savedClientId = -1;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    updateClient: async (clientId): Promise<WhmcsRawFetch> => {
      savedClientId = clientId;
      return { ok: true, data: {} };
    },
    getClientProfile: async (): Promise<WhmcsClientProfileResult> => ({ ok: true, profile: SAMPLE }),
  });
  // Attacker tries to target client 999 via the body — must be ignored.
  const { status, body } = await call(app, "PATCH", { clientid: 999, clientId: 999, firstName: "Grace" });
  assert.equal(status, 200);
  assert.equal(savedClientId, 5);
  assert.equal(body.ok, true);
});

test("PATCH: admin session → 403, WHMCS never written", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "admin" } },
    updateClient: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "PATCH", { firstName: "Grace" });
  assert.equal(status, 403, "staff accounts must be rejected from the customer profile save");
  assert.equal(body.ok, false);
  assert.equal(called, false, "WHMCS must not be written for a staff account");
});

test("PATCH: master_admin session → 403, WHMCS never written", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null, role: "master_admin" } },
    updateClient: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "PATCH", { firstName: "Grace" });
  assert.equal(status, 403);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("PATCH: rejects when the session user has no linked client", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null } },
    updateClient: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "PATCH", { firstName: "Grace" });
  assert.equal(status, 409);
  assert.equal(body.ok, false);
  assert.equal(called, false);
});

test("PATCH: validation error returns 400 without calling WHMCS", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    updateClient: async (): Promise<WhmcsRawFetch> => { called = true; return { ok: true }; },
  });
  const { status, body } = await call(app, "PATCH", { email: "not-an-email" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.ok(body.errors);
  assert.equal(called, false);
});

test("PATCH: surfaces a WHMCS error as a 400 with the message", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    updateClient: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "whmcs_error", error: "Invalid Permissions" }),
  });
  const { status, body } = await call(app, "PATCH", { firstName: "Grace" });
  assert.equal(status, 400);
  assert.equal(body.ok, false);
  assert.match(body.message, /Invalid Permissions/);
});

test("PATCH: network failure degrades to 502 (no 500)", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    updateClient: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "timeout" }),
  });
  const { status, body } = await call(app, "PATCH", { firstName: "Grace" });
  assert.equal(status, 502);
  assert.equal(body.ok, false);
});
