import { test } from "node:test";
import assert from "node:assert/strict";
import {
  requireAuth,
  createRequireAdmin,
  createRequireMasterAdmin,
  type AccessGuardDeps,
  type AccessGuardUser,
} from "./require-permission";

// Exercises the REAL production access guards (server/require-permission.ts),
// the same factories routes.ts mounts in front of auth/admin/master-admin
// routes. Each guard is the sibling of requirePermission: requireAuth only
// checks for a session, requireAdmin allows admin + master_admin, and
// requireMasterAdmin allows master_admin only. Route tests used to hand-
// replicate these checks; now they (and this file) assert the one real
// implementation.

function makeDeps(
  users: Record<string, AccessGuardUser | undefined>,
): AccessGuardDeps {
  return {
    async getUser(id) {
      return users[id];
    },
  };
}

type Res = { statusCode: number; body: any; status: (n: number) => Res; json: (b: any) => Res };
function makeRes(): Res {
  const r: any = {
    statusCode: 200,
    body: undefined,
    status(n: number) { r.statusCode = n; return r; },
    json(b: any) { r.body = b; return r; },
  };
  return r;
}

function makeReq(userId?: string | null): any {
  return {
    session: userId ? { userId } : {},
    method: "GET",
  };
}

async function callGuard(
  guard: (req: any, res: any, next: () => void) => unknown,
  req: any,
): Promise<{ status: number; body: any; nextCalled: boolean }> {
  const res = makeRes();
  let nextCalled = false;
  await guard(req, res as any, () => { nextCalled = true; });
  return { status: res.statusCode, body: res.body, nextCalled };
}

// --- requireAuth -----------------------------------------------------------

test("requireAuth: 401 when unauthenticated (no session userId)", async () => {
  const r = await callGuard(requireAuth, makeReq(null));
  assert.equal(r.status, 401);
  assert.equal(r.body.message, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

test("requireAuth: passes through for any authenticated session", async () => {
  const r = await callGuard(requireAuth, makeReq("anyone"));
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

// --- requireAdmin ----------------------------------------------------------

test("requireAdmin: 401 when unauthenticated", async () => {
  const guard = createRequireAdmin(makeDeps({}));
  const r = await callGuard(guard, makeReq(null));
  assert.equal(r.status, 401);
  assert.equal(r.body.message, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

test("requireAdmin: 403 for a customer role", async () => {
  const guard = createRequireAdmin(makeDeps({ cust: { role: "customer" } }));
  const r = await callGuard(guard, makeReq("cust"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("requireAdmin: 403 when the session user is missing", async () => {
  const guard = createRequireAdmin(makeDeps({}));
  const r = await callGuard(guard, makeReq("ghost"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("requireAdmin: passes for an admin", async () => {
  const guard = createRequireAdmin(makeDeps({ a: { role: "admin" } }));
  const r = await callGuard(guard, makeReq("a"));
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

test("requireAdmin: passes for a master_admin", async () => {
  const guard = createRequireAdmin(makeDeps({ boss: { role: "master_admin" } }));
  const r = await callGuard(guard, makeReq("boss"));
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

// --- requireMasterAdmin ----------------------------------------------------

test("requireMasterAdmin: 401 when unauthenticated", async () => {
  const guard = createRequireMasterAdmin(makeDeps({}));
  const r = await callGuard(guard, makeReq(null));
  assert.equal(r.status, 401);
  assert.equal(r.body.message, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

test("requireMasterAdmin: 403 for a customer role", async () => {
  const guard = createRequireMasterAdmin(makeDeps({ cust: { role: "customer" } }));
  const r = await callGuard(guard, makeReq("cust"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("requireMasterAdmin: 403 for a plain admin (not master)", async () => {
  const guard = createRequireMasterAdmin(makeDeps({ a: { role: "admin" } }));
  const r = await callGuard(guard, makeReq("a"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("requireMasterAdmin: 403 when the session user is missing", async () => {
  const guard = createRequireMasterAdmin(makeDeps({}));
  const r = await callGuard(guard, makeReq("ghost"));
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("requireMasterAdmin: passes for a master_admin", async () => {
  const guard = createRequireMasterAdmin(makeDeps({ boss: { role: "master_admin" } }));
  const r = await callGuard(guard, makeReq("boss"));
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});
