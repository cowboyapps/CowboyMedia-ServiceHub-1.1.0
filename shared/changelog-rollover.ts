// Rolling-draft changelog model.
//
// Instead of one draft row per APP_VERSION, the changelog now has a single
// always-open "rolling draft" that every append lands in. It lives under a
// reserved sentinel version (never a real release number) and carries the
// status "collecting". When the version number changes and the app reboots,
// the collected notes get stamped with the new APP_VERSION and flipped to
// "awaiting_publish"; a fresh empty rolling draft opens to keep collecting.
// Publishing — the gate that fires the customer "Welcome to version X"
// popup — is only ever possible on an "awaiting_publish" entry, so it can
// only happen as part of a version change, never mid-version.

// Reserved PK for the single rolling draft. Chosen so it can never collide
// with a real semantic version string and never renders to customers
// (customer-facing views only read status === "published").
export const ROLLING_DRAFT_VERSION = "__rolling_draft__";

// Status lifecycle:
//   collecting       — the single open rolling draft; always accepts appends,
//                      never publishable.
//   awaiting_publish — version-stamped notes, frozen for the rolling flow but
//                      still editable by an admin; the only publishable state.
//   published        — live history shown to customers.
//   draft            — legacy per-version status from the old model; adopted
//                      into the new lifecycle on first boot (see planner).
export type ChangelogStatus =
  | "collecting"
  | "awaiting_publish"
  | "published"
  | "draft";

export function isRollingDraftVersion(version: string): boolean {
  return version === ROLLING_DRAFT_VERSION;
}

// What the boot-time reconciler should do, computed purely so it can be
// unit-tested without a database. The storage layer gathers the three input
// facts, calls this, then executes the returned actions.
export interface RolloverInput {
  // A "collecting" rolling-draft row already exists.
  rollingExists: boolean;
  // APP_VERSION has a row of any status (excluding the sentinel rolling draft).
  appVersionHasEntry: boolean;
  // That APP_VERSION row (if any) is a legacy "draft" left over from the old
  // one-row-per-version model.
  appVersionIsLegacyDraft: boolean;
}

export interface RolloverActions {
  // Migration: flip the legacy APP_VERSION draft to "awaiting_publish" so it
  // stays publishable as its own version (no number bump happened).
  adoptLegacyDraft: boolean;
  // Open a fresh empty rolling draft under the sentinel version.
  createRollingDraft: boolean;
  // Stamp the existing rolling draft with APP_VERSION, flip it to
  // "awaiting_publish", and open a new rolling draft in its place.
  promoteRollingDraft: boolean;
}

export function planChangelogRollover(input: RolloverInput): RolloverActions {
  // Migration only fires the very first boot under the new model: there is
  // no rolling draft yet but APP_VERSION still has its legacy in-progress
  // draft. Adopt it as awaiting_publish so its notes stay tied to their own
  // version number and remain publishable.
  const adoptLegacyDraft = !input.rollingExists && input.appVersionIsLegacyDraft;

  // Always guarantee exactly one open rolling draft.
  const createRollingDraft = !input.rollingExists;

  // Promote only when a rolling draft has actually been collecting (it
  // existed at boot) and the current version has not been stamped yet — i.e.
  // the version number was bumped. We never promote a rolling draft we just
  // created this boot (fresh DB / migration), so a brand-new install does not
  // immediately manufacture an empty awaiting-publish entry.
  const promoteRollingDraft = input.rollingExists && !input.appVersionHasEntry;

  return { adoptLegacyDraft, createRollingDraft, promoteRollingDraft };
}
