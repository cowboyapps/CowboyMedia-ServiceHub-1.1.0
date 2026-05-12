import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectNewsEmailRecipients,
  selectNewsPushRecipients,
  selectNewsInAppRecipients,
} from "./news-recipients";

type Role = "customer" | "admin" | "master_admin";
function user(
  id: string,
  role: Role,
  email: string | null,
  notificationPrefs: Record<string, { push?: boolean; email?: boolean }> = {},
) {
  return { id, role, email, notificationPrefs } as any;
}

test("selectNewsEmailRecipients includes customers, admins, and master_admins by default", () => {
  const users = [
    user("c1", "customer", "c1@x.com"),
    user("a1", "admin", "a1@x.com"),
    user("m1", "master_admin", "m1@x.com"),
  ];
  const emails = selectNewsEmailRecipients(users);
  assert.deepEqual(emails.sort(), ["a1@x.com", "c1@x.com", "m1@x.com"]);
});

test("selectNewsEmailRecipients excludes admin who set news.email = false", () => {
  const users = [
    user("c1", "customer", "c1@x.com"),
    user("a1", "admin", "a1@x.com", { news: { email: false } }),
    user("m1", "master_admin", "m1@x.com"),
  ];
  const emails = selectNewsEmailRecipients(users);
  assert.deepEqual(emails.sort(), ["c1@x.com", "m1@x.com"]);
  assert.ok(!emails.includes("a1@x.com"), "admin who opted out must be excluded");
});

test("selectNewsEmailRecipients excludes customers who opted out", () => {
  const users = [
    user("c1", "customer", "c1@x.com", { news: { email: false } }),
    user("c2", "customer", "c2@x.com"),
  ];
  assert.deepEqual(selectNewsEmailRecipients(users), ["c2@x.com"]);
});

test("selectNewsEmailRecipients skips users without an email address", () => {
  const users = [
    user("c1", "customer", null),
    user("a1", "admin", ""),
    user("m1", "master_admin", "m1@x.com"),
  ];
  assert.deepEqual(selectNewsEmailRecipients(users), ["m1@x.com"]);
});

test("selectNewsPushRecipients honours news.push pref across roles", () => {
  const users = [
    user("c1", "customer", "c1@x.com"),
    user("a1", "admin", "a1@x.com", { news: { push: false } }),
    user("m1", "master_admin", "m1@x.com"),
  ];
  const ids = selectNewsPushRecipients(users).map((u) => u.id);
  assert.deepEqual(ids.sort(), ["c1", "m1"]);
});

test("selectNewsInAppRecipients returns every user id regardless of prefs", () => {
  const users = [
    user("c1", "customer", "c1@x.com", { news: { push: false, email: false } }),
    user("a1", "admin", null, { news: { push: false, email: false } }),
  ];
  assert.deepEqual(selectNewsInAppRecipients(users).sort(), ["a1", "c1"]);
});

function withQuietHours<T extends Record<string, any>>(u: T, qh: {
  enabled?: boolean;
  start?: string;
  end?: string;
  timezone?: string;
  allowCritical?: boolean;
}): T {
  return {
    ...u,
    quietHoursEnabled: qh.enabled ?? true,
    quietHoursStart: qh.start ?? "00:00",
    quietHoursEnd: qh.end ?? "23:59",
    quietHoursTimezone: qh.timezone ?? "UTC",
    quietHoursAllowCritical: qh.allowCritical ?? true,
  };
}

test("selectNewsPushRecipients excludes users currently in quiet hours", () => {
  // 00:00–23:59 UTC effectively covers any "now"; user is always in quiet hours.
  const users = [
    user("c1", "customer", "c1@x.com"),
    withQuietHours(user("c2", "customer", "c2@x.com"), {}),
  ];
  const ids = selectNewsPushRecipients(users).map((u) => u.id);
  assert.deepEqual(ids.sort(), ["c1"]);
});

test("selectNewsEmailRecipients excludes users currently in quiet hours", () => {
  const users = [
    user("c1", "customer", "c1@x.com"),
    withQuietHours(user("c2", "customer", "c2@x.com"), {}),
  ];
  assert.deepEqual(selectNewsEmailRecipients(users), ["c1@x.com"]);
});

test("news quiet-hours suppression is NOT bypassed by allowCritical (only service_alert critical bypasses)", () => {
  const users = [
    withQuietHours(user("c1", "customer", "c1@x.com"), { allowCritical: true }),
  ];
  assert.deepEqual(selectNewsPushRecipients(users), []);
  assert.deepEqual(selectNewsEmailRecipients(users), []);
});

test("selectNewsInAppRecipients still includes users in quiet hours", () => {
  const users = [
    withQuietHours(user("c1", "customer", "c1@x.com"), {}),
  ];
  assert.deepEqual(selectNewsInAppRecipients(users), ["c1"]);
});
