import { test } from "node:test";
import assert from "node:assert/strict";
import type { ChangelogEntry } from "../shared/schema";
import { storage } from "../server/storage";

// publishChangelogEntry is the gate that fires the customer "Welcome to
// version X" popup. In the rolling-draft model it must accept ONLY a
// version-stamped "awaiting_publish" entry. The reject branches below all
// short-circuit before any DB write, so we can exercise them by stubbing only
// getChangelogEntry — no database required.

type GateStorage = {
  getChangelogEntry(version: string): Promise<ChangelogEntry | undefined>;
};

function row(status: ChangelogEntry["status"]): ChangelogEntry {
  const now = new Date();
  return {
    version: "9.9",
    title: "",
    bodyHtml: "<h3>New</h3><ul><li>thing</li></ul>",
    status,
    publishedAt: null,
    publishedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

function stub(entry: ChangelogEntry | undefined) {
  (storage as unknown as GateStorage).getChangelogEntry = async () => entry;
}

test("publishChangelogEntry: missing entry → undefined", async () => {
  stub(undefined);
  assert.equal(await storage.publishChangelogEntry("9.9", "u1"), undefined);
});

test("publishChangelogEntry: rolling draft (collecting) is never publishable", async () => {
  stub(row("collecting"));
  assert.equal(await storage.publishChangelogEntry("9.9", "u1"), undefined);
});

test("publishChangelogEntry: legacy draft is rejected (no runtime draft publish)", async () => {
  stub(row("draft"));
  assert.equal(await storage.publishChangelogEntry("9.9", "u1"), undefined);
});

test("publishChangelogEntry: already published is idempotent (returns existing, no re-publish)", async () => {
  const published = row("published");
  stub(published);
  const result = await storage.publishChangelogEntry("9.9", "u1");
  assert.equal(result, published);
});
