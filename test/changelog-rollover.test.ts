import { test } from "node:test";
import assert from "node:assert/strict";
import {
  planChangelogRollover,
  isRollingDraftVersion,
  ROLLING_DRAFT_VERSION,
  type RolloverInput,
} from "../shared/changelog-rollover";

function plan(overrides: Partial<RolloverInput>) {
  return planChangelogRollover({
    rollingExists: false,
    appVersionHasEntry: false,
    appVersionIsLegacyDraft: false,
    ...overrides,
  });
}

test("isRollingDraftVersion: only the sentinel matches", () => {
  assert.equal(isRollingDraftVersion(ROLLING_DRAFT_VERSION), true);
  assert.equal(isRollingDraftVersion("7.0"), false);
  assert.equal(isRollingDraftVersion(""), false);
});

test("fresh DB (no rolling draft, no app entry): opens a rolling draft only", () => {
  const a = plan({ rollingExists: false, appVersionHasEntry: false });
  assert.deepEqual(a, {
    adoptLegacyDraft: false,
    createRollingDraft: true,
    promoteRollingDraft: false,
  });
});

test("first boot under new model with a legacy in-progress draft: adopt it + open a rolling draft", () => {
  const a = plan({
    rollingExists: false,
    appVersionHasEntry: true,
    appVersionIsLegacyDraft: true,
  });
  assert.equal(a.adoptLegacyDraft, true);
  assert.equal(a.createRollingDraft, true);
  // Adopting the legacy draft is NOT a promotion — the rolling draft never existed.
  assert.equal(a.promoteRollingDraft, false);
});

test("legacy published entry for the version (not a draft): no adopt, just open a rolling draft", () => {
  const a = plan({
    rollingExists: false,
    appVersionHasEntry: true,
    appVersionIsLegacyDraft: false,
  });
  assert.equal(a.adoptLegacyDraft, false);
  assert.equal(a.createRollingDraft, true);
  assert.equal(a.promoteRollingDraft, false);
});

test("version bump (rolling draft exists, version not yet stamped): promote + reopen", () => {
  const a = plan({ rollingExists: true, appVersionHasEntry: false });
  assert.equal(a.promoteRollingDraft, true);
  // createRollingDraft is false here; storage reopens a fresh draft because promote fired.
  assert.equal(a.createRollingDraft, false);
  assert.equal(a.adoptLegacyDraft, false);
});

test("same-version reboot (rolling draft exists, version already stamped): no-op", () => {
  const a = plan({ rollingExists: true, appVersionHasEntry: true });
  assert.deepEqual(a, {
    adoptLegacyDraft: false,
    createRollingDraft: false,
    promoteRollingDraft: false,
  });
});

test("idempotent: a never manufactures an empty awaiting-publish on a freshly created rolling draft", () => {
  // If the rolling draft was only just created this boot (rollingExists=false),
  // promote must not fire even when the version has no entry yet.
  const a = plan({ rollingExists: false, appVersionHasEntry: false });
  assert.equal(a.promoteRollingDraft, false);
});
