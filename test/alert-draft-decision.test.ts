import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideOutageDraft,
  decideOutageSupersedesRecovery,
  decideRecoveryDraft,
  formatDowntime,
  OUTAGE_DRAFT_COOLDOWN_MS,
  type DraftLike,
} from "../shared/alert-draft-decision";

// The suppression rules are the heart of "one draft per outage episode, never
// spam a card per flap". They are pure so they can be pinned down without the
// polling loop, timers, or a DB.

const NOW = new Date("2026-07-08T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

function draft(overrides: Partial<DraftLike>): DraftLike {
  return { id: "d1", kind: "outage", status: "pending", createdAt: minutesAgo(5), ...overrides };
}

// ---------- outage side ----------

test("fresh outage with no history creates a draft", () => {
  assert.deepEqual(
    decideOutageDraft({ now: NOW, monitorDrafts: [], serviceHasActiveAlert: false }),
    { action: "create" },
  );
});

test("pending outage draft → attach latest incident, never a second card", () => {
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [draft({ id: "pend-1" })],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "attach", draftId: "pend-1" });
});

test("active alert already covering the service suppresses a new draft", () => {
  const d = decideOutageDraft({ now: NOW, monitorDrafts: [], serviceHasActiveAlert: true });
  assert.deepEqual(d, { action: "skip", reason: "active-alert" });
});

test("published draft inside the cooldown window suppresses (same episode)", () => {
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [draft({ status: "published", createdAt: minutesAgo(30) })],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "skip", reason: "cooldown" });
});

test("published draft OUTSIDE the cooldown window allows a new episode", () => {
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [draft({ status: "published", createdAt: new Date(NOW.getTime() - OUTAGE_DRAFT_COOLDOWN_MS - 1000) })],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "create" });
});

test("dismissed and superseded drafts DO trigger the cooldown (anti-flap: one card per episode)", () => {
  for (const status of ["dismissed", "superseded"] as const) {
    const d = decideOutageDraft({
      now: NOW,
      monitorDrafts: [draft({ id: "a", status, createdAt: minutesAgo(5) })],
      serviceHasActiveAlert: false,
    });
    assert.deepEqual(d, { action: "skip", reason: "cooldown" }, `${status} inside window must suppress`);
  }
});

test("dismissed/superseded drafts outside the cooldown window allow a new episode", () => {
  const old = new Date(NOW.getTime() - OUTAGE_DRAFT_COOLDOWN_MS - 1000);
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [
      draft({ id: "a", status: "dismissed", createdAt: old }),
      draft({ id: "b", status: "superseded", createdAt: old }),
    ],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "create" });
});

test("down→up→down flap: outage draft superseded on recovery still suppresses the next down (no second card)", () => {
  // Down #1 created draft o1; up superseded it (no alert was ever published);
  // down #2 arrives 10 minutes later — must NOT create a fresh draft.
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [draft({ id: "o1", status: "superseded", createdAt: minutesAgo(10) })],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "skip", reason: "cooldown" });
});

test("recovery drafts are ignored by the outage decision (kind filter)", () => {
  const d = decideOutageDraft({
    now: NOW,
    monitorDrafts: [draft({ id: "r", kind: "recovery", status: "published", createdAt: minutesAgo(5) })],
    serviceHasActiveAlert: false,
  });
  assert.deepEqual(d, { action: "create" });
});

test("a fresh outage supersedes pending recovery drafts only", () => {
  const ids = decideOutageSupersedesRecovery([
    draft({ id: "r1", kind: "recovery", status: "pending" }),
    draft({ id: "r2", kind: "recovery", status: "published" }),
    draft({ id: "o1", kind: "outage", status: "pending" }),
  ]);
  assert.deepEqual(ids, ["r1"]);
});

// ---------- recovery side ----------

test("recovery: pending outage draft is superseded and no recovery draft for an unpublished blip", () => {
  const d = decideRecoveryDraft({
    monitorDrafts: [draft({ id: "o1", status: "pending" })],
    activeRelatedAlertId: null,
  });
  assert.deepEqual(d, { supersedeDraftIds: ["o1"], createRecoveryForAlertId: null });
});

test("recovery: published outage alert still active → recovery draft pointing at it", () => {
  const d = decideRecoveryDraft({
    monitorDrafts: [draft({ id: "o1", status: "published" })],
    activeRelatedAlertId: "alert-9",
  });
  assert.deepEqual(d, { supersedeDraftIds: [], createRecoveryForAlertId: "alert-9" });
});

test("recovery: an existing pending recovery draft blocks a duplicate", () => {
  const d = decideRecoveryDraft({
    monitorDrafts: [draft({ id: "r1", kind: "recovery", status: "pending" })],
    activeRelatedAlertId: "alert-9",
  });
  assert.equal(d.createRecoveryForAlertId, null);
});

test("recovery: pending outage superseded AND recovery drafted when a separate alert is active", () => {
  const d = decideRecoveryDraft({
    monitorDrafts: [draft({ id: "o1", status: "pending" })],
    activeRelatedAlertId: "alert-manual",
  });
  assert.deepEqual(d, { supersedeDraftIds: ["o1"], createRecoveryForAlertId: "alert-manual" });
});

// ---------- formatting ----------

test("formatDowntime buckets", () => {
  assert.equal(formatDowntime(45), "45s");
  assert.equal(formatDowntime(180), "3m");
  assert.equal(formatDowntime(7500), "2h 5m");
});
