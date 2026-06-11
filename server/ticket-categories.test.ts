import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import {
  buildTicketCategoryInsert,
  buildTicketCategoryPatch,
  createTicketCategoryHandlers,
  type TicketCategoryStorage,
} from "./ticket-categories";
import {
  createTicketCategorySchema,
  updateTicketCategorySchema,
  type InsertTicketCategory,
  type TicketCategory,
} from "../shared/schema";

const SAMPLE: TicketCategory = {
  id: "cat-1",
  name: "Billing",
  description: "Billing questions",
  assignedRoleIds: ["role-a"],
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

// ---------- Update schema ----------

test("updateTicketCategorySchema: accepts a complete valid payload", () => {
  const r = updateTicketCategorySchema.safeParse({
    name: "Support",
    description: "general questions",
    assignedRoleIds: ["a", "b"],
  });
  assert.equal(r.success, true);
});

test("updateTicketCategorySchema: accepts an empty payload", () => {
  assert.equal(updateTicketCategorySchema.safeParse({}).success, true);
});

test("updateTicketCategorySchema: rejects empty/oversize name", () => {
  assert.equal(updateTicketCategorySchema.safeParse({ name: "" }).success, false);
  assert.equal(updateTicketCategorySchema.safeParse({ name: "   " }).success, false);
  assert.equal(
    updateTicketCategorySchema.safeParse({ name: "x".repeat(121) }).success,
    false,
  );
});

test("updateTicketCategorySchema: rejects oversize description and oversize assignedRoleIds", () => {
  assert.equal(
    updateTicketCategorySchema.safeParse({ description: "x".repeat(2001) }).success,
    false,
  );
  assert.equal(
    updateTicketCategorySchema.safeParse({ assignedRoleIds: Array(65).fill("r") }).success,
    false,
  );
});

test("updateTicketCategorySchema: accepts null description", () => {
  assert.equal(
    updateTicketCategorySchema.safeParse({ description: null }).success,
    true,
  );
});

// ---------- Patch builder ----------

test("buildTicketCategoryPatch: only includes specified fields", () => {
  assert.deepEqual(buildTicketCategoryPatch({}), {});
  assert.deepEqual(buildTicketCategoryPatch({ name: "X" }), { name: "X" });
  assert.deepEqual(
    buildTicketCategoryPatch({ description: null }),
    { description: null },
  );
});

// ---------- Handler ----------

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

function mockStorage(opts: { found?: TicketCategory | null } = {}) {
  const found = opts.found === undefined ? SAMPLE : opts.found;
  const state = {
    updateCalls: [] as { id: string; data: Partial<TicketCategory> }[],
    createCalls: [] as InsertTicketCategory[],
  };
  const storage: TicketCategoryStorage = {
    async createTicketCategory(cat) {
      state.createCalls.push(cat);
      return {
        id: "new-id",
        createdAt: new Date("2025-02-02T00:00:00Z"),
        name: cat.name,
        description: cat.description ?? null,
        assignedRoleIds: cat.assignedRoleIds ?? [],
      };
    },
    async updateTicketCategory(id, data) {
      state.updateCalls.push({ id, data });
      if (!found) return undefined;
      return { ...found, ...data };
    },
  };
  return { storage, state };
}

function makeReq(body: any, id = "cat-1"): any {
  return { body, params: { id }, session: { userId: "admin-1" } };
}

test("PATCH ticket-categories: omits unspecified fields from storage call", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "Renamed" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { name: "Renamed" });
});

test("PATCH ticket-categories: trims name", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "  Trimmed  " }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { name: "Trimmed" });
});

test("PATCH ticket-categories: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X", evil: "y" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { name: "X" });
});

test("PATCH ticket-categories: 404 when category not found", async () => {
  const { storage } = mockStorage({ found: null });
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X" }, "missing"), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.message, "Category not found");
});

test("PATCH ticket-categories: 500 when storage throws", async () => {
  const storage: TicketCategoryStorage = {
    async createTicketCategory() { throw new Error("not used"); },
    async updateTicketCategory() { throw new Error("db down"); },
  };
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

// ---------- Create schema ----------

test("createTicketCategorySchema: requires name", () => {
  assert.equal(createTicketCategorySchema.safeParse({}).success, false);
  assert.equal(createTicketCategorySchema.safeParse({ name: "" }).success, false);
  assert.equal(createTicketCategorySchema.safeParse({ name: "   " }).success, false);
  assert.equal(
    createTicketCategorySchema.safeParse({ name: "x".repeat(121) }).success,
    false,
  );
});

test("createTicketCategorySchema: accepts a minimal payload", () => {
  const r = createTicketCategorySchema.safeParse({ name: "Billing" });
  assert.equal(r.success, true);
});

test("createTicketCategorySchema: accepts a complete payload and trims name", () => {
  const r = createTicketCategorySchema.safeParse({
    name: "  Support  ",
    description: "general",
    assignedRoleIds: ["a", "b"],
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.name, "Support");
});

test("createTicketCategorySchema: rejects oversize description and assignedRoleIds", () => {
  assert.equal(
    createTicketCategorySchema.safeParse({ name: "X", description: "x".repeat(2001) }).success,
    false,
  );
  assert.equal(
    createTicketCategorySchema.safeParse({ name: "X", assignedRoleIds: Array(65).fill("r") }).success,
    false,
  );
});

// ---------- Insert builder ----------

test("buildTicketCategoryInsert: fills defaults for omitted fields", () => {
  assert.deepEqual(buildTicketCategoryInsert({ name: "X" }), {
    name: "X",
    description: null,
    assignedRoleIds: [],
  });
});

test("buildTicketCategoryInsert: passes through provided fields", () => {
  assert.deepEqual(
    buildTicketCategoryInsert({
      name: "X",
      description: "d",
      assignedRoleIds: ["r"],
    }),
    {
      name: "X",
      description: "d",
      assignedRoleIds: ["r"],
    },
  );
});

// ---------- POST handler ----------

test("POST ticket-categories: 400 when name is missing", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ description: "no name" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid category");
  assert.equal(state.createCalls.length, 0);
});

test("POST ticket-categories: 400 when name is blank", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "   " }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.createCalls.length, 0);
});

test("POST ticket-categories: 400 on oversize description", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(
    makeReq({ name: "X", description: "x".repeat(2001) }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(state.createCalls.length, 0);
});

test("POST ticket-categories: 400 on oversize name", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "x".repeat(121) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.createCalls.length, 0);
});

test("POST ticket-categories: persists a valid payload with defaults", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "  Billing  " }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.createCalls.length, 1);
  assert.deepEqual(state.createCalls[0], {
    name: "Billing",
    description: null,
    assignedRoleIds: [],
  });
  assert.equal(res.body.id, "new-id");
  assert.equal(res.body.name, "Billing");
});

test("POST ticket-categories: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "X", evil: "y" } as any), res);
  assert.equal(res.statusCode, 200);
  assert.equal((state.createCalls[0] as any).evil, undefined);
});

test("POST ticket-categories: 500 when storage throws", async () => {
  const storage: TicketCategoryStorage = {
    async createTicketCategory() { throw new Error("db down"); },
    async updateTicketCategory() { return undefined; },
  };
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.postAdmin(makeReq({ name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});
