import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptTelegramSession, decryptTelegramSession, importEncryptionKey, telegramBodyHtml, safeTelegramError } from "./telegram-import-security";
import { buildApiLogLine } from "./request-log";

test("Telegram sessions use authenticated encryption with unique nonces", () => {
  const key = randomBytes(32);
  const first = encryptTelegramSession("synthetic-test-session", key);
  const second = encryptTelegramSession("synthetic-test-session", key);
  assert.notEqual(first, second);
  assert.ok(!first.includes("synthetic-test-session"));
  assert.equal(decryptTelegramSession(first, key), "synthetic-test-session");
  assert.throws(() => decryptTelegramSession(first, randomBytes(32)));
  const parts = first.split(".");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptTelegramSession(parts.join("."), key));
  assert.throws(() => importEncryptionKey("short"));
  assert.equal(importEncryptionKey(key.toString("hex")).length, 32);
  assert.equal(importEncryptionKey(key.toString("base64")).length, 32);
});

test("Telegram text and hidden links preserve newlines without injecting HTML", () => {
  assert.equal(telegramBodyHtml('Hello <script>\nhttps://example.org/?a=1&b=2'), '<p>Hello &lt;script&gt;<br>https://example.org/?a=1&amp;b=2</p>');
  assert.equal(telegramBodyHtml("😀 news", [{ offset: 3, length: 4, url: 'https://example.org/"test' }]),
    '<p>😀 <a href="https://example.org/&quot;test">news</a></p>');
  assert.equal(telegramBodyHtml("click", [{ offset: 0, length: 5, url: "javascript:alert(1)" }]), "<p>click</p>");
  assert.equal(telegramBodyHtml("click", [{ offset: -1, length: 5, url: "https://example.org" }]), "<p>click</p>");
});

test("Telegram failures and endpoint logs never contain account/session material", () => {
  assert.ok(!safeTelegramError(new Error("synthetic-private-session")).includes("synthetic-private-session"));
  assert.match(safeTelegramError({ errorMessage: "SESSION_REVOKED" }), /Reconnect/);
  assert.match(safeTelegramError({ errorMessage: "CHANNEL_PRIVATE" }), /access/);
  assert.match(safeTelegramError({ errorMessage: "FLOOD_WAIT_60" }), /rate limit/);
  for (const path of ["/api/admin/telegram-import/status", "/api/admin/telegram-import/login/code", "/api/admin/telegram-import/login/password"]) {
    const line = buildApiLogLine({ path, method: "POST", statusCode: 200, durationMs: 2, body: { session: "synthetic-private-session" } });
    assert.ok(!line.includes("synthetic-private-session"));
  }
});
