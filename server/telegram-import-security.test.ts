import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptTelegramSession, decryptTelegramSession, importEncryptionKey, telegramBodyHtml, safeTelegramError, telegramFailureCode } from "./telegram-import-security";
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

test("sign-in failures identify configuration, account and delivery restrictions without exposing provider payloads", () => {
  for (const [code, expected] of [
    ["API_ID_INVALID", /API ID and API hash combination/],
    ["CONNECTION_API_ID_INVALID", /API ID/],
    ["API_ID_PUBLISHED_FLOOD", /restricted this API application/],
    ["PHONE_NUMBER_INVALID", /international number/],
    ["PHONE_NUMBER_BANNED", /banned this phone number/],
    ["PHONE_NUMBER_APP_SIGNUP_FORBIDDEN", /official Telegram app/],
    ["PHONE_NUMBER_UNOCCUPIED", /No Telegram account/],
    ["PHONE_PASSWORD_FLOOD", /limited password attempts/],
    ["SMS_CODE_CREATE_FAILED", /could not create a sign-in code/],
    ["UPDATE_APP_TO_LOGIN", /compatibility update/],
    ["RECAPTCHA_CHECK_private-provider-payload", /CAPTCHA/],
    ["FLOOD_WAIT_3600", /rate limit/],
    ["PHONE_MIGRATE_2", /different data center/],
    ["NETWORK_MIGRATE_4", /different data center/],
  ] as const) {
    const error = { errorMessage: code, message: "private-phone-and-request", request: { apiHash: "synthetic-secret" } };
    assert.match(safeTelegramError(error), expected);
    assert.ok(!safeTelegramError(error).includes("private-"));
    assert.ok(!telegramFailureCode(error).includes("private"));
  }
  assert.match(safeTelegramError({ code: "ECONNREFUSED", message: "private-network-detail" }), /connectivity/);
  assert.match(safeTelegramError(new Error("TIMEOUT")), /timed out/);
  assert.equal(telegramFailureCode({ name: "PhoneMigrateError", message: "private-provider-payload" }), "DATA_CENTER_MIGRATION");
  for (const error of [
    { errorMessage: "UNKNOWN_private-phone-and-request" },
    new Error("private-phone-and-request"),
    { errorMessage: "constructor" },
    null,
  ]) {
    assert.equal(telegramFailureCode(error), "UNKNOWN");
    assert.ok(!safeTelegramError(error).includes("private-phone"));
  }
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
