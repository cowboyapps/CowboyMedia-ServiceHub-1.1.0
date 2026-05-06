import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDiscordSettingsHandlers,
  maskWebhook,
  normalizeDiscordPatch,
  type DiscordSettingsStorage,
} from "./discord-settings";
import {
  updateDiscordSettingsSchema,
  type DiscordSettings,
} from "../shared/schema";

const DEFAULT_DS: DiscordSettings = {
  id: "singleton",
  webhookUrl: null,
  enabled: false,
  sendAlerts: true,
  sendServiceUpdates: true,
  sendNews: true,
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const VALID_HOOK = "https://discord.com/api/webhooks/123456789012345678/AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYzAbCdEfGhIj";

// ---------- Schema ----------

test("updateDiscordSettingsSchema: accepts a valid webhook + flags", () => {
  const r = updateDiscordSettingsSchema.safeParse({
    webhookUrl: VALID_HOOK,
    enabled: true,
    sendAlerts: false,
    sendServiceUpdates: true,
    sendNews: false,
  });
  assert.equal(r.success, true);
});

test("updateDiscordSettingsSchema: accepts an empty payload", () => {
  assert.equal(updateDiscordSettingsSchema.safeParse({}).success, true);
});

test("updateDiscordSettingsSchema: accepts null and empty-string webhookUrl", () => {
  assert.equal(updateDiscordSettingsSchema.safeParse({ webhookUrl: null }).success, true);
  assert.equal(updateDiscordSettingsSchema.safeParse({ webhookUrl: "" }).success, true);
});

test("updateDiscordSettingsSchema: rejects non-discord webhook URL", () => {
  for (const bad of [
    "http://discord.com/api/webhooks/abc",
    "https://evil.com/api/webhooks/abc",
    "https://discord.com/api/other/abc",
    "not-a-url",
  ]) {
    const r = updateDiscordSettingsSchema.safeParse({ webhookUrl: bad });
    assert.equal(r.success, false, `webhookUrl "${bad}" should be rejected`);
  }
});

test("updateDiscordSettingsSchema: accepts discordapp.com host", () => {
  const r = updateDiscordSettingsSchema.safeParse({
    webhookUrl: "https://discordapp.com/api/webhooks/1/token",
  });
  assert.equal(r.success, true);
});

test("updateDiscordSettingsSchema: rejects oversize webhookUrl", () => {
  const r = updateDiscordSettingsSchema.safeParse({
    webhookUrl: "https://discord.com/api/webhooks/" + "x".repeat(600),
  });
  assert.equal(r.success, false);
});

test("updateDiscordSettingsSchema: rejects wrong types for flags", () => {
  assert.equal(updateDiscordSettingsSchema.safeParse({ enabled: 1 }).success, false);
  assert.equal(updateDiscordSettingsSchema.safeParse({ sendAlerts: "yes" }).success, false);
});

// ---------- Helpers ----------

test("maskWebhook: returns empty string for null/empty", () => {
  assert.equal(maskWebhook(null), "");
  assert.equal(maskWebhook(undefined), "");
  assert.equal(maskWebhook(""), "");
});

test("maskWebhook: only exposes origin and last 4 chars of token", () => {
  const masked = maskWebhook(VALID_HOOK);
  assert.match(masked, /^https:\/\/discord\.com\/…\/••••/);
  assert.ok(!masked.includes("AbCd"), "should not leak start of token");
  assert.ok(masked.endsWith(VALID_HOOK.slice(-4)));
});

test("normalizeDiscordPatch: trims webhookUrl and maps blank to null", () => {
  assert.deepEqual(normalizeDiscordPatch({ webhookUrl: "" }), { webhookUrl: null });
  assert.deepEqual(normalizeDiscordPatch({ webhookUrl: null }), { webhookUrl: null });
  assert.deepEqual(
    normalizeDiscordPatch({ webhookUrl: `  ${VALID_HOOK}  ` }),
    { webhookUrl: VALID_HOOK },
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

function mockStorage(initial: DiscordSettings | undefined = DEFAULT_DS) {
  const state = { current: initial ? { ...initial } : undefined, updateCalls: [] as any[] };
  const storage: DiscordSettingsStorage = {
    async getDiscordSettings() { return state.current; },
    async updateDiscordSettings(data) {
      state.updateCalls.push(data);
      const base: DiscordSettings = state.current ?? { ...DEFAULT_DS };
      state.current = {
        ...base,
        ...(data.webhookUrl !== undefined ? { webhookUrl: data.webhookUrl } : {}),
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

function build(storage: DiscordSettingsStorage) {
  const logCalls: any[] = [];
  const handlers = createDiscordSettingsHandlers({
    storage,
    logActivity: (cat, action, opts) => logCalls.push({ cat, action, opts }),
  });
  return { handlers, logCalls };
}

test("PATCH discord-settings: 400 with helpful message on bad webhook", async () => {
  const { storage, state } = mockStorage();
  const { handlers, logCalls } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ webhookUrl: "https://evil.com/api/webhooks/x" }), res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /Webhook URL must start with/);
  assert.equal(state.updateCalls.length, 0);
  assert.equal(logCalls.length, 0);
});

test("PATCH discord-settings: 400 on schema-invalid flag", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: "yes" }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.message, "Invalid settings");
  assert.equal(state.updateCalls.length, 0);
});

test("PATCH discord-settings: persists trimmed webhook + flags and logs", async () => {
  const { storage, state } = mockStorage();
  const { handlers, logCalls } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(
    makeReq({ webhookUrl: `  ${VALID_HOOK}  `, enabled: true, sendAlerts: false }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(state.updateCalls.length, 1);
  assert.deepEqual(state.updateCalls[0], {
    webhookUrl: VALID_HOOK,
    enabled: true,
    sendAlerts: false,
  });
  assert.equal(res.body.hasWebhook, true);
  assert.equal(res.body.enabled, true);
  assert.equal(res.body.sendAlerts, false);
  assert.ok(res.body.webhookUrlMasked.startsWith("https://discord.com/…/"));
  assert.ok(!res.body.webhookUrlMasked.includes("AbCd"), "must not leak token");
  assert.equal(logCalls.length, 1);
  assert.equal(logCalls[0].action, "discord_settings_updated");
  assert.equal(logCalls[0].opts.actorId, "admin-1");
});

test("PATCH discord-settings: empty webhookUrl clears it", async () => {
  const { storage, state } = mockStorage({ ...DEFAULT_DS, webhookUrl: VALID_HOOK });
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ webhookUrl: "" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { webhookUrl: null });
  assert.equal(res.body.hasWebhook, false);
  assert.equal(res.body.webhookUrlMasked, "");
});

test("PATCH discord-settings: partial flag-only update", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ sendNews: false }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { sendNews: false });
});

test("PATCH discord-settings: strips unknown fields", async () => {
  const { storage, state } = mockStorage();
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true, evil: "x" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(state.updateCalls[0], { enabled: true });
});

test("PATCH discord-settings: 500 when storage throws", async () => {
  const storage: DiscordSettingsStorage = {
    async getDiscordSettings() { throw new Error("db down"); },
    async updateDiscordSettings() { throw new Error("db down"); },
  };
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.patchAdmin(makeReq({ enabled: true }), res);
  assert.equal(res.statusCode, 500);
});

test("GET discord-settings: never exposes raw webhookUrl", async () => {
  const { storage } = mockStorage({ ...DEFAULT_DS, webhookUrl: VALID_HOOK, enabled: true });
  const { handlers } = build(storage);
  const res = mockRes();
  await handlers.getAdmin({} as any, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasWebhook, true);
  assert.ok(!("webhookUrl" in res.body));
  assert.ok(!res.body.webhookUrlMasked.includes("AbCd"));
});
