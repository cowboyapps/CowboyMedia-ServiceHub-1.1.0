import { test } from "node:test";
import assert from "node:assert/strict";
import { markGroupRead, type MarkGroupReadStorage } from "./notifications-helpers";

interface Row {
  id: string;
  userId: string;
  referenceType: string | null;
  referenceId: string | null;
  readAt: Date | null;
  dismissedAt: Date | null;
}

function fakeStore(rows: Row[]): MarkGroupReadStorage & { rows: Row[] } {
  return {
    rows,
    async markUserNotificationRead(id, userId) {
      for (const r of rows) {
        if (r.id === id && r.userId === userId && !r.readAt) r.readAt = new Date();
      }
    },
    async markUserNotificationsByReferenceRead(userId, referenceType, referenceId) {
      let count = 0;
      for (const r of rows) {
        if (
          r.userId === userId &&
          r.referenceType === referenceType &&
          r.referenceId === referenceId &&
          !r.readAt &&
          !r.dismissedAt
        ) {
          r.readAt = new Date();
          count++;
        }
      }
      return count;
    },
  };
}

test("markGroupRead flips every unread peer row sharing (referenceType, referenceId)", async () => {
  const store = fakeStore([
    { id: "a", userId: "u1", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: null },
    { id: "b", userId: "u1", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: null },
    { id: "c", userId: "u1", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: null },
    // peer for a different ticket — must NOT be touched
    { id: "d", userId: "u1", referenceType: "ticket", referenceId: "T2", readAt: null, dismissedAt: null },
    // peer for a different user — must NOT be touched
    { id: "e", userId: "u2", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: null },
  ]);

  const cleared = await markGroupRead(store, "u1", {
    id: "a",
    referenceType: "ticket",
    referenceId: "T1",
  });

  assert.equal(cleared, 2, "two peer rows (b, c) should have been flipped by the group sweep");
  assert.ok(store.rows.find((r) => r.id === "a")!.readAt, "clicked row marked read");
  assert.ok(store.rows.find((r) => r.id === "b")!.readAt, "peer b marked read");
  assert.ok(store.rows.find((r) => r.id === "c")!.readAt, "peer c marked read");
  assert.equal(store.rows.find((r) => r.id === "d")!.readAt, null, "other ticket untouched");
  assert.equal(store.rows.find((r) => r.id === "e")!.readAt, null, "other user untouched");
});

test("markGroupRead skips the bulk sweep when notif has no reference", async () => {
  let bulkCalls = 0;
  const store: MarkGroupReadStorage = {
    async markUserNotificationRead() {},
    async markUserNotificationsByReferenceRead() {
      bulkCalls++;
      return 0;
    },
  };
  const cleared = await markGroupRead(store, "u1", {
    id: "x",
    referenceType: null,
    referenceId: null,
  });
  assert.equal(cleared, 0);
  assert.equal(bulkCalls, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// End-to-end-ish coverage for the "OS toast tag must match the persisted
// (referenceType, referenceId) pair" invariant. If a fan-out call site
// rolls up notifications visually under one tag but persists per-item
// reference IDs, the bulk read sweep here will silently fail to clear
// peer rows from the in-app notification center. These tests pin the
// alignment for the two coalesced resources fixed in task #106.
// ─────────────────────────────────────────────────────────────────────────

test("service-update group: tapping one toast clears every peer row for the same service", async () => {
  const serviceId = "svc-cloud";
  const otherServiceId = "svc-db";
  // Three updates published for the same service (svc-cloud) to the same
  // user — the OS toast collapses them under tag `service-update-svc-cloud`.
  // A fourth row exists for an unrelated service.
  const store = fakeStore([
    { id: "n1", userId: "u1", referenceType: "service_update_group", referenceId: serviceId, readAt: null, dismissedAt: null },
    { id: "n2", userId: "u1", referenceType: "service_update_group", referenceId: serviceId, readAt: null, dismissedAt: null },
    { id: "n3", userId: "u1", referenceType: "service_update_group", referenceId: serviceId, readAt: null, dismissedAt: null },
    { id: "n4", userId: "u1", referenceType: "service_update_group", referenceId: otherServiceId, readAt: null, dismissedAt: null },
  ]);

  const cleared = await markGroupRead(store, "u1", {
    id: "n1",
    referenceType: "service_update_group",
    referenceId: serviceId,
  });

  assert.equal(cleared, 2, "n2 + n3 swept; n1 was already flipped by the per-id call");
  for (const id of ["n1", "n2", "n3"]) {
    assert.ok(store.rows.find((r) => r.id === id)!.readAt, `${id} marked read`);
  }
  assert.equal(store.rows.find((r) => r.id === "n4")!.readAt, null, "other service untouched");
});

test("news_author group: tapping one toast clears every peer row by the same author", async () => {
  const authorA = "author-alice";
  const authorB = "author-bob";
  const store = fakeStore([
    { id: "s1", userId: "u1", referenceType: "news_author", referenceId: authorA, readAt: null, dismissedAt: null },
    { id: "s2", userId: "u1", referenceType: "news_author", referenceId: authorA, readAt: null, dismissedAt: null },
    { id: "s3", userId: "u1", referenceType: "news_author", referenceId: authorB, readAt: null, dismissedAt: null },
  ]);

  const cleared = await markGroupRead(store, "u1", {
    id: "s1",
    referenceType: "news_author",
    referenceId: authorA,
  });

  assert.equal(cleared, 1, "s2 swept; s1 already flipped");
  assert.ok(store.rows.find((r) => r.id === "s2")!.readAt, "peer story by same author marked read");
  assert.equal(store.rows.find((r) => r.id === "s3")!.readAt, null, "story by other author untouched");
});

test("markGroupRead skips dismissed peers (only sweeps live unread rows)", async () => {
  const store = fakeStore([
    { id: "a", userId: "u1", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: null },
    { id: "b", userId: "u1", referenceType: "ticket", referenceId: "T1", readAt: null, dismissedAt: new Date() },
  ]);

  const cleared = await markGroupRead(store, "u1", {
    id: "a",
    referenceType: "ticket",
    referenceId: "T1",
  });

  // The clicked row 'a' is flipped by the per-id call first, so the
  // subsequent bulk sweep finds no remaining unread rows for T1 (b is
  // dismissed and therefore excluded). cleared reflects bulk-sweep rows
  // only, hence 0.
  assert.equal(cleared, 0);
  assert.equal(store.rows.find((r) => r.id === "b")!.readAt, null, "dismissed peer untouched");
});
