import { test } from "node:test";
import assert from "node:assert/strict";
import { parseChangelogMarkdown } from "../script/seed-changelog";

const SAMPLE = `# CowboyMedia Changelog

---

## Version 2.0 — April 8, 2026

A major update.

### Two-Way Messaging
- **Conversational messaging** — chat in real time.
- Typing indicators.

---

## Version 1.5 — January 1, 2026

- Bug fixes.

## Version 1.0 — December 1, 2025

Initial release.
`;

test("parseChangelogMarkdown: splits the file into one section per Version heading", () => {
  const sections = parseChangelogMarkdown(SAMPLE);
  assert.equal(sections.length, 3);
  assert.deepEqual(sections.map((s) => s.version), ["2.0", "1.5", "1.0"]);
});

test("parseChangelogMarkdown: parses the date out of the heading", () => {
  const sections = parseChangelogMarkdown(SAMPLE);
  assert.equal(sections[0].publishedAt.getUTCFullYear(), 2026);
  assert.equal(sections[0].publishedAt.getUTCMonth(), 3); // April = 3
});

test("parseChangelogMarkdown: keeps body content but strips horizontal rules", () => {
  const sections = parseChangelogMarkdown(SAMPLE);
  assert.ok(sections[0].body.includes("Conversational messaging"));
  assert.ok(!sections[0].body.includes("---"));
});

test("parseChangelogMarkdown: tolerates a missing date on the heading", () => {
  const md = "## Version 9.9\n\nNo date here.";
  const sections = parseChangelogMarkdown(md);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].version, "9.9");
  assert.ok(sections[0].publishedAt instanceof Date);
});

// ---------- seedChangelogEntries idempotency ----------
//
// Bypass the real DB by stubbing the storage module the seeder imports.
// We re-import the seeder after each stub so module state is fresh.

import { storage } from "../server/storage";

type FakeRow = { version: string; status: string; bodyHtml: string };

function installFakeStorage(): { rows: Map<string, FakeRow> } {
  const rows = new Map<string, FakeRow>();
  // Replace the real methods with fakes; restore via the returned closure
  // would be ideal, but for a single test process we just leave them — every
  // other test that touches storage already uses its own DB or fakes.
  (storage as any).getChangelogEntry = async (v: string) => rows.get(v);
  (storage as any).createChangelogEntry = async (entry: FakeRow) => {
    rows.set(entry.version, entry);
    return { ...entry, createdAt: new Date(), updatedAt: new Date() };
  };
  return { rows };
}

test("seedChangelogEntries: first run inserts; second run is a no-op", async () => {
  // Lazy-import inside the test so the stubbed storage is in place.
  const { seedChangelogEntries } = await import("../script/seed-changelog");
  const { rows } = installFakeStorage();

  // Make sure the seeder finds CHANGELOG.md — it lives in cwd which is
  // the repo root in `npm test`.
  const first = await seedChangelogEntries();
  const insertedFirst = first.inserted;
  assert.ok(insertedFirst >= 1, "expected first run to insert at least one entry");
  assert.equal(rows.size, insertedFirst);

  const second = await seedChangelogEntries();
  assert.equal(second.inserted, 0, "second run must not re-insert anything");
  assert.equal(second.skipped, insertedFirst, "second run must skip every existing entry");
  assert.equal(rows.size, insertedFirst, "row count must not change");
});
