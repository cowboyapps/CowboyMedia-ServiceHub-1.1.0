import { test } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response } from "express";
import { createWhmcsLinkStatsHandler, type LinkStatsRouteDeps } from "./whmcs-link-stats-route";

// Route-level tests for the admin billing-link adoption READ:
//   GET /api/admin/whmcs/link-stats
//
// Exercises the PRODUCTION handler factory from server/whmcs-link-stats-route.ts
// (wired into routes.ts behind requireAdmin), not a copy.
//
// Contracts under test:
//   1. Locked shape when configured — { configured: true, stats: { linked,
//      dismissed, unlinked, total } } with total = sum of the three buckets.
//   2. Not configured (missing credentials OR missing/unusable base URL) —
//      { configured: false, stats: null } and the DB counter is NEVER hit.
//   3. DB failure surfaces as a 500 (no silent zeros masquerading as data).

function makeRes() {
  const out: { status: number; body: unknown } = { status: 200, body: undefined };
  const res = {
    status(code: number) { out.status = code; return res; },
    json(body: unknown) { out.body = body; return res; },
  } as unknown as Response;
  return { res, out };
}

function makeDeps(opts: {
  baseUrl?: string | null;
  hasCredentials?: boolean;
  stats?: { linked: number; dismissed: number; unlinked: number };
  statsError?: Error;
}) {
  let statsCalled = false;
  const deps: LinkStatsRouteDeps = {
    getWhmcsSettings: async () => ({ baseUrl: "baseUrl" in opts ? opts.baseUrl : "https://billing.example.com" }),
    getWhmcsLinkStats: async () => {
      statsCalled = true;
      if (opts.statsError) throw opts.statsError;
      return opts.stats ?? { linked: 0, dismissed: 0, unlinked: 0 };
    },
    hasWhmcsCredentials: () => opts.hasCredentials ?? true,
    normalizeBaseUrl: (url) => (url ? String(url) : null),
  };
  return { deps, statsCalled: () => statsCalled };
}

const req = {} as Request;

test("configured: returns locked shape with computed total", async () => {
  const { deps } = makeDeps({ stats: { linked: 7, dismissed: 3, unlinked: 12 } });
  const { res, out } = makeRes();
  await createWhmcsLinkStatsHandler(deps)(req, res);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, {
    configured: true,
    stats: { linked: 7, dismissed: 3, unlinked: 12, total: 22 },
  });
  assert.deepEqual(Object.keys(out.body as object).sort(), ["configured", "stats"]);
});

test("missing credentials: configured=false, stats=null, DB never queried", async () => {
  const { deps, statsCalled } = makeDeps({ hasCredentials: false });
  const { res, out } = makeRes();
  await createWhmcsLinkStatsHandler(deps)(req, res);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { configured: false, stats: null });
  assert.equal(statsCalled(), false);
});

test("missing base URL: configured=false, stats=null, DB never queried", async () => {
  const { deps, statsCalled } = makeDeps({ baseUrl: null });
  const { res, out } = makeRes();
  await createWhmcsLinkStatsHandler(deps)(req, res);
  assert.equal(out.status, 200);
  assert.deepEqual(out.body, { configured: false, stats: null });
  assert.equal(statsCalled(), false);
});

test("DB failure surfaces as 500, not silent zeros", async () => {
  const { deps } = makeDeps({ statsError: new Error("db down") });
  const { res, out } = makeRes();
  await createWhmcsLinkStatsHandler(deps)(req, res);
  assert.equal(out.status, 500);
  assert.deepEqual(out.body, { message: "db down" });
});
