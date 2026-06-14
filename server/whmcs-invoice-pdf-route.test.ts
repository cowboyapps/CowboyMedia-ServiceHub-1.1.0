import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createInvoicePdfHandler, createAdminInvoicePdfHandler } from "./whmcs-invoice-pdf-route";
import type { WhmcsRawFetch } from "./whmcs";

// Route-level tests for the invoice-PDF download endpoints:
//   GET /api/billing/invoices/:invoiceId/pdf                         (customer)
//   GET /api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf   (admin)
//
// Drives the REAL production handlers (createInvoicePdfHandler /
// createAdminInvoicePdfHandler) — not a mirror copy. WHMCS has NO API action
// that returns PDF bytes, so the handler mints a single-use SSO auto-login URL
// (CreateSsoToken) and 302s the browser to WHMCS's own `dl.php?type=i&id=<id>`
// PDF link. Contracts under test:
//   1. Happy path → 302 to the minted SSO redirect URL (built from a server-side
//      ownership-checked id only).
//   2. Ownership — client id resolved from the session (customer) / selected user
//      (admin); loadInvoiceDetail rejects a non-owned invoice (notFound → 404)
//      BEFORE any SSO token is minted, so request input can't reach another
//      client's PDF. The customer route also rejects staff (403).
//   3. Fail-soft — when SSO can't be minted OR the ownership read is unreachable,
//      the route 302s to the plain (login-walled) WHMCS PDF link instead of a
//      dead end. WHMCS re-enforces ownership after login.
//   4. Hard-deny — invalid id / unconfigured / unlinked / not-found stay clean
//      404/403; an unexpected throw degrades to 503 (customer) / 500 (admin),
//      never a leak.
// The loader, SSO call, credential check and base-url normalizer are injected so
// every branch is driven without a live WHMCS.

const BASE = "https://billing.example.com";
const SSO_URL = "https://billing.example.com/dl.php?type=i&id=7&sso=onetimetoken";
const FALLBACK_PDF = `${BASE}/dl.php?type=i&id=7`;
const FALLBACK_VIEW = `${BASE}/viewinvoice.php?id=7`;

interface FakeDeps {
  configured: boolean;
  enabled: boolean;
  baseUrl: string | null;
  clientId: number | null;
  loader: (invoiceId: number, clientId: number, baseUrl: string | null) => Promise<any>;
  sso: (clientId: number, redirectPath: string) => Promise<WhmcsRawFetch>;
  userExists?: boolean;
  /** Session user's role on the customer route — staff are rejected. */
  role?: string | null;
}

function makeApp(deps: FakeDeps) {
  const app = express();
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });

  const wired = {
    getWhmcsSettings: async () => ({ baseUrl: deps.baseUrl, enabled: deps.enabled }),
    getUser: async () => (deps.userExists === false ? null : { whmcsClientId: deps.clientId, role: deps.role ?? "customer" }),
    hasWhmcsCredentials: () => deps.configured,
    normalizeBaseUrl: (raw: string | null) => raw,
    loadInvoiceDetail: deps.loader as any,
    createSsoToken: deps.sso,
  };

  app.get("/api/billing/invoices/:invoiceId/pdf", createInvoicePdfHandler(wired));
  app.get("/api/admin/users/:id/whmcs/billing/invoices/:invoiceId/pdf", createAdminInvoicePdfHandler(wired));
  return app;
}

async function get(app: express.Express, path: string): Promise<{ status: number; location: string | null; json: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}${path}`, { redirect: "manual" })
        .then(async (r) => {
          const ct = r.headers.get("content-type");
          let json: any = null;
          if (ct && ct.includes("application/json")) {
            try { json = JSON.parse(await r.text()); } catch { /* ignore */ }
          }
          return { status: r.status, location: r.headers.get("location"), json };
        })
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const ssoOk = async (): Promise<WhmcsRawFetch> => ({ ok: true, data: { redirect_url: SSO_URL } });

const baseDeps = (over: Partial<FakeDeps> = {}): FakeDeps => ({
  configured: true,
  enabled: true,
  baseUrl: BASE,
  clientId: 100,
  loader: async () => ({ unreachable: false, notFound: false, invoice: { id: 7, total: "10.00" } }),
  sso: ssoOk,
  ...over,
});

// --- The regression that started Task #450: the old code "succeeded" by calling
// a non-existent WHMCS action behind an injected stub. The contract is now a
// redirect to a real WHMCS link, so a test can no longer pass by faking bytes. ---

test("customer: happy path → 302 redirect to the minted SSO URL", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, SSO_URL);
});

test("customer: default (no ?download) SSO redirect path targets WHMCS viewinvoice.php (inline view)", async () => {
  let seenPath: string | null = null;
  const app = makeApp(baseDeps({ sso: async (_c, path) => { seenPath = path; return ssoOk(); } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(seenPath, "/viewinvoice.php?id=7");
});

test("customer: ?download=1 SSO redirect path targets WHMCS dl.php (file download)", async () => {
  let seenPath: string | null = null;
  const app = makeApp(baseDeps({ sso: async (_c, path) => { seenPath = path; return ssoOk(); } }));
  const r = await get(app, "/api/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 302);
  assert.equal(seenPath, "/dl.php?type=i&id=7");
});

test("customer: invalid invoice id → 404, no loader/sso call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ loader: async () => { called = true; return {}; }, sso: async () => { called = true; return ssoOk(); } }));
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

test("customer: admin session → 403, no loader/sso call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "admin", clientId: null, loader: async () => { called = true; return {}; }, sso: async () => { called = true; return ssoOk(); } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer PDF download");
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, no loader/sso call", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "master_admin", clientId: null, loader: async () => { called = true; return {}; }, sso: async () => { called = true; return ssoOk(); } }));
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

test("customer: ownership mismatch (loader notFound) → 404, SSO never minted", async () => {
  let ssoCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: false, notFound: true, invoice: null }),
    sso: async () => { ssoCalled = true; return ssoOk(); },
  }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(ssoCalled, false, "must not mint an SSO token for a non-owned invoice");
});

test("customer: WHMCS unreachable on detail → 302 fallback to plain WHMCS view link", async () => {
  let ssoCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: true, notFound: false, invoice: null }),
    sso: async () => { ssoCalled = true; return ssoOk(); },
  }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_VIEW);
  assert.equal(ssoCalled, false, "no token minted when ownership can't be verified");
});

test("customer: ?download=1 unreachable on detail → 302 fallback to plain WHMCS PDF (download) link", async () => {
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: true, notFound: false, invoice: null }),
  }));
  const r = await get(app, "/api/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_PDF);
});

test("customer: SSO refused (ok:false) → 302 fallback to plain WHMCS view link", async () => {
  const app = makeApp(baseDeps({ sso: async () => ({ ok: false, error: "sso disabled" }) }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_VIEW);
});

test("customer: SSO ok but no redirect_url → 302 fallback to plain WHMCS view link", async () => {
  const app = makeApp(baseDeps({ sso: async () => ({ ok: true, data: {} }) }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_VIEW);
});

test("customer: unexpected throw → 503, never 500/leak", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/billing/invoices/7/pdf");
  assert.equal(r.status, 503);
});

test("admin: happy path → 302 redirect to the minted SSO URL", async () => {
  const app = makeApp(baseDeps());
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, SSO_URL);
});

test("admin: unknown user → 404", async () => {
  const app = makeApp(baseDeps({ userExists: false }));
  const r = await get(app, "/api/admin/users/missing/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
});

test("admin: ownership mismatch → 404, SSO never minted", async () => {
  let ssoCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: false, notFound: true, invoice: null }),
    sso: async () => { ssoCalled = true; return ssoOk(); },
  }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 404);
  assert.equal(ssoCalled, false);
});

test("admin: default (no ?download) SSO redirect path targets WHMCS viewinvoice.php (inline view)", async () => {
  let seenPath: string | null = null;
  const app = makeApp(baseDeps({ sso: async (_c, path) => { seenPath = path; return ssoOk(); } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(seenPath, "/viewinvoice.php?id=7");
});

test("admin: ?download=1 SSO redirect path targets WHMCS dl.php (file download)", async () => {
  let seenPath: string | null = null;
  const app = makeApp(baseDeps({ sso: async (_c, path) => { seenPath = path; return ssoOk(); } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 302);
  assert.equal(seenPath, "/dl.php?type=i&id=7");
});

test("admin: WHMCS unreachable on detail → 302 fallback to plain WHMCS view link", async () => {
  let ssoCalled = false;
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: true, notFound: false, invoice: null }),
    sso: async () => { ssoCalled = true; return ssoOk(); },
  }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_VIEW);
  assert.equal(ssoCalled, false);
});

test("admin: ?download=1 unreachable on detail → 302 fallback to plain WHMCS PDF (download) link", async () => {
  const app = makeApp(baseDeps({
    loader: async () => ({ unreachable: true, notFound: false, invoice: null }),
  }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf?download=1");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_PDF);
});

test("admin: SSO refused → 302 fallback to plain WHMCS view link", async () => {
  const app = makeApp(baseDeps({ sso: async () => ({ ok: false, error: "nope" }) }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 302);
  assert.equal(r.location, FALLBACK_VIEW);
});

test("admin: unexpected throw → 500", async () => {
  const app = makeApp(baseDeps({ loader: async () => { throw new Error("boom"); } }));
  const r = await get(app, "/api/admin/users/abc/whmcs/billing/invoices/7/pdf");
  assert.equal(r.status, 500);
});
