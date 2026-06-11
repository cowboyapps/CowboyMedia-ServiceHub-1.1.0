import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import {
  buildAdminRoleInsert,
  buildAdminRolePatch,
  createAdminRoleHandlers,
  type AdminRoleStorage,
} from "./admin-roles";
import {
  createAdminRoleSchema,
  updateAdminRoleSchema,
  type AdminRole,
  type InsertAdminRole,
} from "../shared/schema";

const SAMPLE: AdminRole = {
  id: "role-1",
  name: "Tier 1",
  permissions: ["users.view"],
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

// ---------- Create schema ----------

test("createAdminRoleSchema: requires name", () => {
  assert.equal(createAdminRoleSchema.safeParse({}).success, false);
  assert.equal(createAdminRoleSchema.safeParse({ name: "" }).success, false);
  assert.equal(createAdminRoleSchema.safeParse({ name: "   " }).success, false);
});

test("createAdminRoleSchema: rejects oversize name", () => {
  assert.equal(
    createAdminRoleSchema.safeParse({ name: "x".repeat(121) }).success,
    false,
  );
});

test("createAdminRoleSchema: trims name", () => {
  const r = createAdminRoleSchema.safeParse({ name: "  Support  " });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.name, "Support");
});

test("createAdminRoleSchema: accepts a valid permission whitelist", () => {
  const r = createAdminRoleSchema.safeParse({
    name: "Ops",
    permissions: ["users.view", "services.manage", "support_tickets"],
  });
  assert.equal(r.success, true);
});

test("createAdminRoleSchema: rejects unknown permission keys", () => {
  const r = createAdminRoleSchema.safeParse({
    name: "Ops",
    permissions: ["users.view", "everything.evil"],
  });
  assert.equal(r.success, false);
});

test("createAdminRoleSchema: rejects non-array permissions", () => {
  assert.equal(
    createAdminRoleSchema.safeParse({ name: "X", permissions: "users.view" }).success,
    false,
  );
});

test("createAdminRoleSchema: rejects non-string name", () => {
  assert.equal(
    createAdminRoleSchema.safeParse({ name: 123 }).success,
    false,
  );
});

// ---------- Update schema ----------

test("updateAdminRoleSchema: accepts an empty payload", () => {
  assert.equal(updateAdminRoleSchema.safeParse({}).success, true);
});

test("updateAdminRoleSchema: accepts a complete valid payload", () => {
  const r = updateAdminRoleSchema.safeParse({
    name: "Renamed",
    permissions: ["news.view", "news.manage"],
  });
  assert.equal(r.success, true);
});

test("updateAdminRoleSchema: rejects empty/oversize name", () => {
  assert.equal(updateAdminRoleSchema.safeParse({ name: "" }).success, false);
  assert.equal(updateAdminRoleSchema.safeParse({ name: "   " }).success, false);
  assert.equal(
    updateAdminRoleSchema.safeParse({ name: "x".repeat(121) }).success,
    false,
  );
});

test("updateAdminRoleSchema: rejects unknown permission keys", () => {
  const r = updateAdminRoleSchema.safeParse({
    permissions: ["totally.fake"],
  });
  assert.equal(r.success, false);
});

// ---------- Builders ----------

test("buildAdminRoleInsert: defaults permissions to empty array", () => {
  assert.deepEqual(buildAdminRoleInsert({ name: "X" }), {
    name: "X",
    permissions: [],
  });
});

test("buildAdminRoleInsert: passes through provided permissions", () => {
  assert.deepEqual(
    buildAdminRoleInsert({ name: "X", permissions: ["users.view"] }),
    { name: "X", permissions: ["users.view"] },
  );
});

test("buildAdminRolePatch: only includes specified fields", () => {
  assert.deepEqual(buildAdminRolePatch({}), {});
  assert.deepEqual(buildAdminRolePatch({ name: "X" }), { name: "X" });
  assert.deepEqual(
    buildAdminRolePatch({ permissions: ["news.view"] }),
    { permissions: ["news.view"] },
  );
});

// ---------- Handler harness ----------

interface MockRes extends Response {
  body: any;
}
function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: undefined,
    status(n: number) { this.statusCode = n; return this; },
    json(b: any) { this.body = b; return this; },
  };
  return res as unknown as MockRes;
}

function mockStorage(opts: { found?: AdminRole | null } = {}) {
  const found = opts.found === undefined ? SAMPLE : opts.found;
  const state = {
    createCalls: [] as InsertAdminRole[],
    updateCalls: [] as { id: string; data: Partial<AdminRole> }[],
    deleteCalls: [] as string[],
  };
  const storage: AdminRoleStorage = {
    async createAdminRole(role) {
      state.createCalls.push(role);
      return {
        id: "new-id",
        createdAt: new Date("2025-02-02T00:00:00Z"),
        name: role.name,
        permissions: role.permissions ?? [],
      };
    },
    async updateAdminRole(id, data) {
      state.updateCalls.push({ id, data });
      if (!found) return undefined;
      return { ...found, ...data };
    },
    async deleteAdminRole(id) {
      state.deleteCalls.push(id);
    },
  };
  return { storage, state };
}

function makeReq(body: any, id = "role-1"): any {
  return { body, params: { id }, session: { userId: "admin-1" } };
}

// ---------- POST handler ----------

test("POST admin-roles: 400 when name is missing", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ permissions: [] }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid role");
  assert.equal(state.createCalls.length, 0);
});

test("POST admin-roles: 400 on oversize name", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "x".repeat(121) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.createCalls.length, 0);
});

test("POST admin-roles: 400 on unknown permission key", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(
    makeReq({ name: "X", permissions: ["users.view", "unknown.key"] }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(state.createCalls.length, 0);
});

test("POST admin-roles: persists a valid payload with default permissions", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "  Tier 1  " }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.createCalls.length, 1);
  assert.deepEqual(state.createCalls[0], { name: "Tier 1", permissions: [] });
  assert.equal(res.body.id, "new-id");
  assert.equal(res.body.name, "Tier 1");
});

test("POST admin-roles: persists permissions whitelist", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(
    makeReq({ name: "Ops", permissions: ["users.view", "services.manage"] }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.createCalls[0], {
    name: "Ops",
    permissions: ["users.view", "services.manage"],
  });
});

test("POST admin-roles: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "X", evil: "y" } as any), res);
  assert.equal(res.statusCode, 200);
  assert.equal((state.createCalls[0] as any).evil, undefined);
});

test("POST admin-roles: 500 when storage throws", async () => {
  const storage: AdminRoleStorage = {
    async createAdminRole() { throw new Error("db down"); },
    async updateAdminRole() { return undefined; },
    async deleteAdminRole() {},
  };
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

// ---------- PATCH handler ----------

test("PATCH admin-roles: 400 on empty name", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid role");
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH admin-roles: 400 on unknown permission key", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ permissions: ["bogus"] }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH admin-roles: persists a valid update", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(
    makeReq({ name: "Renamed", permissions: ["news.view"] }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0], {
    id: "role-1",
    data: { name: "Renamed", permissions: ["news.view"] },
  });
  assert.equal(res.body.name, "Renamed");
});

test("PATCH admin-roles: omits unspecified fields from storage call", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "Renamed" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { name: "Renamed" });
});

test("PATCH admin-roles: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X", evil: "y" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { name: "X" });
});

test("PATCH admin-roles: 404 when role not found", async () => {
  const { storage } = mockStorage({ found: null });
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X" }, "missing"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Role not found");
});

test("PATCH admin-roles: 500 when storage throws", async () => {
  const storage: AdminRoleStorage = {
    async createAdminRole() { throw new Error("nope"); },
    async updateAdminRole() { throw new Error("db down"); },
    async deleteAdminRole() {},
  };
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

// ---------- DELETE handler ----------

test("DELETE admin-roles: success returns { success: true } and forwards id", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.deleteAdmin(makeReq({}, "role-42"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(state.deleteCalls, ["role-42"]);
});

test("DELETE admin-roles: coerces non-string id param to string", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  const req: any = { body: {}, params: { id: 7 }, session: { userId: "admin-1" } };
  await handlers.deleteAdmin(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.deleteCalls, ["7"]);
});

test("DELETE admin-roles: idempotent when storage no-ops on missing role", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.deleteAdmin(makeReq({}, "missing"), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true });
  assert.deepEqual(state.deleteCalls, ["missing"]);
});

test("DELETE admin-roles: 400 when id param is missing", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  const req: any = { body: {}, params: {}, session: { userId: "admin-1" } };
  await handlers.deleteAdmin(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Missing role id");
  assert.equal(state.deleteCalls.length, 0);
});

test("DELETE admin-roles: 400 when id param is whitespace", async () => {
  const { storage, state } = mockStorage();
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.deleteAdmin(makeReq({}, "   "), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.deleteCalls.length, 0);
});

test("DELETE admin-roles: 500 when storage throws", async () => {
  const storage: AdminRoleStorage = {
    async createAdminRole() { throw new Error("nope"); },
    async updateAdminRole() { return undefined; },
    async deleteAdminRole() { throw new Error("role still assigned"); },
  };
  const handlers = createAdminRoleHandlers({ storage });
  const res = mockRes();
  await handlers.deleteAdmin(makeReq({}, "role-1"), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "role still assigned");
});
