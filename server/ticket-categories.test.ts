import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTicketCategoryPatch,
  createTicketCategoryHandlers,
  type TicketCategoryStorage,
} from "./ticket-categories";
import {
  updateTicketCategorySchema,
  type TicketCategory,
} from "../shared/schema";

const SAMPLE: TicketCategory = {
  id: "cat-1",
  name: "Billing",
  description: "Billing questions",
  assignedRoleIds: ["role-a"],
  firstResponseTargetMinutes: 60,
  resolutionTargetMinutes: 480,
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

// ---------- Schema ----------

test("updateTicketCategorySchema: accepts a complete valid payload", () => {
  const r = updateTicketCategorySchema.safeParse({
    name: "Support",
    description: "general questions",
    assignedRoleIds: ["a", "b"],
    firstResponseTargetMinutes: 30,
    resolutionTargetMinutes: 240,
  });
  assert.equal(r.success, true);
});

test("updateTicketCategorySchema: accepts an empty payload", () => {
  assert.equal(updateTicketCategorySchema.safeParse({}).success, true);
});

test("updateTicketCategorySchema: accepts null/empty SLA targets and normalizes to null", () => {
  const a = updateTicketCategorySchema.safeParse({ firstResponseTargetMinutes: null });
  const b = updateTicketCategorySchema.safeParse({ firstResponseTargetMinutes: "" });
  assert.equal(a.success, true);
  assert.equal(b.success, true);
  if (a.success) assert.equal(a.data.firstResponseTargetMinutes, null);
  if (b.success) assert.equal(b.data.firstResponseTargetMinutes, null);
});

test("updateTicketCategorySchema: parses numeric strings into integers", () => {
  const r = updateTicketCategorySchema.safeParse({ firstResponseTargetMinutes: "45" });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.firstResponseTargetMinutes, 45);
});

test("updateTicketCategorySchema: rejects non-numeric SLA strings", () => {
  for (const bad of ["abc", "-5", "10m", "1e3"]) {
    const r = updateTicketCategorySchema.safeParse({ firstResponseTargetMinutes: bad });
    assert.equal(r.success, false, `value "${bad}" should be rejected`);
  }
});

test("updateTicketCategorySchema: rejects non-positive numeric SLA targets", () => {
  assert.equal(
    updateTicketCategorySchema.safeParse({ resolutionTargetMinutes: 0 }).success,
    false,
  );
  assert.equal(
    updateTicketCategorySchema.safeParse({ resolutionTargetMinutes: -1 }).success,
    false,
  );
});

test("updateTicketCategorySchema: floors fractional numeric SLA targets", () => {
  // Non-integer numbers fail schema validation; the string variant floors.
  assert.equal(
    updateTicketCategorySchema.safeParse({ resolutionTargetMinutes: 1.5 }).success,
    false,
  );
  const r = updateTicketCategorySchema.safeParse({ resolutionTargetMinutes: "1.5" });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.resolutionTargetMinutes, 1);
});

test("updateTicketCategorySchema: rejects oversize SLA targets", () => {
  const r = updateTicketCategorySchema.safeParse({
    resolutionTargetMinutes: 60 * 24 * 365 + 1,
  });
  assert.equal(r.success, false);
});

test("updateTicketCategorySchema: rejects oversize SLA target as numeric string", () => {
  const r = updateTicketCategorySchema.safeParse({ resolutionTargetMinutes: "999999999" });
  assert.equal(r.success, false);
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
  assert.deepEqual(
    buildTicketCategoryPatch({ name: "X" }),
    { name: "X" },
  );
  assert.deepEqual(
    buildTicketCategoryPatch({ firstResponseTargetMinutes: null }),
    { firstResponseTargetMinutes: null },
  );
});

// ---------- Handler ----------

interface MockRes {
  statusCode: number;
  body: any;
  status: (n: number) => MockRes;
  json: (b: any) => MockRes;
}
function mockRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    body: undefined,
    status(n) { this.statusCode = n; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

function mockStorage(opts: { found?: TicketCategory | null } = {}) {
  const found = opts.found === undefined ? SAMPLE : opts.found;
  const state = { updateCalls: [] as { id: string; data: Partial<TicketCategory> }[] };
  const storage: TicketCategoryStorage = {
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

test("PATCH ticket-categories: 400 on schema-invalid SLA", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ firstResponseTargetMinutes: "abc" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid category");
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH ticket-categories: 400 on negative SLA", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ resolutionTargetMinutes: -5 }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH ticket-categories: persists numeric-string SLA as integer minutes", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ firstResponseTargetMinutes: "45" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0], {
    id: "cat-1",
    data: { firstResponseTargetMinutes: 45 },
  });
  assert.equal(res.body.firstResponseTargetMinutes, 45);
});

test("PATCH ticket-categories: clears SLA when given null", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ resolutionTargetMinutes: null }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { resolutionTargetMinutes: null });
});

test("PATCH ticket-categories: clears SLA when given empty string", async () => {
  const { storage, state } = mockStorage();
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ firstResponseTargetMinutes: "" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0].data, { firstResponseTargetMinutes: null });
});

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
    async updateTicketCategory() { throw new Error("db down"); },
  };
  const handlers = createTicketCategoryHandlers({ storage });
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ name: "X" }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});
