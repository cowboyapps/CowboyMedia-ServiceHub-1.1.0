import { test } from "node:test";
import assert from "node:assert/strict";
import {
  groupNotifications,
  type UserNotification,
} from "../client/src/lib/notification-grouping";

function n(partial: Partial<UserNotification> & { id: string; createdAt: string }): UserNotification {
  return {
    userId: "u1",
    type: "ticket_update",
    title: "Notification",
    body: "body",
    referenceType: null,
    referenceId: null,
    url: null,
    readAt: null,
    dismissedAt: null,
    ...partial,
  };
}

test("collapses mixed ticket events for the same ticket into one group", () => {
  const notifs = [
    n({ id: "a", type: "new_ticket", referenceType: "ticket", referenceId: "t1", createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "ticket_update", referenceType: "ticket", referenceId: "t1", createdAt: "2026-07-05T11:00:00Z" }),
    n({ id: "c", type: "ticket_update", referenceType: "ticket", referenceId: "t1", createdAt: "2026-07-05T12:00:00Z" }),
  ];
  const groups = groupNotifications(notifs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  // Latest (newest createdAt) drives the row.
  assert.equal(groups[0].latest.id, "c");
  assert.equal(groups[0].key, "ticket-t1");
});

test("keeps different tickets as separate groups", () => {
  const groups = groupNotifications([
    n({ id: "a", referenceType: "ticket", referenceId: "t1", createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", referenceType: "ticket", referenceId: "t2", createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 2);
});

test("preserves direct-message thread grouping", () => {
  const groups = groupNotifications([
    n({ id: "a", type: "message", referenceType: "message_thread", referenceId: "m1", createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "message", referenceType: "message_thread", referenceId: "m1", createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 2);
});

test("does NOT collapse whmcs_service lifecycle events (distinct signals)", () => {
  const groups = groupNotifications([
    n({ id: "a", type: "whmcs_service_renewal", referenceType: "whmcs_service", referenceId: "s1", createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "whmcs_service_status", referenceType: "whmcs_service", referenceId: "s1", createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.every((g) => g.count === 1), true);
});

test("does NOT collapse url_monitor down/up for the same monitor", () => {
  const groups = groupNotifications([
    n({ id: "a", type: "monitor_down", referenceType: "url_monitor", referenceId: "mon1", createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "monitor_up", referenceType: "url_monitor", referenceId: "mon1", createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 2);
});

test("allowlisted referenceType with missing referenceId stays standalone", () => {
  const groups = groupNotifications([
    n({ id: "a", type: "ticket_update", referenceType: "ticket", referenceId: null, createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "ticket_update", referenceType: "ticket", referenceId: null, createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 2);
});

test("notifications without a reference stay standalone", () => {
  const groups = groupNotifications([
    n({ id: "a", type: "news", referenceType: null, referenceId: null, createdAt: "2026-07-05T10:00:00Z" }),
    n({ id: "b", type: "news", referenceType: null, referenceId: null, createdAt: "2026-07-05T11:00:00Z" }),
  ]);
  assert.equal(groups.length, 2);
});

test("orders groups newest-first by the latest member", () => {
  const groups = groupNotifications([
    n({ id: "old", referenceType: "ticket", referenceId: "t1", createdAt: "2026-07-05T09:00:00Z" }),
    n({ id: "new", referenceType: "ticket", referenceId: "t2", createdAt: "2026-07-05T15:00:00Z" }),
    n({ id: "mid", type: "news", createdAt: "2026-07-05T12:00:00Z" }),
  ]);
  assert.deepEqual(groups.map((g) => g.latest.id), ["new", "mid", "old"]);
});
