import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createCustomerInvoiceServiceHandler,
  createAdminInvoiceServiceHandler,
  type InvoiceServiceRouteDeps,
} from "./whmcs-invoice-service-route";
import { loadInvoiceServiceHint } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the per-invoice renewed-service lookup endpoints:
//   GET /api/billing/invoices/:invoiceId/service                        (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/service  (admin)
//
// These exercise the PRODUCTION handler factories from
// server/whmcs-invoice-service-route.ts (wired into routes.ts), not a copy. Two
// contracts are under test, mirroring the invoice-detail route:
//   1. The WHMCS client id is resolved from the SESSION user (customer) /
//      SELECTED user (admin) and NEVER from request input; the real
//      loadInvoiceServiceHint ownership check then collapses a foreign invoice
//      to a clean not-found (no enumeration oracle).
//   2. Both routes are READ-ONLY and the customer route NEVER 500s — every
//      failure degrades to a stable JSON shape.

const SHAPE_KEYS = ["configured", "enabled", "linked", "unreachable", "notFound", "service"] as const;

function okShape(body: any) {
  for (const k of SHAPE_KEYS) assert.ok(k in body, `response missing key "${k}"`);
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loader: InvoiceServiceRouteDeps["loadInvoiceServiceHint"];
}

function makeApp(opts: AppOpts) {
  const deps: InvoiceServiceRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (raw) => raw,
    loadInvoiceServiceHint: opts.loader,
  };

  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/billing/invoices/:invoiceId/service", createCustomerInvoiceServiceHandler(deps));
  app.get("/api/admin/users/:id/whmcs/billing/invoices/:invoiceId/service", createAdminInvoiceServiceHandler(deps));
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

// A stubbed WHMCS getInvoice returning an invoice owned by `ownerId` with a
// single hosting line item (service 42). Plugged into the REAL
// loadInvoiceServiceHint (with a stubbed product list so the name resolves).
function ownedBy(ownerId: number, serviceId = 42, productName = "Web Hosting Pro") {
  const calls: number[] = [];
  const fetchInvoice = async (id: number): Promise<WhmcsRawFetch> => {
    calls.push(id);
    return {
      ok: true,
      data: {
        invoiceid: id,
        userid: ownerId,
        total: "120.00",
        status: "Paid",
        items: { item: [{ id: 1, type: "Hosting", relid: serviceId, description: "Renewal", amount: "120.00" }] },
      },
    };
  };
  const loadSummary = async () => ({
    client: null,
    balance: null,
    invoices: [],
    products: [{ id: serviceId, pid: 1, name: productName, domain: "", status: "Active", nextDueDate: null, billingCycle: "Monthly", amount: "120.00" }],
    portalUrl: null,
    payAll: null,
    unreachable: false,
  });
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceServiceHint(invoiceId, clientId, baseUrl, fetchInvoice, loadSummary as any);
  return { loader, calls };
}

function spyLoader() {
  const calls: Array<{ invoiceId: number; clientId: number }> = [];
  const loader = async (invoiceId: number, clientId: number) => {
    calls.push({ invoiceId, clientId });
    return { unreachable: false, notFound: false, service: null };
  };
  return { loader, calls };
}

// ---------------------------------------------------------------------------
// Customer self-view: client id is derived from the SESSION user
// ---------------------------------------------------------------------------

test("customer: owner matches → service hint returned (name from products)", async () => {
  const { loader, calls } = ownedBy(100);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service?clientId=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.notFound, false);
  assert.deepEqual(r.body.service, {
    serviceId: 42,
    serviceName: "Web Hosting Pro",
    serviceUrl: "https://billing.example.com/clientarea.php?action=productdetails&id=42",
  });
  assert.deepEqual(calls, [55]);
});

test("customer: a request-supplied client id is ignored (invoice owned by spoofed id → not-found)", async () => {
  const { loader } = ownedBy(999);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service?clientId=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(r.body.service, null);
});

test("customer: no linked WHMCS client → rejected cleanly, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.equal(r.body.service, null);
  assert.deepEqual(calls, []);
});

test("customer: admin session → 403, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null, role: "admin" } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer billing read");
  okShape(r.body);
  assert.equal(r.body.service, null);
  assert.deepEqual(calls, [], "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null, role: "master_admin" } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 403);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS not configured → configured:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, hasCredentials: false, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS disabled → enabled:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, enabled: false, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.deepEqual(calls, []);
});

test("customer: invalid invoice id → notFound, no loader call (resolved client first)", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/0/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.notFound, true);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS outage loading the invoice → unreachable (not not-found)", async () => {
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceServiceHint(invoiceId, clientId, baseUrl, async () => ({ ok: false, error: "boom", reason: "network" as const }));
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.notFound, false);
  assert.equal(r.body.service, null);
});

test("customer: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: async () => { throw new Error("boom"); } });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200, "customer invoice-service route must never 500");
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.service, null);
});

// ---------------------------------------------------------------------------
// Admin view: client id is derived from the SELECTED user (the :id param)
// ---------------------------------------------------------------------------

test("admin: owner matches → service hint returned", async () => {
  const { loader, calls } = ownedBy(200);
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/77/service?clientId=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.service.serviceId, 42);
  assert.deepEqual(calls, [77]);
});

test("admin: unknown user → 404 (the one allowed non-200)", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "someadmin", users: {}, loader });
  const r = await get(app, "/api/admin/users/missing/whmcs/billing/invoices/5/service");
  assert.equal(r.status, 404);
  assert.deepEqual(calls, []);
});

test("admin: selected user has no linked client → linked:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: null } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/5/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.deepEqual(calls, []);
});

test("admin: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader: async () => { throw new Error("boom"); } });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/5/service");
  assert.equal(r.status, 200, "admin invoice-service route must not 500");
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
});

// ---------------------------------------------------------------------------
// End-to-end ownership collapse: no enumeration oracle
// ---------------------------------------------------------------------------

test("end-to-end: a foreign invoice is byte-identical to a non-existent one (no enumeration oracle)", async () => {
  const foreign = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: ownedBy(500).loader });
  const a = await get(foreign, "/api/billing/invoices/55/service");

  const missingLoader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceServiceHint(invoiceId, clientId, baseUrl, async () => ({ ok: false, error: "Invoice ID Not Found", reason: "whmcs_error" as const }));
  const missing = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: missingLoader });
  const b = await get(missing, "/api/billing/invoices/55/service");

  assert.equal(a.status, b.status);
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.notFound, true);
  assert.equal(a.body.service, null);
});

// ---------------------------------------------------------------------------
// Correlation fallbacks (pure loadInvoiceServiceHint behaviour through route)
// ---------------------------------------------------------------------------

test("customer: invoice with no hosting line → service:null (clean, not an error)", async () => {
  const fetchInvoice = async (id: number): Promise<WhmcsRawFetch> => ({
    ok: true,
    data: {
      invoiceid: id,
      userid: 100,
      total: "10.00",
      status: "Paid",
      items: { item: [{ id: 1, type: "Domain", relid: 7, description: "example.com", amount: "10.00" }] },
    },
  });
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceServiceHint(invoiceId, clientId, baseUrl, fetchInvoice, (async () => ({
      client: null, balance: null, invoices: [], products: [], portalUrl: null, payAll: null, unreachable: false,
    })) as any);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, false);
  assert.equal(r.body.service, null);
});

test("customer: products read failing still labels from the line description (degrades, not blank)", async () => {
  const fetchInvoice = async (id: number): Promise<WhmcsRawFetch> => ({
    ok: true,
    data: {
      invoiceid: id,
      userid: 100,
      total: "120.00",
      status: "Paid",
      items: { item: [{ id: 1, type: "Hosting", relid: 42, description: "Acme VPS Renewal", amount: "120.00" }] },
    },
  });
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceServiceHint(invoiceId, clientId, baseUrl, fetchInvoice, (async () => { throw new Error("products down"); }) as any);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55/service");
  assert.equal(r.status, 200);
  assert.equal(r.body.service.serviceId, 42);
  assert.equal(r.body.service.serviceName, "Acme VPS Renewal");
});
