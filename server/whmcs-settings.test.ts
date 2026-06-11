import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWhmcsPatch } from "./whmcs-settings";

// Pure normalization contract: adminUsername must survive a PATCH (trimmed, or
// nulled when blank). The storage layer must persist whatever this produces —
// see the DB round-trip below which guards the regression where adminUsername
// was silently dropped on write (breaking admin ticket replies).
test("normalizeWhmcsPatch: trims adminUsername and nulls blank/non-string", () => {
  assert.equal(normalizeWhmcsPatch({ adminUsername: "  support  " }).adminUsername, "support");
  assert.equal(normalizeWhmcsPatch({ adminUsername: "   " }).adminUsername, null);
  assert.equal(normalizeWhmcsPatch({ adminUsername: null as any }).adminUsername, null);
  // Absent key is not touched (partial patch semantics).
  assert.equal("adminUsername" in normalizeWhmcsPatch({ enabled: true }), false);
});

// DB round-trip: prove updateWhmcsSettings actually persists adminUsername and
// getWhmcsSettings reads it back. Restores the original value so the dev/CI
// singleton is left untouched. Skips cleanly when no database is configured.
test("updateWhmcsSettings: adminUsername round-trips through the DB", async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip("DATABASE_URL not set");
    return;
  }
  const { storage } = await import("./storage");
  const before = await storage.getWhmcsSettings();
  const original = before?.adminUsername ?? null;
  try {
    const saved = await storage.updateWhmcsSettings({ adminUsername: "  test-staff  " });
    assert.equal(saved.adminUsername, "test-staff");
    const read = await storage.getWhmcsSettings();
    assert.equal(read?.adminUsername, "test-staff");

    const cleared = await storage.updateWhmcsSettings({ adminUsername: "   " });
    assert.equal(cleared.adminUsername, null);
  } finally {
    await storage.updateWhmcsSettings({ adminUsername: original });
  }
});
