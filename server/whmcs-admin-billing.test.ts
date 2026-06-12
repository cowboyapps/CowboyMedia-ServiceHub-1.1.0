import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createAdminBillingHandler,
  emptyBilling,
  type AdminBillingRouteDeps,
} from "./whmcs-admin-billing-route";
import { buildBillingSummary } from "./whmcs-billing";

// Route-level tests for GET /api/admin/users/:id/whmcs/billing. The central
// guarantee: the admin/staff billing payload is CREDENTIAL-FREE — it never
// carries a customer's service login username/password. Those live ONLY on the
// customer's own /api/my/services surface. The stripping happens inside
// buildBillingSummary (stripProductCredentials); these tests run the REAL
// summary path over raw WHMCS products that DO contain credentials, then assert
// the serialized HTTP payload contains no `username`/`password` keys anywhere.

const TODAY = "2026-06-11";
const ok = (data: any) => ({ ok: true as const, data });
const fail = () => ({ ok: false as const, error: "boom", reason: "network" as const });

// Recursively collect every object key in a JSON payload.
function allKeys(value: unknown, acc: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) allKeys(v, acc);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      acc.add(k);
      allKeys(v, acc);
    }
  }
  return acc;
}

interface AppOpts {
  users: Record<string, { whmcsClientId: number | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loadBillingSummary?: AdminBillingRouteDeps["loadBillingSummary"];
}

function makeApp(opts: AppOpts) {
  const deps: AdminBillingRouteDeps = {
    getUser: async (id: string) => opts.users[id],
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadBillingSummary: opts.loadBillingSummary,
  };
  const app = express();
  app.get("/api/admin/users/:id/whmcs/billing", createAdminBillingHandler(deps));
  return app;
}

async function call(app: express.Express, id = "u1") {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/admin/users/${id}/whmcs/billing`);
    const json = await res.json();
    return { status: res.status, body: json as any };
  } finally {
    server.close();
  }
}

// ---------- empty-shape helper ----------

test("emptyBilling: products is always an empty array (no credential carrier)", () => {
  const e = emptyBilling({});
  assert.deepEqual(e.products, []);
  assert.equal(e.client, null);
});

// ---------- the core credential-leak guard ----------

test("admin billing payload NEVER contains username/password keys (creds stripped end-to-end)", async () => {
  // Real summary path: WHMCS hands back a product WITH login credentials...
  const loadBillingSummary: AdminBillingRouteDeps["loadBillingSummary"] = async (_clientId, baseUrl) =>
    buildBillingSummary(
      baseUrl,
      ok({ client: { id: 5, companyname: "Acme", status: "Active" }, stats: {} }),
      ok({ invoices: { invoice: [{ id: 1, total: "10.00", status: "Unpaid", duedate: "2026-12-01" }] } }),
      ok({
        products: {
          product: [
            { id: 9, pid: 3, name: "VPS", status: "Active", username: "secretuser", password: "secretpw" },
            { id: 10, pid: 4, name: "Hosting", status: "Suspended", username: "u2", password: "p2" },
          ],
        },
      }),
      TODAY,
    );
  const app = makeApp({ users: { u1: { whmcsClientId: 5 } }, loadBillingSummary });
  const { status, body } = await call(app);
  assert.equal(status, 200);
  assert.equal(body.linked, true);
  // Products are still present (the admin sees them) ...
  assert.equal(body.products.length, 2);
  // ... but stripped of credentials.
  for (const p of body.products) {
    assert.equal(p.username, undefined);
    assert.equal(p.password, undefined);
  }
  // Belt-and-braces: NO `username`/`password` key anywhere in the payload.
  const keys = allKeys(body);
  assert.ok(!keys.has("username"), "no username key anywhere in the admin billing payload");
  assert.ok(!keys.has("password"), "no password key anywhere in the admin billing payload");
});

// ---------- degraded fallbacks (no 500, no creds) ----------

test("admin billing: unknown user -> 404", async () => {
  const app = makeApp({ users: {} });
  const { status, body } = await call(app, "nope");
  assert.equal(status, 404);
  assert.equal(body.message, "User not found");
});

test("admin billing: not configured -> empty credential-free shape", async () => {
  const app = makeApp({ users: { u1: { whmcsClientId: 5 } }, hasCredentials: false });
  const { body } = await call(app);
  assert.equal(body.configured, false);
  assert.deepEqual(body.products, []);
  const keys = allKeys(body);
  assert.ok(!keys.has("username") && !keys.has("password"));
});

test("admin billing: unlinked user -> linked=false, empty products", async () => {
  const app = makeApp({ users: { u1: { whmcsClientId: null } } });
  const { body } = await call(app);
  assert.equal(body.linked, false);
  assert.deepEqual(body.products, []);
});

test("admin billing: full WHMCS outage -> unreachable, still credential-free", async () => {
  const loadBillingSummary: AdminBillingRouteDeps["loadBillingSummary"] = async (_clientId, baseUrl) =>
    buildBillingSummary(baseUrl, fail(), fail(), fail(), TODAY);
  const app = makeApp({ users: { u1: { whmcsClientId: 5 } }, loadBillingSummary });
  const { body } = await call(app);
  assert.equal(body.unreachable, true);
  assert.deepEqual(body.products, []);
  const keys = allKeys(body);
  assert.ok(!keys.has("username") && !keys.has("password"));
});
