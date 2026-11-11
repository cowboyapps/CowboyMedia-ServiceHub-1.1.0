import { after, afterEach, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import webpush from "web-push";
import { createEmailSender } from "./email";
import { storage } from "./storage";
import { pool } from "./db";

// Importing routes installs a housekeeping interval even without starting a
// server. Track those handles so this isolated provider test can clean them up.
const interval = globalThis.setInterval;
const importTimers: Array<number | NodeJS.Timeout> = [];
const intervalMock = mock.method(globalThis, "setInterval", (fn: () => void, ms?: number, ...args: unknown[]) => {
  const handle = interval(fn, ms, ...args);
  importTimers.push(handle);
  return handle;
});
const { sendPushToUser } = await import("./routes");
intervalMock.mock.restore();

beforeEach(() => {
  // Provider tests must never send real notifications or write unrelated logs.
  mock.method(storage, "createActivityLog", async () => ({}));
  mock.method(storage, "createErrorLog", async () => ({}));
  mock.method(storage, "getUser", async () => undefined);
});
afterEach(() => mock.restoreAll());
after(async () => { for (const timer of importTimers) clearInterval(timer); await pool.end(); });

function emailSender(status?: number, succeeds = false) {
  return createEmailSender(() => ({
    fromEmail: { email: "noreply@example.test", name: "Test" },
    client: {
      send: (async () => {
        if (succeeds) return [{ statusCode: 202 }, {}];
        throw Object.assign(new Error("Test provider failure"), status ? { code: status } : { code: "ECONNRESET" });
      }) as never,
    },
  }));
}

test("email helper reports accepted, rate-limited, permanent and unknown provider results", async () => {
  assert.equal((await emailSender(undefined, true)("customer@example.test", "Reminder", "<p>Test</p>")).status, "succeeded");
  for (const status of [429, 400, 401, 403, 500, undefined]) {
    const result = await emailSender(status)("customer@example.test", "Reminder", "<p>Test</p>");
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.retryable, status === 429);
    assert.ok(!result.detail.includes("ECONNRESET"));
  }
});

test("push helper reports no subscriptions as a non-retryable failure", async () => {
  mock.method(storage, "getPushSubscriptionsByUser", async () => []);
  const result = await sendPushToUser("test-user", { title: "Reminder", body: "Test" });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.retryable, false);
});

function subscriptions() {
  return [1, 2].map(n => ({ id: `sub-${n}`, userId: "test-user", endpoint: `https://push.example.test/${n}`, p256dh: "test", auth: "test", createdAt: new Date() }));
}

test("push only retries when every device explicitly rate-limits and none accepted", async () => {
  for (const status of [429, 403, 500, undefined]) {
    mock.method(storage, "getPushSubscriptionsByUser", async () => subscriptions());
    mock.method(webpush, "sendNotification", async () => { throw Object.assign(new Error("Test rejection"), { statusCode: status }); });
    const result = await sendPushToUser("test-user", { title: "Reminder", body: "Test" });
    assert.equal(result.status, "failed");
    if (result.status === "failed") assert.equal(result.retryable, status === 429);
  }
});

test("one accepted push device consumes the channel even if another rate-limits", async () => {
  mock.method(storage, "getPushSubscriptionsByUser", async () => subscriptions());
  let calls = 0;
  mock.method(webpush, "sendNotification", async () => {
    if (++calls === 2) throw Object.assign(new Error("Rate limited"), { statusCode: 429 });
    return { statusCode: 201 };
  });
  const result = await sendPushToUser("test-user", { title: "Reminder", body: "Test" });
  assert.equal(result.status, "succeeded");
  assert.match(result.detail, /1 device/);
});

test("stale push subscriptions are removed and are not reported as successes", async () => {
  mock.method(storage, "getPushSubscriptionsByUser", async () => subscriptions());
  const removed: string[] = [];
  mock.method(storage, "deletePushSubscription", async (endpoint: string) => { removed.push(endpoint); });
  mock.method(webpush, "sendNotification", async () => { throw Object.assign(new Error("Gone"), { statusCode: 410 }); });
  const result = await sendPushToUser("test-user", { title: "Reminder", body: "Test" });
  assert.equal(result.status, "failed");
  if (result.status === "failed") assert.equal(result.retryable, false);
  assert.equal(removed.length, 2);
});

test("a later logging error does not erase a confirmed push acceptance", async () => {
  mock.method(storage, "getPushSubscriptionsByUser", async () => subscriptions());
  mock.method(webpush, "sendNotification", async () => ({ statusCode: 201 }));
  mock.method(storage, "getUser", async () => { throw new Error("Post-send lookup failed"); });
  const result = await sendPushToUser("test-user", { title: "Reminder", body: "Test" });
  assert.equal(result.status, "succeeded");
});
