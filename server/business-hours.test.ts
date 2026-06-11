import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import {
  createBusinessHoursHandlers,
  type BusinessHoursStorage,
} from "./business-hours";
import { updateBusinessHoursSchema, type BusinessHours, type UpdateBusinessHoursData } from "../shared/schema";

const DEFAULT_BH: BusinessHours = {
  id: "singleton",
  enabled: true,
  daysOfWeek: [1, 2, 3, 4, 5],
  startTime: "09:00",
  endTime: "17:00",
  timezone: "America/New_York",
  afterHoursMessage: "We are closed.",
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

// ---------- Schema tests ----------

test("updateBusinessHoursSchema: accepts a complete valid payload", () => {
  const r = updateBusinessHoursSchema.safeParse({
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "09:00",
    endTime: "17:30",
    timezone: "America/New_York",
    afterHoursMessage: "Closed",
  });
  assert.equal(r.success, true);
});

test("updateBusinessHoursSchema: accepts an empty (fully partial) payload", () => {
  const r = updateBusinessHoursSchema.safeParse({});
  assert.equal(r.success, true);
});

test("updateBusinessHoursSchema: accepts partial updates with a single field", () => {
  const r1 = updateBusinessHoursSchema.safeParse({ enabled: false });
  const r2 = updateBusinessHoursSchema.safeParse({ startTime: "08:30" });
  const r3 = updateBusinessHoursSchema.safeParse({ daysOfWeek: [0, 6] });
  assert.equal(r1.success, true);
  assert.equal(r2.success, true);
  assert.equal(r3.success, true);
});

test("updateBusinessHoursSchema: rejects malformed HH:MM startTime/endTime", () => {
  for (const bad of ["9:00", "09:0", "25:00", "12:60", "abc", "", "09-00", "09:00:00"]) {
    const r = updateBusinessHoursSchema.safeParse({ startTime: bad });
    assert.equal(r.success, false, `startTime "${bad}" should be rejected`);
  }
  const r = updateBusinessHoursSchema.safeParse({ endTime: "24:00" });
  assert.equal(r.success, false);
});

test("updateBusinessHoursSchema: accepts boundary HH:MM values", () => {
  for (const ok of ["00:00", "09:00", "23:59"]) {
    const r = updateBusinessHoursSchema.safeParse({ startTime: ok });
    assert.equal(r.success, true, `startTime "${ok}" should be accepted`);
  }
});

test("updateBusinessHoursSchema: rejects out-of-range daysOfWeek", () => {
  const negative = updateBusinessHoursSchema.safeParse({ daysOfWeek: [-1, 0] });
  const tooHigh = updateBusinessHoursSchema.safeParse({ daysOfWeek: [0, 7] });
  const nonInt = updateBusinessHoursSchema.safeParse({ daysOfWeek: [1.5, 2] });
  const tooMany = updateBusinessHoursSchema.safeParse({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6, 0] });
  assert.equal(negative.success, false);
  assert.equal(tooHigh.success, false);
  assert.equal(nonInt.success, false);
  assert.equal(tooMany.success, false);
});

test("updateBusinessHoursSchema: accepts empty daysOfWeek and full week", () => {
  const empty = updateBusinessHoursSchema.safeParse({ daysOfWeek: [] });
  const full = updateBusinessHoursSchema.safeParse({ daysOfWeek: [0, 1, 2, 3, 4, 5, 6] });
  assert.equal(empty.success, true);
  assert.equal(full.success, true);
});

test("updateBusinessHoursSchema: rejects oversize afterHoursMessage", () => {
  const ok = updateBusinessHoursSchema.safeParse({ afterHoursMessage: "x".repeat(2000) });
  const bad = updateBusinessHoursSchema.safeParse({ afterHoursMessage: "x".repeat(2001) });
  assert.equal(ok.success, true);
  assert.equal(bad.success, false);
});

test("updateBusinessHoursSchema: rejects empty/oversize timezone", () => {
  const empty = updateBusinessHoursSchema.safeParse({ timezone: "" });
  const tooLong = updateBusinessHoursSchema.safeParse({ timezone: "x".repeat(65) });
  assert.equal(empty.success, false);
  assert.equal(tooLong.success, false);
});

// ---------- Route handler tests ----------

type MockRes = Response & {
  body: any;
  headers: Record<string, string>;
};

function mockRes(): MockRes {
  const res = {
    statusCode: 200,
    body: undefined as any,
    headers: {} as Record<string, string>,
    status(n: number) { this.statusCode = n; return this; },
    json(b: any) { this.body = b; return this; },
    set(k: string, v: string) { this.headers[k] = v; return this; },
  };
  return res as unknown as MockRes;
}

function mockStorage(initial: BusinessHours = DEFAULT_BH): BusinessHoursStorage & {
  getCalls: number;
  updateCalls: UpdateBusinessHoursData[];
  current: BusinessHours;
} {
  return {
    current: { ...initial },
    getCalls: 0,
    updateCalls: [],
    async getBusinessHours() { this.getCalls++; return this.current; },
    async updateBusinessHours(data) {
      this.updateCalls.push(data);
      this.current = {
        ...this.current,
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.daysOfWeek !== undefined ? { daysOfWeek: data.daysOfWeek } : {}),
        ...(data.startTime !== undefined ? { startTime: data.startTime } : {}),
        ...(data.endTime !== undefined ? { endTime: data.endTime } : {}),
        ...(data.timezone !== undefined ? { timezone: data.timezone } : {}),
        ...(data.afterHoursMessage !== undefined ? { afterHoursMessage: data.afterHoursMessage } : {}),
        updatedAt: new Date(),
      };
      return this.current;
    },
  };
}

function makeReq(body: any, userId: string = "admin-1"): any {
  return { body, session: { userId } };
}

function makeHandlers(storage: BusinessHoursStorage) {
  const logCalls: any[] = [];
  const handlers = createBusinessHoursHandlers({
    storage,
    logActivity: (cat, action, opts) => logCalls.push({ cat, action, opts }),
  });
  return { handlers, logCalls };
}

test("PATCH /api/admin/business-hours: 400 when payload fails schema validation", async () => {
  const storage = mockStorage();
  const { handlers, logCalls } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ startTime: "9:00" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid settings");
  assert.ok(res.body.errors);
  assert.equal(storage.updateCalls.length, 0);
  assert.equal(logCalls.length, 0);
});

test("PATCH /api/admin/business-hours: 400 on out-of-range daysOfWeek", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ daysOfWeek: [7] }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(storage.updateCalls.length, 0);
});

test("PATCH /api/admin/business-hours: 400 on oversize afterHoursMessage", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ afterHoursMessage: "x".repeat(2001) }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(storage.updateCalls.length, 0);
});

test("PATCH /api/admin/business-hours: 400 on unknown timezone", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ timezone: "Mars/Olympus" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Unknown timezone/);
  assert.equal(storage.updateCalls.length, 0);
});

test("PATCH /api/admin/business-hours: 400 when start >= end (full pair)", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ startTime: "17:00", endTime: "09:00" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Open time/);
  assert.equal(storage.updateCalls.length, 0);
});

test("PATCH /api/admin/business-hours: 400 when partial update makes effective start >= end", async () => {
  // Stored end is 17:00; setting only startTime to 18:00 must be rejected.
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ startTime: "18:00" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(storage.updateCalls.length, 0);
});

test("PATCH /api/admin/business-hours: persists a valid full payload and returns the updated shape", async () => {
  const storage = mockStorage();
  const { handlers, logCalls } = makeHandlers(storage);
  const res = mockRes();
  const payload = {
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startTime: "08:00",
    endTime: "16:00",
    timezone: "America/Los_Angeles",
    afterHoursMessage: "Back at 8 AM PT.",
  };
  await handlers.patchAdmin(makeReq(payload), res);
  assert.equal(res.statusCode, 200);
  assert.equal(storage.updateCalls.length, 1);
  // Storage receives exactly the validated payload (no extra keys).
  assert.deepEqual(storage.updateCalls[0], payload);
  // Response echoes the updated values plus computed status fields.
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.startTime, "08:00");
  assert.equal(res.body.endTime, "16:00");
  assert.equal(res.body.timezone, "America/Los_Angeles");
  assert.equal(res.body.afterHoursMessage, "Back at 8 AM PT.");
  assert.deepEqual(res.body.daysOfWeek, [1, 2, 3, 4, 5]);
  assert.ok("isOpen" in res.body);
  assert.ok("nextOpenAt" in res.body);
  // Activity log is recorded with the actor id.
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].cat, "system");
  assert.equal(logCalls[0].action, "business_hours_updated");
  assert.equal(logCalls[0].opts.actorId, "admin-1");
});

test("PATCH /api/admin/business-hours: partial update only forwards specified fields to storage", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: false }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(storage.updateCalls.length, 1);
  assert.deepEqual(storage.updateCalls[0], { enabled: false });
  // Unchanged fields are still echoed in the response from current state.
  assert.equal(res.body.startTime, "09:00");
  assert.equal(res.body.endTime, "17:00");
  assert.equal(res.body.enabled, false);
});

test("PATCH /api/admin/business-hours: ignores extra unknown fields (zod strips them)", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true, hackerField: "evil" }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(storage.updateCalls.length, 1);
  assert.deepEqual(storage.updateCalls[0], { enabled: true });
});

test("PATCH /api/admin/business-hours: 500 when storage throws", async () => {
  const storage: BusinessHoursStorage = {
    async getBusinessHours() { throw new Error("db down"); },
    async updateBusinessHours() { throw new Error("unused"); },
  };
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

test("PATCH /api/admin/business-hours: handles missing body gracefully", async () => {
  const storage = mockStorage();
  const { handlers } = makeHandlers(storage);
  const res = mockRes();
  // An empty body parses fine and triggers no storage update beyond the read.
  await handlers.patchAdmin({ body: undefined, session: { userId: "u" } } as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(storage.updateCalls.length, 1);
  assert.deepEqual(storage.updateCalls[0], {});
});
