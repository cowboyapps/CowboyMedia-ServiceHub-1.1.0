import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// Route-level tests for the single-invoice detail endpoints (Task #369):
//   GET /api/billing/invoices/:invoiceId               (customer self-view)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId  (admin view)
//
// The task contract is: both routes are READ-ONLY and must NEVER 500 — every
// failure (disabled, unlinked, bad id, ownership mismatch, WHMCS unreachable,
// or an unexpected throw) degrades to a stable JSON shape. We mirror the route
// wiring in a standalone express app (same pattern as
// server/whmcs-reply-upload-rejection.test.ts) with an injectable loader so we
// can force the loader to throw and prove the catch path returns a clean
// payload instead of HTTP 500.

const emptyInvoiceDetail = (over: Record<string, unknown>) => ({
  configured: false,
  enabled: false,
  linked: false,
  unreachable: false,
  notFound: false,
  invoice: null,
  ...over,
});

interface FakeDeps {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
  clientId: number | null;
  loader: (invoiceId: number, clientId: number, baseUrl: string) => Promise<Record<string, unknown>>;
  userExists?: boolean;
}

function makeApp(deps: FakeDeps) {
  const app = express();

  app.get("/api/billing/invoices/:invoiceId", async (req, res) => {
    try {
      const invoiceId = Number(req.params.invoiceId);
      const { configured, enabled } = deps;
      if (!configured || !enabled) {
        return res.json(emptyInvoiceDetail({ configured, enabled }));
      }
      const clientId = deps.clientId;
      if (!clientId) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: false }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: true, notFound: true }));
      }
      const detail = await deps.loader(invoiceId, clientId, deps.baseUrl!);
      return res.json({ configured, enabled, linked: true, ...detail });
    } catch {
      return res.json(emptyInvoiceDetail({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });

  app.get("/api/admin/users/:id/whmcs/billing/invoices/:invoiceId", async (req, res) => {
    try {
      if (deps.userExists === false) return res.status(404).json({ message: "User not found" });
      const invoiceId = Number(req.params.invoiceId);
      const { configured, enabled } = deps;
      const clientId = deps.clientId;
      if (!configured || !enabled || !clientId) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: !!clientId }));
      }
      if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
        return res.json(emptyInvoiceDetail({ configured, enabled, linked: true, notFound: true }));
      }
      const detail = await deps.loader(invoiceId, clientId, deps.baseUrl!);
      return res.json({ configured, enabled, linked: true, ...detail });
    } catch {
      return res.json(emptyInvoiceDetail({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });

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

const baseDeps = (over: Partial<FakeDeps> = {}): FakeDeps => ({
  configured: true,
  enabled: true,
  baseUrl: "https://billing.example.com",
  clientId: 100,
  loader: async () => ({ unreachable: false, notFound: false, invoice: { id: 1, total: "10.00" } }),
  ...over,
});

const okShape = (body: any) => {
  // Every degraded response still carries the locked shape keys.
  for (const k of ["configured", "enabled", "linked", "unreachable", "notFound", "invoice"]) {
    assert.ok(k in body, `response missing key "${k}"`);
  }
};

test("customer: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/billing/invoices/5");
  assert.equal(r.status, 200);
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.invoice, null);
});

test("customer: not configured → 200 with configured:false, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ configured: false, loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/billing/invoices/5");
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.equal(called, false, "loader must not run when WHMCS is not configured");
});

test("customer: no linked client → 200 linked:false, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ clientId: null, loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/billing/invoices/5");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.equal(called, false);
});

test("customer: invalid invoice id → 200 notFound, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/billing/invoices/0");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(called, false);
});

test("customer: ownership mismatch from loader → 200 notFound (no leak)", async () => {
  const app = makeApp(baseDeps({ loader: async () => ({ unreachable: false, notFound: true, invoice: null }) }));
  const r = await get(app, "/api/billing/invoices/5");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(r.body.invoice, null);
});

test("customer: happy path → 200 with invoice", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/billing/invoices/1");
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.equal(r.body.invoice.id, 1);
});

test("admin: loader throwing → 200 unreachable, never 500", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/5");
  assert.equal(r.status, 200, "admin invoice-detail route must not 500");
  okShape(r.body);
  assert.equal(r.body.unreachable, true);
});

test("admin: unknown user → 404 (the one allowed non-200)", async () => {
  const app = makeApp(baseDeps({ userExists: false }));
  const r = await get(app, "/api/admin/users/missing/whmcs/billing/invoices/5");
  assert.equal(r.status, 404);
});

test("admin: invalid invoice id → 200 notFound, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/-3");
  assert.equal(r.status, 200);
  assert.equal(r.body.notFound, true);
  assert.equal(called, false);
});
