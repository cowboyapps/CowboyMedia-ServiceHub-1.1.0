import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createRequirePermission,
  type RequirePermissionDeps,
  type RequirePermissionUser,
  type RequirePermissionRole,
} from "./require-permission";

// Exercises the REAL production permission gate (server/require-permission.ts),
// the same factory routes.ts mounts in front of every admin route. The crux
// under test is the isWrite → managePerm selection: a write method (POST/PATCH/
// PUT/DELETE) requires the MANAGE permission, while a read (GET) only needs the
// VIEW permission. Route tests used to hand-replicate this logic; now they (and
// this file) assert the one real implementation.

function makeDeps(
  users: Record<string, RequirePermissionUser | undefined>,
  rolePerms: Record<string, string[] | undefined>,
): RequirePermissionDeps {
  return {
    async getUser(id) {
      return users[id];
    },
    async getAdminRole(id) {
      const perms = rolePerms[id];
      if (perms === undefined) return undefined;
      const role: RequirePermissionRole = { permissions: perms };
      return role;
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

interface RunOpts {
  userId?: string | null;
  method?: string;
  viewPerm?: string;
  managePerm?: string;
  users?: Record<string, RequirePermissionUser | undefined>;
  rolePerms?: Record<string, string[] | undefined>;
}

async function run(opts: RunOpts): Promise<{ status: number; body: any; nextCalled: boolean }> {
  const requirePermission = createRequirePermission(makeDeps(opts.users ?? {}, opts.rolePerms ?? {}));
  const handler = requirePermission(opts.viewPerm ?? "users.view", opts.managePerm);
  const req: any = {
    session: opts.userId ? { userId: opts.userId } : {},
    method: opts.method ?? "GET",
  };
  const res = makeRes();
  let nextCalled = false;
  await handler(req, res as any, () => { nextCalled = true; });
  return { status: res.statusCode, body: res.body, nextCalled };
}

test("401 when unauthenticated (no session userId)", async () => {
  const r = await run({ userId: null });
  assert.equal(r.status, 401);
  assert.equal(r.body.message, "Unauthorized");
  assert.equal(r.nextCalled, false);
});

test("403 for a non-admin (customer) role", async () => {
  const r = await run({
    userId: "cust",
    users: { cust: { role: "customer", adminRoleId: null } },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Forbidden");
  assert.equal(r.nextCalled, false);
});

test("403 'No admin role assigned' for an admin with no adminRoleId", async () => {
  const r = await run({
    userId: "admin",
    users: { admin: { role: "admin", adminRoleId: null } },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "No admin role assigned");
  assert.equal(r.nextCalled, false);
});

test("403 'Insufficient permissions' for an admin whose role lacks the perm", async () => {
  const r = await run({
    userId: "admin",
    viewPerm: "users.view",
    users: { admin: { role: "admin", adminRoleId: "role-x" } },
    rolePerms: { "role-x": ["other.view"] },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Insufficient permissions");
  assert.equal(r.nextCalled, false);
});

test("403 when the admin's role id resolves to no role", async () => {
  const r = await run({
    userId: "admin",
    users: { admin: { role: "admin", adminRoleId: "ghost" } },
    rolePerms: {},
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Insufficient permissions");
  assert.equal(r.nextCalled, false);
});

test("GET (read) passes with only the VIEW permission", async () => {
  const r = await run({
    userId: "admin",
    method: "GET",
    viewPerm: "users.view",
    managePerm: "users.manage",
    users: { admin: { role: "admin", adminRoleId: "role-view" } },
    rolePerms: { "role-view": ["users.view"] },
  });
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

test("POST (write) requires the MANAGE permission — view-only admin is rejected", async () => {
  const r = await run({
    userId: "admin",
    method: "POST",
    viewPerm: "users.view",
    managePerm: "users.manage",
    users: { admin: { role: "admin", adminRoleId: "role-view" } },
    rolePerms: { "role-view": ["users.view"] },
  });
  assert.equal(r.status, 403);
  assert.equal(r.body.message, "Insufficient permissions");
  assert.equal(r.nextCalled, false);
});

test("POST (write) passes for an admin with the MANAGE permission", async () => {
  const r = await run({
    userId: "admin",
    method: "POST",
    viewPerm: "users.view",
    managePerm: "users.manage",
    users: { admin: { role: "admin", adminRoleId: "role-manage" } },
    rolePerms: { "role-manage": ["users.view", "users.manage"] },
  });
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

test("write methods PATCH/PUT/DELETE also require the MANAGE permission", async () => {
  for (const method of ["PATCH", "PUT", "DELETE"]) {
    const r = await run({
      userId: "admin",
      method,
      viewPerm: "users.view",
      managePerm: "users.manage",
      users: { admin: { role: "admin", adminRoleId: "role-view" } },
      rolePerms: { "role-view": ["users.view"] },
    });
    assert.equal(r.status, 403, `${method} should require manage perm`);
    assert.equal(r.nextCalled, false, `${method} must not pass with view-only`);
  }
});

test("a write falls back to the VIEW perm when no managePerm is configured", async () => {
  const r = await run({
    userId: "admin",
    method: "POST",
    viewPerm: "users.view",
    managePerm: undefined,
    users: { admin: { role: "admin", adminRoleId: "role-view" } },
    rolePerms: { "role-view": ["users.view"] },
  });
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});

test("master_admin bypasses the per-permission check (even on a write, no role)", async () => {
  const r = await run({
    userId: "boss",
    method: "POST",
    viewPerm: "users.view",
    managePerm: "users.manage",
    users: { boss: { role: "master_admin", adminRoleId: null } },
    rolePerms: {},
  });
  assert.equal(r.nextCalled, true);
  assert.equal(r.status, 200);
});
