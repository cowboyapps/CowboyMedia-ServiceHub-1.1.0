import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  countEnabledChannels,
  getCategoriesForRole,
  getNotificationCategory,
  isCategoryVisibleToRole,
  userWantsChannel,
  type NotificationPrefs,
} from "../shared/notification-categories";

test("default = on for every category and channel when prefs is empty (except defaultOff)", () => {
  for (const cat of NOTIFICATION_CATEGORIES) {
    for (const channel of cat.channels) {
      const expected = !cat.defaultOff;
      assert.equal(
        userWantsChannel({}, cat.key, channel),
        expected,
        `${cat.key}.${channel} should default to ${expected}`,
      );
    }
  }
});

test("default = on when prefs is null/undefined", () => {
  assert.equal(userWantsChannel(null, "ticket_reply", "push"), true);
  assert.equal(userWantsChannel(undefined, "ticket_reply", "email"), true);
});

test("returns false when channel is explicitly disabled", () => {
  const prefs: NotificationPrefs = { ticket_reply: { push: false } };
  assert.equal(userWantsChannel(prefs, "ticket_reply", "push"), false);
  assert.equal(userWantsChannel(prefs, "ticket_reply", "email"), true);
});

test("returns false for unsupported channels (e.g. setup_reminder push)", () => {
  assert.equal(userWantsChannel({}, "setup_reminder", "push"), false);
  assert.equal(userWantsChannel({ setup_reminder: { push: true } }, "setup_reminder", "push"), false);
  assert.equal(userWantsChannel({}, "setup_reminder", "email"), true);
});

test("ticket_closed and report_received are email-only", () => {
  const closed = getNotificationCategory("ticket_closed");
  const received = getNotificationCategory("report_received");
  assert.deepEqual(closed?.channels, ["email"]);
  assert.deepEqual(received?.channels, ["email"]);
  assert.equal(userWantsChannel({}, "ticket_closed", "push"), false);
  assert.equal(userWantsChannel({}, "report_received", "push"), false);
});

test("returns false for unknown categories", () => {
  assert.equal(userWantsChannel({}, "totally_made_up", "email"), false);
});

test("countEnabledChannels totals match category contract", () => {
  const pushTotal = NOTIFICATION_CATEGORIES.filter((c) => c.channels.includes("push")).length;
  const emailTotal = NOTIFICATION_CATEGORIES.filter((c) => c.channels.includes("email")).length;
  const pushDefaultOff = NOTIFICATION_CATEGORIES.filter(
    (c) => c.channels.includes("push") && c.defaultOff,
  ).length;
  const emailDefaultOff = NOTIFICATION_CATEGORIES.filter(
    (c) => c.channels.includes("email") && c.defaultOff,
  ).length;
  const allOn = countEnabledChannels({}, "push");
  const allOnEmail = countEnabledChannels({}, "email");
  assert.equal(allOn.total, pushTotal);
  assert.equal(allOn.enabled, pushTotal - pushDefaultOff);
  assert.equal(allOnEmail.total, emailTotal);
  assert.equal(allOnEmail.enabled, emailTotal - emailDefaultOff);
});

test("countEnabledChannels reflects partial disables", () => {
  const pushDefaultOff = NOTIFICATION_CATEGORIES.filter(
    (c) => c.channels.includes("push") && c.defaultOff,
  ).length;
  const prefs: NotificationPrefs = {
    ticket_reply: { push: false },
    ticket_received: { push: false },
  };
  const push = countEnabledChannels(prefs, "push");
  assert.equal(push.enabled, push.total - 2 - pushDefaultOff);
});

test("simulated migration: legacy emailNotifications=false maps to all-email-off", () => {
  const migrated: NotificationPrefs = {};
  for (const cat of NOTIFICATION_CATEGORIES) {
    if (cat.channels.includes("email")) {
      migrated[cat.key] = { ...(migrated[cat.key] ?? {}), email: false };
    }
  }
  const email = countEnabledChannels(migrated, "email");
  assert.equal(email.enabled, 0);
  const push = countEnabledChannels(migrated, "push");
  const pushDefaultOff = NOTIFICATION_CATEGORIES.filter(
    (c) => c.channels.includes("push") && c.defaultOff,
  ).length;
  assert.equal(
    push.enabled,
    push.total - pushDefaultOff,
    "push prefs untouched by legacy migration",
  );
});

test("category keys are unique", () => {
  const set = new Set(NOTIFICATION_CATEGORY_KEYS);
  assert.equal(set.size, NOTIFICATION_CATEGORY_KEYS.length);
});

test("isCategoryVisibleToRole: customer categories visible to every role", () => {
  const customerCat = getNotificationCategory("ticket_reply")!;
  assert.equal(isCategoryVisibleToRole(customerCat, "customer"), true);
  assert.equal(isCategoryVisibleToRole(customerCat, "admin"), true);
  assert.equal(isCategoryVisibleToRole(customerCat, "master_admin"), true);
});

test("isCategoryVisibleToRole: admin categories hidden from customers", () => {
  const adminCat = getNotificationCategory("admin_new_ticket")!;
  assert.equal(isCategoryVisibleToRole(adminCat, "customer"), false);
  assert.equal(isCategoryVisibleToRole(adminCat, "admin"), true);
  assert.equal(isCategoryVisibleToRole(adminCat, "master_admin"), true);
});

test("isCategoryVisibleToRole: master-admin-only categories restricted", () => {
  const masterCat = getNotificationCategory("admin_ticket_reply_any")!;
  assert.equal(isCategoryVisibleToRole(masterCat, "customer"), false);
  assert.equal(isCategoryVisibleToRole(masterCat, "admin"), false);
  assert.equal(isCategoryVisibleToRole(masterCat, "master_admin"), true);
});

test("getCategoriesForRole: admin sees both customer and admin categories", () => {
  const adminCats = getCategoriesForRole("admin");
  const keys = adminCats.map((c) => c.key);
  // Customer categories present
  assert.ok(keys.includes("ticket_reply"), "admin should see ticket_reply");
  assert.ok(keys.includes("news"), "admin should see news");
  assert.ok(keys.includes("service_alert"), "admin should see service_alert");
  // Admin categories present
  assert.ok(keys.includes("admin_new_ticket"), "admin should see admin_new_ticket");
  assert.ok(keys.includes("admin_chat_message"), "admin should see admin_chat_message");
  // Master-admin-only NOT present
  assert.ok(!keys.includes("admin_ticket_reply_any"), "admin should NOT see master-only category");
  // At least one email-eligible category visible
  assert.ok(adminCats.some((c) => c.channels.includes("email")), "admin should have email-eligible categories");
});

test("getCategoriesForRole: customer never sees admin categories", () => {
  const customerCats = getCategoriesForRole("customer");
  const keys = customerCats.map((c) => c.key);
  assert.ok(!keys.includes("admin_new_ticket"));
  assert.ok(!keys.includes("admin_chat_message"));
  assert.ok(!keys.includes("admin_broadcast"));
  assert.ok(keys.includes("ticket_reply"));
});

test("admin with email pref off is not surfaced as wanting email for that category", () => {
  // Mirrors server-side gating: customerWantsEmail now respects prefs for admins too.
  const prefs: NotificationPrefs = { news: { email: false } };
  assert.equal(userWantsChannel(prefs, "news", "email"), false);
  assert.equal(userWantsChannel(prefs, "news", "push"), true);
});

test("bell-creating customer categories all support the in_app channel", () => {
  const bellCategories = [
    "ticket_reply",
    "ticket_claimed",
    "ticket_transferred",
    "ticket_received",
    "report_update",
    "service_status",
    "service_alert",
    "service_update",
    "news",
  ];
  for (const key of bellCategories) {
    const cat = getNotificationCategory(key);
    assert.ok(cat, `${key} should exist`);
    assert.ok(cat!.channels.includes("in_app"), `${key} should support in_app`);
  }
});

test("in_app defaults on for bell categories and is independently toggleable", () => {
  assert.equal(userWantsChannel({}, "ticket_reply", "in_app"), true);
  // Turning off push must not affect in_app, and vice versa.
  const pushOff: NotificationPrefs = { ticket_reply: { push: false } };
  assert.equal(userWantsChannel(pushOff, "ticket_reply", "in_app"), true);
  assert.equal(userWantsChannel(pushOff, "ticket_reply", "push"), false);
  const inAppOff: NotificationPrefs = { ticket_reply: { in_app: false } };
  assert.equal(userWantsChannel(inAppOff, "ticket_reply", "in_app"), false);
  assert.equal(userWantsChannel(inAppOff, "ticket_reply", "push"), true);
});

test("email-only and message categories do not support in_app", () => {
  for (const key of ["ticket_closed", "report_received", "setup_reminder", "private_message", "thread_message"]) {
    const cat = getNotificationCategory(key);
    if (!cat) continue;
    assert.ok(!cat.channels.includes("in_app"), `${key} should NOT support in_app`);
    assert.equal(userWantsChannel({}, key, "in_app"), false);
  }
});

test("countEnabledChannels supports the in_app channel", () => {
  const inAppTotal = NOTIFICATION_CATEGORIES.filter((c) => c.channels.includes("in_app")).length;
  const inAppDefaultOff = NOTIFICATION_CATEGORIES.filter(
    (c) => c.channels.includes("in_app") && c.defaultOff,
  ).length;
  const allOn = countEnabledChannels({}, "in_app");
  assert.equal(allOn.total, inAppTotal);
  assert.equal(allOn.enabled, inAppTotal - inAppDefaultOff);
});
