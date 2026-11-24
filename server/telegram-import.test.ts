import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { TelegramImporter } from "./telegram-import";
import { encryptTelegramSession, decryptTelegramSession } from "./telegram-import-security";
import type { ImportSettings, TelegramImportStore } from "./telegram-import-store";
import type { ImportedTelegramPost, TelegramImportTransport } from "./telegram-import-transport";
import { pool } from "./db";

after(async () => { await pool.end(); });

test("importer baselines new sources, resumes from its cursor, blocks loops and keeps sessions out of status", async () => {
  // Only this isolated test subprocess sees this randomly generated test key.
  process.env.TELEGRAM_IMPORT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  let row: ImportSettings = {
    id: "singleton", encryptedSession: encryptTelegramSession("synthetic-session"), enabled: false,
    channelId: null, channelTitle: null, lastMessageId: 0,
    lastCheckedAt: null, lastImportedAt: null, error: null,
  };
  let latestCalls = 0, outbound: string | null = null, imported = 0;
  const cursorReads: number[] = [];
  const queued: ImportedTelegramPost[] = [];
  const client = {
    connect: async () => {}, close: async () => {}, authorized: async () => true,
    channels: async () => [{ id: "-100123", title: "Provider updates", username: "provider" }],
    latest: async () => { latestCalls++; return 50; },
    posts: async (_channel: string, cursor: number) => { cursorReads.push(cursor); return queued.splice(0); },
  } as unknown as TelegramImportTransport;
  const store = {
    settings: async () => ({ ...row }),
    updateSettings: async (patch: Partial<ImportSettings>) => { row = { ...row, ...patch }; return row; },
    acceptPosts: async (_expected: ImportSettings, posts: ImportedTelegramPost[]) => {
      imported += posts.filter(p => p.text.trim()).length;
      for (const p of posts) row.lastMessageId = Math.max(row.lastMessageId, p.id);
      row.lastCheckedAt = new Date();
    },
    unnotified: async () => [],
  } as unknown as TelegramImportStore;
  const importer = new TelegramImporter({ store, transport: () => client, outboundChatId: async () => outbound, notify: async () => {}, report: () => {} });
  importer.configured = () => true;
  try {
    await importer.configure("master", true, "-100123");
    assert.equal(row.lastMessageId, 50, "old history is excluded when a source is selected");
    assert.equal(latestCalls, 1);
    queued.push({ id: 51, text: "A new post", date: new Date(), entities: [] });
    await importer.tick();
    assert.equal(imported, 1);
    assert.equal(row.lastMessageId, 51);
    await importer.configure("master", false);
    await importer.tick();
    assert.equal(cursorReads.length, 1, "paused importer does not fetch messages");
    await importer.configure("master", true);
    assert.equal(latestCalls, 1, "resume does not discard posts received during a pause");
    await importer.tick();
    assert.deepEqual(cursorReads, [50, 51]);
    const status = await importer.status("master");
    assert.ok(!JSON.stringify(status).includes("synthetic-session"));
    assert.ok(!JSON.stringify(status).includes("encryptedSession"));
    outbound = "@provider";
    await assert.rejects(importer.configure("master", true), /prevent import loops/);
    outbound = "-100123";
    await importer.tick();
    assert.match(row.error || "", /prevent import loops/);
    assert.deepEqual(cursorReads, [50, 51], "outbound destination changes are rechecked before reading");
    await importer.disconnect("master");
    assert.equal(row.encryptedSession, null);
    assert.equal(row.enabled, false);
  } finally { await importer.stop(); }
});

test("dedicated login is owner-bound and encrypted, with private login steps", async () => {
  process.env.TELEGRAM_IMPORT_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  let settings = { encryptedSession: null, enabled: false, channelId: null, channelTitle: null, lastMessageId: 0, lastCheckedAt: null, lastImportedAt: null, error: null };
  let closed = 0;
  const transport = {
    connect: async () => {}, close: async () => { closed++; }, startLogin: async () => {},
    code: async (code: string) => {
      if (code === "valid-synthetic-code") return "password";
      throw { errorMessage: "PHONE_CODE_INVALID", privateSession: "not-to-be-exposed" };
    },
    password: async () => {}, authorized: async () => true, save: () => "synthetic-account-session",
  } as unknown as TelegramImportTransport;
  const store = {
    settings: async () => settings,
    updateSettings: async (patch: object) => { settings = { ...settings, ...patch }; return settings; },
  } as unknown as TelegramImportStore;
  const importer = new TelegramImporter({ store, transport: () => transport, outboundChatId: async () => null, notify: async () => {}, report: () => {} });
  importer.configured = () => true;
  try {
    assert.equal((await importer.login("master-one", "start", "+15555550000")).loginStep, "code");
    await assert.rejects(importer.login("other-master", "code", "valid-synthetic-code"), /expired/);
    assert.equal((await importer.status("other-master")).loginStep, "idle");
    await assert.rejects(importer.login("master-one", "code", "wrong"), /invalid or expired/);
    assert.equal((await importer.login("master-one", "code", "valid-synthetic-code")).loginStep, "password");
    await importer.login("master-one", "password", "synthetic-password");
    const encrypted = (settings as { encryptedSession: string | null }).encryptedSession;
    assert.ok(encrypted);
    assert.equal(decryptTelegramSession(encrypted), "synthetic-account-session");
    assert.equal((await importer.status("master-one")).loginStep, "idle");
    assert.ok(closed >= 1);
  } finally { await importer.stop(); }
});

test("login expires after five minutes and consumes the final allowed failed attempt", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const transport = {
    connect: async () => {}, close: async () => {}, startLogin: async () => {},
    code: async () => { throw { errorMessage: "PHONE_CODE_INVALID" }; },
  } as unknown as TelegramImportTransport;
  const store = {
    settings: async () => ({ encryptedSession: null, lastCheckedAt: null, lastImportedAt: null }),
  } as unknown as TelegramImportStore;
  const importer = new TelegramImporter({ store, transport: () => transport, outboundChatId: async () => null, notify: async () => {}, report: () => {} });
  importer.configured = () => true;
  try {
    await importer.login("master", "start", "+15555550000");
    t.mock.timers.tick(5 * 60000 + 1);
    assert.equal((await importer.status("master")).loginStep, "idle");
    await assert.rejects(importer.login("master", "code", "expired"), /expired/);
    await importer.login("master", "start", "+15555550000");
    for (let i = 0; i < 7; i++) {
      await assert.rejects(importer.login("master", "code", "wrong"), /invalid or expired/);
    }
    assert.equal((await importer.status("master")).loginStep, "code");
    await assert.rejects(importer.login("master", "code", "wrong"), /Too many attempts/);
    assert.equal((await importer.status("master")).loginStep, "idle");
  } finally { await importer.stop(); }
});
