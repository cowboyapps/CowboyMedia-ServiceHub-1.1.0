import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createCustomerBillingHandler } from "./whmcs-billing-summary-route";

// Route-level test for the customer billing-summary endpoint:
//   GET /api/billing
//
// Drives the REAL production handler (createCustomerBillingHandler) — not a
// mirror copy — so a regression in the route's branch logic is caught here. The
// route is scoped to the SESSION user's OWN linked WHMCS client; staff accounts
// never have one, so they are rejected server-side (defence-in-depth, Task #439)
// even if a UI gate is bypassed — matching the seamless pay-link routes. The
// credential check, base-url normalizer and summary loader are all injected so
// we can prove WHMCS is never queried on the rejection path without a live API.

interface FakeDeps {
  configured: boolean;
  enabled: boolean;
  clientId: number | null;
  role?: string | null;
  loadSummary: () => Promise<{ summary: any; transactions: any[]; transactionsUnreachable: boolean }>;
}

function makeApp(deps: FakeDeps) {
  const app = express();
  const handler = createCustomerBillingHandler({
    getWhmcsSettings: async () => ({ baseUrl: "https://billing.example.com", enabled: deps.enabled }),
    getUser: async () => ({ whmcsClientId: deps.clientId, role: deps.role ?? "customer" }),
    hasWhmcsCredentials: () => deps.configured,
    normalizeBaseUrl: (raw) => raw,
    loadCustomerBillingWithServices: deps.loadSummary as any,
  });
  // The session user id is read off req.session.userId inside the handler.
  app.use((req, _res, next) => { (req as any).session = { userId: "u1" }; next(); });
  app.get("/api/billing", handler);
  return app;
}

async function get(app: express.Express): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      fetch(`http://127.0.0.1:${port}/api/billing`)
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

const baseDeps = (over: Partial<FakeDeps> = {}): FakeDeps => ({
  configured: true,
  enabled: true,
  clientId: 100,
  loadSummary: async () => ({ summary: { balance: null }, transactions: [], transactionsUnreachable: false }),
  ...over,
});

test("customer: admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "admin", loadSummary: async () => { called = true; return { summary: {}, transactions: [], transactionsUnreachable: false }; } }));
  const r = await get(app);
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer billing summary");
  assert.equal(r.body.linked, false);
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "master_admin", loadSummary: async () => { called = true; return { summary: {}, transactions: [], transactionsUnreachable: false }; } }));
  const r = await get(app);
  assert.equal(r.status, 403);
  assert.equal(called, false);
});

test("customer: regular linked user → 200 with summary", async () => {
  const app = makeApp(baseDeps({ role: "customer" }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
});

test("customer: not configured → 200 empty shape, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ configured: false, loadSummary: async () => { called = true; return { summary: {}, transactions: [], transactionsUnreachable: false }; } }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.configured, false);
  assert.equal(r.body.linked, false);
  assert.equal(called, false);
});

test("customer: disabled → 200 empty shape, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ enabled: false, loadSummary: async () => { called = true; return { summary: {}, transactions: [], transactionsUnreachable: false }; } }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, false);
  assert.equal(called, false);
});

test("customer: no linked client → 200 unlinked shape, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ clientId: null, loadSummary: async () => { called = true; return { summary: {}, transactions: [], transactionsUnreachable: false }; } }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, false);
  assert.equal(called, false);
});

test("customer: loader throws → 200 clean unreachable shape, never 500/leak", async () => {
  const app = makeApp(baseDeps({ loadSummary: async () => { throw new Error("boom"); } }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.unreachable, true);
  assert.equal(r.body.linked, true);
});

test("customer: summary + transactions forwarded onto the locked shape", async () => {
  const app = makeApp(baseDeps({
    loadSummary: async () => ({
      summary: { balance: { currencyCode: "USD" }, invoices: [{ id: 1 }] },
      transactions: [{ id: 9 }],
      transactionsUnreachable: true,
    }),
  }));
  const r = await get(app);
  assert.equal(r.status, 200);
  assert.equal(r.body.linked, true);
  assert.deepEqual(r.body.transactions, [{ id: 9 }]);
  assert.equal(r.body.transactionsUnreachable, true);
  assert.deepEqual(r.body.invoices, [{ id: 1 }]);
});
