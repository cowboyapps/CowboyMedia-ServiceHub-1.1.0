import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import {
  createCustomerPayLinkHandler,
  createCustomerPayAllLinkHandler,
  type PayLinkRouteDeps,
} from "./whmcs-pay-link-route";
import type { InvoiceDetailData, BillingSummaryData } from "./whmcs-billing";

// Route-level tests for the seamless (SSO) WHMCS pay-link endpoints:
//   POST /api/billing/invoices/:invoiceId/pay-link
//   POST /api/billing/pay-all-link
//
// These exercise the PRODUCTION handler factories (wired into routes.ts), not a
// copy. Contracts under test:
//   1. Ownership — the WHMCS client id is resolved from the SESSION user, and the
//      single-invoice handler ownership-checks via loadInvoiceDetail while the
//      pay-all handler derives the outstanding id set server-side. Request input
//      can never widen that to another client's invoices.
//   2. The SSO redirect path is built server-side from the resolved ids only.
//   3. Fail-closed — every degraded path (unconfigured/disabled, unlinked, not
//      found, unreachable, SSO refused) responds non-2xx with { fallback: true }
//      and NEVER 500s on a thrown dependency, so the frontend drops back to the
//      plain viewinvoice link.
//   4. The minted URL is returned ONLY on the happy path.

const okInvoice: InvoiceDetailData = { invoice: { id: 1 } as any, unreachable: false, notFound: false };

function baseDeps(over: Partial<PayLinkRouteDeps>): PayLinkRouteDeps {
  return {
    getWhmcsSettings: async () => ({ baseUrl: "https://billing.example.com", enabled: true }),
    getUser: async () => ({ whmcsClientId: 7 }),
    hasWhmcsCredentials: () => true,
    normalizeBaseUrl: (raw) => raw,
    loadInvoiceDetail: async () => okInvoice,
    loadBillingSummary: async () =>
      ({ invoices: [], unreachable: false } as unknown as BillingSummaryData),
    createSsoToken: async () => ({ ok: true, data: { redirect_url: "https://billing.example.com/sso?token=abc" } }),
    ...over,
  };
}

async function call(app: express.Express, path: string) {
  const { default: http } = await import("node:http");
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    return { status: res.status, body: (await res.json()) as any };
  } finally {
    server.close();
  }
}

function singleApp(deps: PayLinkRouteDeps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "u1" };
    next();
  });
  app.post("/api/billing/invoices/:invoiceId/pay-link", createCustomerPayLinkHandler(deps));
  return app;
}

function allApp(deps: PayLinkRouteDeps) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { userId: "u1" };
    next();
  });
  app.post("/api/billing/pay-all-link", createCustomerPayAllLinkHandler(deps));
  return app;
}

// ---------- single invoice: happy path ----------

test("single: mints an SSO url for the owner's invoice", async () => {
  let seen: { clientId: number; path: string } | null = null;
  const deps = baseDeps({
    createSsoToken: async (clientId, path) => {
      seen = { clientId, path };
      return { ok: true, data: { redirect_url: "https://billing.example.com/sso?token=xyz" } };
    },
  });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.url, "https://billing.example.com/sso?token=xyz");
  // Client id from session-resolved user; path built server-side from the invoice id.
  assert.deepEqual(seen, { clientId: 7, path: "/viewinvoice.php?id=42" });
});

// ---------- single invoice: ownership / fail-closed ----------

test("single: 404 + fallback when the invoice isn't the caller's (notFound)", async () => {
  let ssoCalled = false;
  const deps = baseDeps({
    loadInvoiceDetail: async () => ({ invoice: null, unreachable: false, notFound: true }),
    createSsoToken: async () => { ssoCalled = true; return { ok: true, data: {} }; },
  });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/99/pay-link");
  assert.equal(status, 404);
  assert.equal(body.fallback, true);
  assert.equal(body.url, undefined);
  assert.equal(ssoCalled, false, "must not mint a token for a non-owned invoice");
});

test("single: 409 + fallback when the user isn't linked", async () => {
  const deps = baseDeps({ getUser: async () => ({ whmcsClientId: null }) });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 409);
  assert.equal(body.fallback, true);
});

test("single: 403 + fallback when the session user is an admin", async () => {
  let ssoCalled = false;
  const deps = baseDeps({
    getUser: async () => ({ whmcsClientId: 7, role: "admin" }),
    createSsoToken: async () => { ssoCalled = true; return { ok: true, data: {} }; },
  });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 403);
  assert.equal(body.fallback, true);
  assert.equal(body.url, undefined);
  assert.equal(ssoCalled, false, "must not mint a token for a staff account");
});

test("single: 403 + fallback when the session user is a master_admin", async () => {
  const deps = baseDeps({ getUser: async () => ({ whmcsClientId: 7, role: "master_admin" }) });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 403);
  assert.equal(body.fallback, true);
});

test("single: 503 + fallback when WHMCS is disabled", async () => {
  const deps = baseDeps({ getWhmcsSettings: async () => ({ baseUrl: "https://b.example", enabled: false }) });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 503);
  assert.equal(body.fallback, true);
});

test("single: 502 + fallback when WHMCS is unreachable", async () => {
  const deps = baseDeps({ loadInvoiceDetail: async () => ({ invoice: null, unreachable: true, notFound: false }) });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 502);
  assert.equal(body.fallback, true);
});

test("single: 502 + fallback when SSO is refused (disabled/unsupported)", async () => {
  const deps = baseDeps({ createSsoToken: async () => ({ ok: false, error: "SSO disabled", reason: "whmcs_error" }) });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 502);
  assert.equal(body.fallback, true);
});

test("single: 404 + fallback for a non-numeric invoice id", async () => {
  let loaded = false;
  const deps = baseDeps({ loadInvoiceDetail: async () => { loaded = true; return okInvoice; } });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/abc/pay-link");
  assert.equal(status, 404);
  assert.equal(body.fallback, true);
  assert.equal(loaded, false);
});

test("single: never 500s when a dependency throws", async () => {
  const deps = baseDeps({ getUser: async () => { throw new Error("db down"); } });
  const { status, body } = await call(singleApp(deps), "/api/billing/invoices/42/pay-link");
  assert.equal(status, 503);
  assert.equal(body.fallback, true);
});

// ---------- pay all: happy path + derivation ----------

test("all: bundles ONLY the caller's outstanding (unpaid + overdue) invoices", async () => {
  let seen: { clientId: number; path: string } | null = null;
  const deps = baseDeps({
    loadBillingSummary: async () =>
      ({
        invoices: [
          { id: 10, status: "unpaid" },
          { id: 11, status: "paid" },
          { id: 12, status: "overdue" },
          { id: 13, status: "cancelled" },
        ],
        unreachable: false,
      } as unknown as BillingSummaryData),
    createSsoToken: async (clientId, path) => {
      seen = { clientId, path };
      return { ok: true, data: { redirect_url: "https://billing.example.com/sso?token=all" } };
    },
  });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 200);
  assert.equal(body.url, "https://billing.example.com/sso?token=all");
  assert.deepEqual(seen, { clientId: 7, path: "/viewinvoice.php?id=10,12" });
});

test("all: 404 + fallback when nothing is outstanding", async () => {
  let ssoCalled = false;
  const deps = baseDeps({
    loadBillingSummary: async () =>
      ({ invoices: [{ id: 1, status: "paid" }], unreachable: false } as unknown as BillingSummaryData),
    createSsoToken: async () => { ssoCalled = true; return { ok: true, data: {} }; },
  });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 404);
  assert.equal(body.fallback, true);
  assert.equal(ssoCalled, false);
});

test("all: 502 + fallback when the summary is unreachable", async () => {
  const deps = baseDeps({
    loadBillingSummary: async () =>
      ({ invoices: [], unreachable: true } as unknown as BillingSummaryData),
  });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 502);
  assert.equal(body.fallback, true);
});

test("all: 409 + fallback when the user isn't linked", async () => {
  const deps = baseDeps({ getUser: async () => ({ whmcsClientId: null }) });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 409);
  assert.equal(body.fallback, true);
});

test("all: 403 + fallback when the session user is an admin", async () => {
  let summaryLoaded = false;
  const deps = baseDeps({
    getUser: async () => ({ whmcsClientId: 7, role: "admin" }),
    loadBillingSummary: async () => {
      summaryLoaded = true;
      return { invoices: [], unreachable: false } as unknown as BillingSummaryData;
    },
  });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 403);
  assert.equal(body.fallback, true);
  assert.equal(body.url, undefined);
  assert.equal(summaryLoaded, false, "must not derive invoices for a staff account");
});

test("all: 403 + fallback when the session user is a master_admin", async () => {
  const deps = baseDeps({ getUser: async () => ({ whmcsClientId: 7, role: "master_admin" }) });
  const { status, body } = await call(allApp(deps), "/api/billing/pay-all-link");
  assert.equal(status, 403);
  assert.equal(body.fallback, true);
});
