import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { emptyBilling } from "./whmcs-admin-billing-route";

// Route-level test for the customer billing-summary endpoint:
//   GET /api/billing
//
// This is the inline customer summary route in routes.ts (it shares the locked
// `emptyBilling` shape with the admin billing handler). The route is scoped to
// the SESSION user's OWN linked WHMCS client; staff accounts never have one, so
// they are rejected server-side (defence-in-depth, Task #439) even if a UI gate
// is bypassed — matching the seamless pay-link routes. We mirror the route's
// staff/unconfigured/unlinked branches in a standalone express app (same pattern
// as server/whmcs-invoice-pdf-route.test.ts) with an injectable summary loader so
// we can prove WHMCS is never queried on the rejection path.

interface FakeDeps {
  configured: boolean;
  enabled: boolean;
  clientId: number | null;
  role?: string | null;
  loadSummary: () => Promise<Record<string, unknown>>;
}

const isStaffRole = (role: string | null | undefined): boolean =>
  role === "admin" || role === "master_admin";

function makeApp(deps: FakeDeps) {
  const app = express();
  app.get("/api/billing", async (_req, res) => {
    try {
      const { configured, enabled } = deps;
      if (!configured || !enabled) {
        return res.json(emptyBilling({ configured, enabled }));
      }
      if (isStaffRole(deps.role)) {
        return res.status(403).json(emptyBilling({ configured, enabled, linked: false }));
      }
      const clientId = deps.clientId;
      if (!clientId) {
        return res.json(emptyBilling({ configured, enabled, linked: false }));
      }
      const summary = await deps.loadSummary();
      return res.json({ configured, enabled, linked: true, ...summary });
    } catch {
      return res.json(emptyBilling({ configured: true, enabled: true, linked: true, unreachable: true }));
    }
  });
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
  loadSummary: async () => ({ summary: { balance: null } }),
  ...over,
});

test("customer: admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "admin", loadSummary: async () => { called = true; return {}; } }));
  const r = await get(app);
  assert.equal(r.status, 403, "staff accounts must be rejected from the customer billing summary");
  assert.equal(r.body.linked, false);
  assert.equal(called, false, "WHMCS must not be queried for a staff account");
});

test("customer: master_admin session → 403, WHMCS never queried", async () => {
  let called = false;
  const app = makeApp(baseDeps({ role: "master_admin", loadSummary: async () => { called = true; return {}; } }));
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
