import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import {
  createTelegramSettingsHandlers,
  normalizeTelegramPatch,
  type TelegramSettingsStorage,
} from "./telegram-settings";
import {
  updateTelegramSettingsSchema,
  type TelegramSettings,
  type UpdateTelegramSettingsData,
} from "../shared/schema";

const DEFAULT_TS: TelegramSettings = {
  id: "singleton",
  chatId: null,
  enabled: false,
  sendAlerts: true,
  sendServiceUpdates: true,
  sendNews: true,
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

// ---------- Schema ----------

test("updateTelegramSettingsSchema: accepts a complete valid payload", () => {
  const r = updateTelegramSettingsSchema.safeParse({
    chatId: "-100123",
    enabled: true,
    sendAlerts: false,
    sendServiceUpdates: true,
    sendNews: false,
  });
  assert.equal(r.success, true);
});

test("updateTelegramSettingsSchema: accepts an empty payload", () => {
  assert.equal(updateTelegramSettingsSchema.safeParse({}).success, true);
});

test("updateTelegramSettingsSchema: accepts null chatId and partial fields", () => {
  assert.equal(updateTelegramSettingsSchema.safeParse({ chatId: null }).success, true);
  assert.equal(updateTelegramSettingsSchema.safeParse({ enabled: true }).success, true);
  assert.equal(updateTelegramSettingsSchema.safeParse({ sendNews: false }).success, true);
});

test("updateTelegramSettingsSchema: rejects wrong types", () => {
  assert.equal(updateTelegramSettingsSchema.safeParse({ enabled: "yes" }).success, false);
  assert.equal(updateTelegramSettingsSchema.safeParse({ chatId: 123 }).success, false);
  assert.equal(updateTelegramSettingsSchema.safeParse({ sendAlerts: 1 }).success, false);
});

test("updateTelegramSettingsSchema: rejects oversize chatId", () => {
  const ok = updateTelegramSettingsSchema.safeParse({ chatId: "x".repeat(128) });
  const bad = updateTelegramSettingsSchema.safeParse({ chatId: "x".repeat(129) });
  assert.equal(ok.success, true);
  assert.equal(bad.success, false);
});

// ---------- Normalizer ----------

test("normalizeTelegramPatch: trims chatId and converts empty to null", () => {
  assert.deepEqual(normalizeTelegramPatch({ chatId: "  " }), { chatId: null });
  assert.deepEqual(normalizeTelegramPatch({ chatId: " 42 " }), { chatId: "42" });
  assert.deepEqual(normalizeTelegramPatch({ chatId: null }), { chatId: null });
});

test("normalizeTelegramPatch: omits unspecified fields", () => {
  assert.deepEqual(normalizeTelegramPatch({ enabled: true }), { enabled: true });
  assert.deepEqual(normalizeTelegramPatch({}), {});
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

function mockStorage(initial: TelegramSettings | undefined = DEFAULT_TS) {
  const state = { current: initial ? { ...initial } : undefined, updateCalls: [] as UpdateTelegramSettingsData[] };
  const storage: TelegramSettingsStorage = {
    async getTelegramSettings() { return state.current; },
    async updateTelegramSettings(data) {
      state.updateCalls.push(data);
      const base: TelegramSettings = state.current ?? { ...DEFAULT_TS };
      state.current = {
        ...base,
        ...(data.chatId !== undefined ? { chatId: data.chatId } : {}),
        ...(data.enabled !== undefined ? { enabled: data.enabled } : {}),
        ...(data.sendAlerts !== undefined ? { sendAlerts: data.sendAlerts } : {}),
        ...(data.sendServiceUpdates !== undefined ? { sendServiceUpdates: data.sendServiceUpdates } : {}),
        ...(data.sendNews !== undefined ? { sendNews: data.sendNews } : {}),
        updatedAt: new Date(),
      };
      return state.current;
    },
  };
  return { storage, state };
}

function makeReq(body: any, userId = "admin-1"): any {
  return { body, session: { userId } };
}

function build(storage: TelegramSettingsStorage) {
  const logCalls: any[] = [];
  const handlers = createTelegramSettingsHandlers({
    storage,
    logActivity: (cat, action, opts) => logCalls.push({ cat, action, opts }),
    hasToken: () => true,
  });
  return { handlers, logCalls };
}

test("PATCH telegram-settings: 400 on schema-invalid payload", async () => {
  const { storage, state } = mockStorage();
  const { handlers, logCalls } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: "nope" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid settings");
  assert.equal(state.updateCalls.length, 0);
  assert.equal(logCalls.length, 0);
});

test("PATCH telegram-settings: persists normalized chatId and logs", async () => {
  const { storage, state } = mockStorage();
  const { handlers, logCalls } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ chatId: "  -1001 ", enabled: true }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0], { chatId: "-1001", enabled: true });
  assert.equal(res.body.chatId, "-1001");
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.hasToken, true);
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].action, "telegram_settings_updated");
  assert.equal(logCalls[0].opts.actorId, "admin-1");
  assert.match(logCalls[0].opts.summary, /enabled.*-1001/);
});

test("PATCH telegram-settings: empty chatId becomes null", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ chatId: "" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { chatId: null });
  assert.equal(res.body.chatId, "");
});

test("PATCH telegram-settings: partial update only forwards specified fields", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ sendNews: false }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { sendNews: false });
  assert.equal(res.body.sendNews, false);
});

test("PATCH telegram-settings: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true, evil: "x" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { enabled: true });
});

test("PATCH telegram-settings: 500 when storage throws", async () => {
  const storage: TelegramSettingsStorage = {
    async getTelegramSettings() { throw new Error("db down"); },
    async updateTelegramSettings() { throw new Error("db down"); },
  };
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.message, "db down");
});

test("GET telegram-settings: returns shaped current settings", async () => {
  const { storage } = mockStorage({ ...DEFAULT_TS, chatId: "abc", enabled: true });
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.getAdmin({} as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.chatId, "abc");
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.hasToken, true);
});
