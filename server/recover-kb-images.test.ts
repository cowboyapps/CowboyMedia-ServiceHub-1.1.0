import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRecoverySelection } from "../script/recover-kb-images";

// ---------- computeRecoverySelection ----------
// The set-difference at the heart of the KB-image recovery script. It decides
// which blobs get written into a LIVE production DB during a sensitive recovery,
// so the "referenced ∩ missing, then missing ∩ in-backup" logic is exercised
// here without touching either pg.Pool:
//   missing      = referenced − present-in-live
//   recoverable  = missing ∩ present-in-backup
//   stillMissing = missing − present-in-backup

test("nothing referenced → every output is empty", () => {
  const sel = computeRecoverySelection([], ["a.png", "b.png"], ["a.png", "b.png"]);
  assert.deepEqual(sel, {
    referenced: [],
    missing: [],
    recoverable: [],
    stillMissing: [],
  });
});

test("everything referenced is already present in live → nothing to recover", () => {
  const sel = computeRecoverySelection(
    ["a.png", "b.png"],
    ["a.png", "b.png"],
    ["a.png", "b.png"],
  );
  assert.deepEqual(sel.missing, []);
  assert.deepEqual(sel.recoverable, []);
  assert.deepEqual(sel.stillMissing, []);
});

test("some missing and in backup → recoverable; present ones are excluded", () => {
  const sel = computeRecoverySelection(
    ["present.png", "gone-1.png", "gone-2.png"],
    ["present.png"],
    ["gone-1.png", "gone-2.png", "unrelated.png"],
  );
  assert.deepEqual(sel.missing, ["gone-1.png", "gone-2.png"]);
  assert.deepEqual(sel.recoverable, ["gone-1.png", "gone-2.png"]);
  assert.deepEqual(sel.stillMissing, []);
});

test("some missing but NOT in backup → stillMissing, never recoverable", () => {
  const sel = computeRecoverySelection(
    ["gone-1.png", "gone-2.png"],
    [],
    ["gone-1.png"],
  );
  assert.deepEqual(sel.missing, ["gone-1.png", "gone-2.png"]);
  assert.deepEqual(sel.recoverable, ["gone-1.png"]);
  assert.deepEqual(sel.stillMissing, ["gone-2.png"]);
});

test("missing splits cleanly across recoverable and stillMissing (no overlap, covers all)", () => {
  const sel = computeRecoverySelection(
    ["in-backup.png", "not-in-backup.png", "also-in-backup.png"],
    [],
    ["in-backup.png", "also-in-backup.png"],
  );
  assert.deepEqual(sel.recoverable, ["in-backup.png", "also-in-backup.png"]);
  assert.deepEqual(sel.stillMissing, ["not-in-backup.png"]);
  assert.deepEqual(
    [...sel.recoverable, ...sel.stillMissing].sort(),
    [...sel.missing].sort(),
  );
});

test("referenced is de-duplicated, preserving first-seen order", () => {
  const sel = computeRecoverySelection(
    ["z.png", "a.png", "z.png", "a.png"],
    [],
    ["a.png", "z.png"],
  );
  assert.deepEqual(sel.referenced, ["z.png", "a.png"]);
  assert.deepEqual(sel.missing, ["z.png", "a.png"]);
  assert.deepEqual(sel.recoverable, ["z.png", "a.png"]);
});

test("a backup blob that nothing references is ignored (never invents recoveries)", () => {
  const sel = computeRecoverySelection(
    ["wanted.png"],
    [],
    ["wanted.png", "stranger-1.png", "stranger-2.png"],
  );
  assert.deepEqual(sel.recoverable, ["wanted.png"]);
  assert.deepEqual(sel.stillMissing, []);
});
