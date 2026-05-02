import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_KEYS,
  countEnabledChannels,
  getNotificationCategory,
  userWantsChannel,
  type NotificationPrefs,
} from "../shared/notification-categories";

test("default = on for every category and channel when prefs is empty", () => {
  for (const cat of NOTIFICATION_CATEGORIES) {
    for (const channel of cat.channels) {
      assert.equal(
        userWantsChannel({}, cat.key, channel),
        true,
        `${cat.key}.${channel} should default to true`,
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
  const allOn = countEnabledChannels({}, "push");
  const allOnEmail = countEnabledChannels({}, "email");
  assert.equal(allOn.total, pushTotal);
  assert.equal(allOn.enabled, pushTotal);
  assert.equal(allOnEmail.total, emailTotal);
  assert.equal(allOnEmail.enabled, emailTotal);
});

test("countEnabledChannels reflects partial disables", () => {
  const prefs: NotificationPrefs = {
    ticket_reply: { push: false },
    ticket_received: { push: false },
  };
  const push = countEnabledChannels(prefs, "push");
  assert.equal(push.enabled, push.total - 2);
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
  assert.equal(push.enabled, push.total, "push prefs untouched by legacy migration");
});

test("category keys are unique", () => {
  const set = new Set(NOTIFICATION_CATEGORY_KEYS);
  assert.equal(set.size, NOTIFICATION_CATEGORY_KEYS.length);
});
