import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createCustomerInvoiceDetailHandler,
  createAdminInvoiceDetailHandler,
  type InvoiceDetailRouteDeps,
} from "./whmcs-invoice-detail-route";
import { loadInvoiceDetail } from "./whmcs-billing";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the single-invoice detail endpoints:
//   GET /api/billing/invoices/:invoiceId                        (customer self)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId  (admin)
//
// These exercise the PRODUCTION handler factories from
// server/whmcs-invoice-detail-route.ts (wired into routes.ts), not a copy — so a
// regression in the real client-id derivation is caught here. The handlers'
// external seams are injected: getWhmcsSettings, getUser, hasWhmcsCredentials,
// normalizeBaseUrl, and loadInvoiceDetail.
//
// Two contracts are under test:
//   1. (Task #374) The WHMCS client id is resolved from the SESSION user
//      (customer) / SELECTED user (admin) and NEVER from request input, and the
//      real loadInvoiceDetail ownership check then collapses a foreign invoice
//      to a clean not-found (no enumeration oracle). The end-to-end cases inject
//      the REAL loadInvoiceDetail behind a stubbed WHMCS getInvoice fetcher
//      (same DI seam the loader/notifier tests use).
//   2. (Task #369) Both routes are READ-ONLY and the customer route NEVER 500s —
//      every failure degrades to a stable JSON shape.

const SHAPE_KEYS = ["configured", "enabled", "linked", "unreachable", "notFound", "invoice"] as const;

function okShape(body: any) {
  for (const k of SHAPE_KEYS) assert.ok(k in body, `response missing key "${k}"`);
}

interface AppOpts {
  sessionUserId?: string | null;
  users: Record<string, { whmcsClientId: number | null; role?: string | null } | undefined>;
  enabled?: boolean;
  baseUrl?: string | null;
  hasCredentials?: boolean;
  loader: InvoiceDetailRouteDeps["loadInvoiceDetail"];
}

function makeApp(opts: AppOpts) {
  const deps: InvoiceDetailRouteDeps = {
    getWhmcsSettings: async () => ({
      baseUrl: opts.baseUrl === undefined ? "https://billing.example.com" : opts.baseUrl,
      enabled: opts.enabled ?? true,
    }),
    getUser: async (id: string) => opts.users[id],
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    // Identity normalizer keeps the baseUrl predictable in assertions.
    normalizeBaseUrl: (raw) => raw,
    loadInvoiceDetail: opts.loader,
  };

  const app = express();
  // Stand in for express-session — the customer handler reads req.session.userId.
  app.use((req, _res, next) => {
    (req as any).session = { userId: opts.sessionUserId ?? undefined };
    next();
  });
  app.get("/api/billing/invoices/:invoiceId", createCustomerInvoiceDetailHandler(deps));
  app.get("/api/admin/users/:id/whmcs/billing/invoices/:invoiceId", createAdminInvoiceDetailHandler(deps));
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

// A stubbed WHMCS getInvoice that returns an invoice owned by `ownerId` and
// records every id it was asked for (so we can assert WHMCS is never queried on
// the rejection paths). Plugged into the REAL loadInvoiceDetail.
function ownedBy(ownerId: number) {
  const calls: number[] = [];
  const fetchInvoice = async (id: number): Promise<WhmcsRawFetch> => {
    calls.push(id);
    return { ok: true, data: { invoiceid: id, userid: ownerId, total: "120.00", status: "Unpaid", duedate: "2026-12-01" } };
  };
  // Wire the production loader so the route's ownership check runs end-to-end.
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceDetail(invoiceId, clientId, baseUrl, fetchInvoice);
  return { loader, calls };
}

// A loader that records its args — used to prove the handler never queries WHMCS
// on a short-circuit path.
function spyLoader() {
  const calls: Array<{ invoiceId: number; clientId: number }> = [];
  const loader = async (invoiceId: number, clientId: number) => {
    calls.push({ invoiceId, clientId });
    return { invoice: { id: invoiceId } as any, unreachable: false, notFound: false };
  };
  return { loader, calls };
}

// ---------------------------------------------------------------------------
// Customer self-view: client id is derived from the SESSION user
// ---------------------------------------------------------------------------

test("customer: client id comes from the session user's linked client (owner matches → invoice returned)", async () => {
  const { loader, calls } = ownedBy(100);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  // Attacker tacks clientId/userid onto the query string — must be ignored.
  const r = await get(app, "/api/billing/invoices/55?clientId=999&userid=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.notFound, false);
  assert.equal(r.body.invoice.id, 55);
  assert.equal(r.body.invoice.userId, 100);
  assert.deepEqual(calls, [55]);
});

test("customer: a request-supplied client id is ignored (invoice owned by the spoofed id → not-found)", async () => {
  // Invoice is owned by 999 (the value an attacker put in the query string). If
  // the route trusted request input the ownership check would PASS; because it
  // derives clientId=100 from the session, it must collapse to not-found.
  const { loader } = ownedBy(999);
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55?clientId=999&userid=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(r.body.invoice, null);
});

test("customer: no linked WHMCS client → rejected cleanly, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null } }, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.equal(r.body.invoice, null);
  assert.deepEqual(calls, [], "WHMCS must not be queried for an unlinked user");
});

test("customer: unknown session user → linked:false, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "ghost", users: {}, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.deepEqual(calls, []);
});

test("customer: admin session → 403, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null, role: "admin" } }, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer billing read");
  okShape(r.body);
  assert.equal(r.body.invoice, null);
  assert.deepEqual(calls, [], "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, WHMCS never queried", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: null, role: "master_admin" } }, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 403);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS not configured → configured:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, hasCredentials: false, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS disabled → enabled:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, enabled: false, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.deepEqual(calls, []);
});

test("customer: invalid invoice id → notFound, no loader call (resolved client first)", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/0");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.notFound, true);
  assert.deepEqual(calls, []);
});

test("customer: WHMCS reports the id does not exist → clean not-found", async () => {
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceDetail(invoiceId, clientId, baseUrl, async () => ({ ok: false, error: "Invoice ID Not Found", reason: "whmcs_error" as const }));
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(r.body.unreachable, false);
  assert.equal(r.body.invoice, null);
});

test("customer: WHMCS outage → unreachable (not not-found)", async () => {
  const loader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceDetail(invoiceId, clientId, baseUrl, async () => ({ ok: false, error: "boom", reason: "network" as const }));
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.notFound, false);
  assert.equal(r.body.invoice, null);
});

test("customer: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: async () => { throw new Error("boom"); } });
  const r = await get(app, "/api/billing/invoices/55");
  assert.equal(r.status, 200, "customer invoice-detail route must never 500");
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.invoice, null);
});

// ---------------------------------------------------------------------------
// Admin view: client id is derived from the SELECTED user (the :id param)
// ---------------------------------------------------------------------------

test("admin: client id comes from the SELECTED user's linked client (owner matches → invoice returned)", async () => {
  const { loader, calls } = ownedBy(200);
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/77?clientId=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.invoice.id, 77);
  assert.equal(r.body.invoice.userId, 200);
  assert.deepEqual(calls, [77]);
});

test("admin: a request-supplied client id is ignored (invoice owned by the spoofed id → not-found)", async () => {
  const { loader } = ownedBy(999);
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/77?clientId=999");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(r.body.invoice, null);
});

test("admin: unknown user → 404 (the one allowed non-200)", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "someadmin", users: {}, loader });
  const r = await get(app, "/api/admin/users/missing/whmcs/billing/invoices/5");
  assert.equal(r.status, 404);
  assert.deepEqual(calls, []);
});

test("admin: selected user has no linked client → linked:false, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: null } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/5");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.deepEqual(calls, []);
});

test("admin: invalid invoice id → notFound, no loader call", async () => {
  const { loader, calls } = spyLoader();
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/-3");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.deepEqual(calls, []);
});

test("admin: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp({ sessionUserId: "someadmin", users: { cust: { whmcsClientId: 200 } }, loader: async () => { throw new Error("boom"); } });
  const r = await get(app, "/api/admin/users/cust/whmcs/billing/invoices/5");
  assert.equal(r.status, 200, "admin invoice-detail route must not 500");
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
});

// ---------------------------------------------------------------------------
// End-to-end ownership collapse: no enumeration oracle
// ---------------------------------------------------------------------------

test("end-to-end: a foreign invoice is byte-identical to a non-existent one (no enumeration oracle)", async () => {
  // Case A: the invoice exists but belongs to another client.
  const foreign = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: ownedBy(500).loader });
  const a = await get(foreign, "/api/billing/invoices/55");

  // Case B: WHMCS reports the invoice id simply does not exist.
  const missingLoader = (invoiceId: number, clientId: number, baseUrl: string | null) =>
    loadInvoiceDetail(invoiceId, clientId, baseUrl, async () => ({ ok: false, error: "Invoice ID Not Found", reason: "whmcs_error" as const }));
  const missing = makeApp({ sessionUserId: "u1", users: { u1: { whmcsClientId: 100 } }, loader: missingLoader });
  const b = await get(missing, "/api/billing/invoices/55");

  assert.equal(a.status, b.status);
  // Byte-identical bodies → an attacker can't tell "exists but not yours" from
  // "doesn't exist", so invoice ids can't be enumerated.
  assert.deepEqual(a.body, b.body);
  assert.equal(a.body.notFound, true);
  assert.equal(a.body.invoice, null);
});
