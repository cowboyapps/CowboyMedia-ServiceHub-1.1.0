import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeRecoverySelection,
  applyRecovery,
  type BlobRow,
} from "../script/recover-kb-images";

function blob(filename: string): BlobRow {
  return { filename, mimetype: "image/png", data: "ZGF0YQ==", created_at: null };
}

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

// ---------- applyRecovery ----------
// The `--apply` write loop, exercised against an injected `insertBlob` that
// stands in for the real `INSERT ... ON CONFLICT (filename) DO NOTHING`. The
// injected fn returns the row count the DB would report: 1 for a fresh insert,
// 0 when the row already existed and the conflict clause skipped it. This proves
// the idempotency promise (re-running never overwrites or duplicates) without a
// live DB.

test("every recoverable blob is inserted exactly once on a fresh run", async () => {
  const calls: string[] = [];
  const result = await applyRecovery(
    [blob("a.png"), blob("b.png"), blob("c.png")],
    async (r) => {
      calls.push(r.filename);
      return 1; // fresh insert
    },
  );
  assert.deepEqual(calls, ["a.png", "b.png", "c.png"]);
  assert.equal(result.inserted, 3);
  assert.equal(result.skipped, 0);
});

test("an already-present blob (ON CONFLICT) is counted as skipped, not re-inserted", async () => {
  // Simulate a re-run where every row already exists: ON CONFLICT DO NOTHING
  // returns rowCount 0 for each, so nothing is written.
  const result = await applyRecovery(
    [blob("a.png"), blob("b.png")],
    async () => 0,
  );
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 2);
});

test("mixed run: fresh inserts counted as inserted, conflicts counted as skipped", async () => {
  // a.png is new (rowCount 1), b.png already present (rowCount 0), c.png new.
  const present = new Set(["b.png"]);
  const result = await applyRecovery(
    [blob("a.png"), blob("b.png"), blob("c.png")],
    async (r) => (present.has(r.filename) ? 0 : 1),
  );
  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 1);
});

test("inserted + skipped always equals the number of recoverable rows", async () => {
  const rows = [blob("a.png"), blob("b.png"), blob("c.png"), blob("d.png")];
  const present = new Set(["a.png", "d.png"]);
  const result = await applyRecovery(rows, async (r) =>
    present.has(r.filename) ? 0 : 1,
  );
  assert.equal(result.inserted + result.skipped, rows.length);
  assert.equal(result.inserted, 2);
  assert.equal(result.skipped, 2);
});

test("no recoverable rows → nothing inserted, nothing skipped, no DB calls", async () => {
  let called = false;
  const result = await applyRecovery([], async () => {
    called = true;
    return 1;
  });
  assert.equal(called, false);
  assert.equal(result.inserted, 0);
  assert.equal(result.skipped, 0);
});
