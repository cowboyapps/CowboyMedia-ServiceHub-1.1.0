// Pure suppression/decision logic for monitor-driven alert-draft suggestions.
// Extracted from the polling loop so it can be unit-tested without timers or
// storage: given the monitor's existing drafts + whether an active alert already
// covers the linked service, decide what (if anything) to do. Drafts are ONLY
// suggestions — nothing here (or anywhere) auto-posts an alert.

export const OUTAGE_DRAFT_COOLDOWN_MS = 60 * 60 * 1000; // one outage episode per hour of flapping

export interface DraftLike {
  id: string;
  kind: string; // "outage" | "recovery"
  status: string; // "pending" | "published" | "dismissed" | "superseded"
  createdAt: Date | string;
}

export type OutageDraftDecision =
  | { action: "create" }
  // A pending outage draft already exists — same episode; just re-point it at
  // the latest incident instead of spamming a new card.
  | { action: "attach"; draftId: string }
  | { action: "skip"; reason: "cooldown" | "active-alert" };

export type RecoveryDraftDecision = {
  // Pending outage drafts whose outage ended before anyone acted — mark superseded.
  supersedeDraftIds: string[];
  // Create a pending recovery draft pointing at this alert (null = don't create).
  createRecoveryForAlertId: string | null;
};

const ms = (d: Date | string) => new Date(d).getTime();

/**
 * Down-transition decision. Also used when the monitor flaps down again while a
 * recovery draft is pending — the caller must supersede pending recovery drafts
 * for this monitor first (see decideOutageSupersedesRecovery).
 */
export function decideOutageDraft(input: {
  now: Date;
  monitorDrafts: DraftLike[]; // all drafts for this monitor
  serviceHasActiveAlert: boolean; // a non-resolved alert already covers the linked service
  cooldownMs?: number;
}): OutageDraftDecision {
  const cooldown = input.cooldownMs ?? OUTAGE_DRAFT_COOLDOWN_MS;
  const outageDrafts = input.monitorDrafts.filter(d => d.kind === "outage");

  const pending = outageDrafts.find(d => d.status === "pending");
  if (pending) return { action: "attach", draftId: pending.id };

  if (input.serviceHasActiveAlert) return { action: "skip", reason: "active-alert" };

  // Cooldown covers EVERY outage draft regardless of status. Superseded (the
  // blip self-resolved before anyone acted) and dismissed (an admin explicitly
  // declined) drafts still mark the episode — otherwise a down→up→down flap
  // would mint a fresh card every cycle.
  const recent = outageDrafts.some(
    d => input.now.getTime() - ms(d.createdAt) < cooldown,
  );
  if (recent) return { action: "skip", reason: "cooldown" };

  return { action: "create" };
}

/** Recovery drafts for this monitor that a fresh outage makes stale. */
export function decideOutageSupersedesRecovery(monitorDrafts: DraftLike[]): string[] {
  return monitorDrafts.filter(d => d.kind === "recovery" && d.status === "pending").map(d => d.id);
}

/**
 * Up-transition decision.
 * - Pending (never-published) outage drafts → superseded: the blip resolved
 *   itself before anyone acted, so don't prompt to publish an outage alert.
 * - If an outage draft was published (its alert is still active) or another
 *   active alert covers the service → suggest an update/resolve draft, unless a
 *   pending recovery draft already exists.
 */
export function decideRecoveryDraft(input: {
  monitorDrafts: DraftLike[];
  // Alert id from a published outage draft for this monitor whose alert is
  // still active, or an active alert covering the monitor's service (caller
  // resolves which). Null when no active alert relates to this outage.
  activeRelatedAlertId: string | null;
}): RecoveryDraftDecision {
  const supersedeDraftIds = input.monitorDrafts
    .filter(d => d.kind === "outage" && d.status === "pending")
    .map(d => d.id);

  const hasPendingRecovery = input.monitorDrafts.some(d => d.kind === "recovery" && d.status === "pending");
  const createRecoveryForAlertId = !hasPendingRecovery && input.activeRelatedAlertId ? input.activeRelatedAlertId : null;

  return { supersedeDraftIds, createRecoveryForAlertId };
}

/** Human-friendly downtime like "2h 5m" / "3m" / "45s". */
export function formatDowntime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
