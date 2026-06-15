import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createMyServicesHandler,
  emptyActiveServices,
  type ServicesRouteDeps,
} from "./whmcs-services-route";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for GET /api/my/services — the ONLY surface that returns a
// customer's service login credentials (username/password). These exercise the
// PRODUCTION handler factory wired into routes.ts (not a copy). Contracts:
//   1. The WHMCS client id is resolved from the SESSION user, never request
//      input.
//   2. Every unconfigured / disabled / unlinked / unreachable state degrades to
//      the same fully-keyed empty shape (services: []) and never 500s.
//   3. The happy path returns ONLY active services, each carrying exactly the
//      access view (username + password included — this is the customer's own
//      data).

const SHAPE = ["configured", "enabled", "linked", "unreachable", "services"] as const;

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  getClientProducts?: ServicesRouteDeps["getClientProducts"];
  listProductDns?: ServicesRouteDeps["listProductDns"];
}

function makeApp(opts: AppOpts) {
  const deps: ServicesRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    getClientProducts: opts.getClientProducts,
    listProductDns: opts.listProductDns,
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/my/services", createMyServicesHandler(deps));
  return app;
}

async function call(app: express.Express) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/my/services`);
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

const okProducts = (data: any): WhmcsRawFetch => ({ ok: true, data });

// ---------- empty-shape helper ----------

test("emptyActiveServices: always carries the full locked shape", () => {
  const e = emptyActiveServices({});
  for (const k of SHAPE) assert.ok(k in e, `missing key ${k}`);
  assert.deepEqual(e.services, []);
});

// ---------- degraded fallbacks ----------

test("GET: not configured -> empty shape, no WHMCS call", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    hasCredentials: false,
    getClientProducts: async () => { called = true; return okProducts({}); },
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  for (const k of SHAPE) assert.ok(k in body);
  assert.equal(body.configured, false);
  assert.deepEqual(body.services, []);
  assert.equal(called, false);
});

test("GET: configured but disabled -> empty shape", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 5 } }, enabled: false });
  const { body } = await call(app);
  assert.equal(body.configured, true);
  assert.equal(body.enabled, false);
  assert.equal(body.linked, false);
  assert.deepEqual(body.services, []);
});

test("GET: linked=false when the session user has no linked client", async () => {
  let called = false;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: null } },
    getClientProducts: async () => { called = true; return okProducts({}); },
  });
  const { body } = await call(app);
  assert.equal(body.configured, true);
  assert.equal(body.enabled, true);
  assert.equal(body.linked, false);
  assert.deepEqual(body.services, []);
  assert.equal(called, false);
});

test("GET: WHMCS read failure degrades to unreachable, never 500", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProducts: async (): Promise<WhmcsRawFetch> => ({ ok: false, reason: "network", error: "boom" }),
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.linked, true);
  assert.equal(body.unreachable, true);
  assert.deepEqual(body.services, []);
});

// ---------- happy path ----------

test("GET: returns ONLY active services, each with its own login credentials", async () => {
  let seenClientId = -1;
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProducts: async (clientId): Promise<WhmcsRawFetch> => {
      seenClientId = clientId;
      return okProducts({
        products: {
          product: [
            { id: 1, name: "Live VPS", status: "Active", billingcycle: "Monthly", recurringamount: "20.00", nextduedate: "2026-08-01", username: "u1login", password: "s3cr3t!" },
            { id: 2, name: "Suspended Box", status: "Suspended", username: "u2", password: "p2" },
            { id: 3, name: "Terminated Box", status: "Terminated", username: "u3", password: "p3" },
          ],
        },
      });
    },
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  // Client id came from the session user's linked client, not request input.
  assert.equal(seenClientId, 5);
  assert.equal(body.linked, true);
  assert.equal(body.unreachable, false);
  // Only the single Active product survives.
  assert.equal(body.services.length, 1);
  const s = body.services[0];
  assert.equal(s.id, 1);
  assert.equal(s.name, "Live VPS");
  assert.equal(s.status, "Active");
  // The customer's OWN credentials are present on this surface (by design).
  assert.equal(s.username, "u1login");
  assert.equal(s.password, "s3cr3t!");
});

test("GET: joins admin-set product DNS onto active services by pid", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProducts: async (): Promise<WhmcsRawFetch> =>
      okProducts({
        products: {
          product: [
            { id: 1, pid: 10, name: "Has DNS", status: "Active", username: "a", password: "b" },
            { id: 2, pid: 20, name: "No DNS", status: "Active", username: "c", password: "d" },
          ],
        },
      }),
    listProductDns: async () => [{ whmcsProductId: 10, dns: "host.example.com" }],
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.services.length, 2);
  const byId = Object.fromEntries(body.services.map((s: any) => [s.id, s]));
  assert.equal(byId[1].dns, "host.example.com");
  assert.equal(byId[2].dns, "");
});

test("GET: a DNS lookup failure does NOT break services (dns falls back to '')", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProducts: async (): Promise<WhmcsRawFetch> =>
      okProducts({ products: { product: [{ id: 1, pid: 10, name: "VPS", status: "Active", username: "a", password: "b" }] } }),
    listProductDns: async () => { throw new Error("dns table boom"); },
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.unreachable, false);
  assert.equal(body.services.length, 1);
  assert.equal(body.services[0].dns, "");
});

test("GET: a thrown storage error degrades to unreachable, never 500", async () => {
  const app = makeApp({
    sessionUserId: "u1",
    users: { u1: { whmcsClientId: 5 } },
    getClientProducts: async () => { throw new Error("kaboom"); },
  });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.unreachable, true);
  assert.deepEqual(body.services, []);
});
