import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createInvoicePdfHandler, createAdminInvoicePdfHandler } from "./whmcs-invoice-pdf-route";

// Route-level tests for the invoice-PDF download proxies (Task #373):
//   GET /api/billing/invoices/:invoiceId/pdf                         (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf   (admin)
//
// Drives the REAL production handlers (createInvoicePdfHandler /
// createAdminInvoicePdfHandler) — not a mirror copy — so a regression in either
// route's branch logic is caught here. Contract: the proxy fetches a single
// invoice's official WHMCS PDF and streams the bytes through ServiceHub so the
// customer never gets bounced to a WHMCS client-area login. Ownership is enforced
// exactly like the invoice-detail read (loadInvoiceDetail rejects any invoice
// whose owning client doesn't match), so a customer can't pull another client's
// PDF by guessing an id; the customer route additionally rejects staff (Task
// #439). Failures degrade cleanly: 404 (not found / unconfigured / unlinked /
// ownership mismatch), 502 (WHMCS unreachable or PDF fetch failed), 503/500
// (unexpected throw) — never a leak. The loader, pdf fetch, credential check and
// base-url normalizer are all injected so we can drive every branch without a
// live WHMCS.

interface FakeDeps {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
  clientId: number | null;
  loader: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<any>;
  pdf: (invoiceId: number) => Promise<{ ok: boolean; data?: string; error?: string }>;
  userExists?: boolean;
  /** Session user's role on the customer route — staff are rejected (Task #439). */
  role?: string | null;
}

function makeApp(deps: FakeDeps) {
  const app = express();
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });

  const customer = createInvoicePdfHandler({
    getWhmcsSettings: async () => ({ baseUrl: deps.baseUrl, enabled: deps.enabled }),
    getUser: async () => (deps.userExists === false ? null : { whmcsClientId: deps.clientId, role: deps.role ?? "customer" }),
    hasWhmcsCredentials: () => deps.configured,
    normalizeBaseUrl: (raw) => raw,
    loadInvoiceDetail: deps.loader as any,
    getInvoicePdf: deps.pdf as any,
  });

  const admin = createAdminInvoicePdfHandler({
    getWhmcsSettings: async () => ({ baseUrl: deps.baseUrl, enabled: deps.enabled }),
    getUser: async () => (deps.userExists === false ? null : { whmcsClientId: deps.clientId, role: deps.role ?? "customer" }),
    hasWhmcsCredentials: () => deps.configured,
    normalizeBaseUrl: (raw) => raw,
    loadInvoiceDetail: deps.loader as any,
    getInvoicePdf: deps.pdf as any,
  });

  app.get("/api/billing/invoices/:invoiceId/pdf", customer);
  app.get("/api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf", admin);
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; contentType: string | null; disposition: string | null; bytes: Buffer; json: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${path}`)
        .then(async (r) => {
          const buf = Buffer.from(await r.arrayBuffer());
          const ct = r.headers.get("content-type");
          let json: any = null;
          if (ct && ct.includes("application/json")) {
            try { json = JSON.parse(buf.toString("utf8")); } catch { /* ignore */ }
          }
          return {
            status: r.status,
            contentType: ct,
            disposition: r.headers.get("content-disposition"),
            bytes: buf,
            json,
          };
        })
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const PDF_B64 = Buffer.from("%PDF-1.4 fake").toString("base64");

const baseDeps = (over: Partial<FakeDeps> = {}): FakeDeps => ({
  configured: true,
  enabled: true,
  baseUrl: "https://billing.example.com",
  clientId: 100,
  loader: async () => ({ unreachable: false, notFound: false, invoice: { id: 1, total: "10.00" } }),
  pdf: async () => ({ ok: true, data: PDF_B64 }),
  ...over,
});

test("customer: happy path → 200 application/pdf with bytes", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 200);
  assert.equal(r.contentType, "application/pdf");
  assert.match(r.disposition ?? "", /inline; filename="invoice-7\.pdf"/);
  assert.equal(r.bytes.toString("utf8"), "%PDF-1.4 fake");
});

test("customer: invalid invoice id → 404, no loader/pdf call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ loader: async () => { called = true; return {}; }, pdf: async () => { called = true; return { ok: false }; } }));
  const r = await get(app, "/api/billing/invoices/0/pdf");
  assert.equal(r.status, 404);
  assert.equal(called, false);
});

test("customer: not configured → 404, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ configured: false, loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(called, false);
});

test("customer: admin session → 403, no loader/pdf call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "admin", loader: async () => { called = true; return {}; }, pdf: async () => { called = true; return { ok: false }; } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer PDF download");
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, no loader/pdf call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "master_admin", loader: async () => { called = true; return {}; }, pdf: async () => { called = true; return { ok: false }; } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 403);
  assert.equal(called, false);
});

test("customer: no linked client → 404, no loader call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ clientId: null, loader: async () => { called = true; return {}; } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(called, false);
});

test("customer: ownership mismatch (loader notFound) → 404, pdf never fetched", async () => {
  let pdfCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: false, notFound: true, invoice: null }),
    pdf: async () => { pdfCalled = true; return { ok: true, data: PDF_B64 }; },
  }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(pdfCalled, false, "must not fetch PDF for a non-owned invoice");
});

test("customer: WHMCS unreachable on detail → 502", async () => {
  const app = makeApp(baseDeps({ loader: async () => ({ unreachable: true, notFound: false, invoice: null }) }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 502);
});

test("customer: PDF fetch fails → 502 (clean message, no crash)", async () => {
  const app = makeApp(baseDeps({ pdf: async () => ({ ok: false, error: "nope" }) }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 502);
  assert.equal(r.contentType?.includes("application/json"), true);
});

test("customer: unexpected throw → 503, never 500/leak", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 503);
});

test("admin: happy path → 200 application/pdf", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 200);
  assert.equal(r.contentType, "application/pdf");
  assert.equal(r.bytes.toString("utf8"), "%PDF-1.4 fake");
});

test("admin: unknown user → 404", async () => {
  const app = makeApp(baseDeps({ userExists: false }));
  const r = await get(app, "/api/admin/users/missing/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
});

test("admin: ownership mismatch → 404, pdf never fetched", async () => {
  let pdfCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: false, notFound: true, invoice: null }),
    pdf: async () => { pdfCalled = true; return { ok: true, data: PDF_B64 }; },
  }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(pdfCalled, false);
});

test("admin: PDF fetch fails → 502 surfaces the underlying error", async () => {
  const app = makeApp(baseDeps({ pdf: async () => ({ ok: false, error: "nope" }) }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 502);
  assert.match(r.json?.message ?? "", /nope/);
});

test("admin: unexpected throw → 500", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 500);
});

// Content-Disposition switching (Task #378): the "Download PDF" action appends
// ?download=1 to force a save-to-device on mobile, where inline PDF viewing is
// unreliable. Without ?download=1 the proxy must keep serving the bytes inline
// so in-browser/in-app preview still works. Both proxy routes must honour this.

test("customer: default (no ?download) → Content-Disposition inline", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^inline; filename="invoice-7\.pdf"$/);
});

test("customer: ?download=1 → Content-Disposition attachment", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^attachment; filename="invoice-7\.pdf"$/);
});

test("customer: ?download=0 (and other values) → stays inline", async () => {
  const app = makeApp(baseDeps());
  for (const q of ["download=0", "download=true", "download=", "foo=1"]) {
    const r = await get(app, `/api/billing/invoices/7/pdf?${q}`);
    assert.equal(r.status, 200);
    assert.match(r.disposition ?? "", /^inline; /, q);
  }
});

test("admin: default (no ?download) → Content-Disposition inline", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^inline; filename="invoice-7\.pdf"$/);
});

test("admin: ?download=1 → Content-Disposition attachment", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 200);
  assert.match(r.disposition ?? "", /^attachment; filename="invoice-7\.pdf"$/);
});

test("admin: ?download=0 (and other values) → stays inline", async () => {
  const app = makeApp(baseDeps());
  for (const q of ["download=0", "download=true", "download=", "foo=1"]) {
    const r = await get(app, `/api/admin/users/abc/whmcs/billing/invoices/7/pdf?${q}`);
    assert.equal(r.status, 200);
    assert.match(r.disposition ?? "", /^inline; /, q);
  }
});
