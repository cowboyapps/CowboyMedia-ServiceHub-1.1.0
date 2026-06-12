// Background poller that pushes/emails a customer about WHMCS service lifecycle
// events — a service approaching renewal, getting suspended, or being
// reactivated (unsuspended). Mirrors server/whmcs-invoice-notifier.ts.
//
// WHMCS products are read-on-demand (never stored) and there is no WHMCS webhook
// today, so the only way to learn "this service was just suspended / is renewing
// soon" out-of-band is to periodically list each linked customer's products and
// diff them against a per-(user, service) marker (whmcs_service_notifications)
// holding the last-seen status and the last renewal date we reminded about.
//
// Safety / no-op contract (identical to the invoice notifier):
//   - No-op when WHMCS is unconfigured or disabled (getConfig().active=false).
//   - No-op for users with no linked WHMCS client id.
//   - Skips a user cleanly when WHMCS is unreachable for them (no marker write),
//     so events are retried next pass. This is also what makes the feature
//     degrade cleanly while the WHMCS API role still lacks product-read
//     permission — every list comes back `unreachable`, nothing is written.
//   - The FIRST time a service is seen its state is recorded SILENTLY (baseline)
//     so enabling the feature doesn't blast customers about pre-existing states.
//   - De-duplicated via the persisted marker: a status transition fires once per
//     edge; a renewal reminder fires once per billing cycle.
//   - Quiet-hours aware: when a customer wants the alert but it's currently quiet
//     hours, the relevant marker field is NOT advanced, so the next
//     post-quiet-hours pass re-delivers it.

import {
  planServiceNotifications,
  type ServiceNotifyCandidate,
  type ServiceMarker,
  type ServiceMarkerMap,
  type ServiceEventKind,
} from "@shared/whmcs-service-notify";

const POLL_INTERVAL_MS = 5 * 60_000;
// Notify when an active service's next due date is within this many days. Day
// granularity (WHMCS list payloads carry YYYY-MM-DD).
export const RENEW_SOON_DAYS = 7;

export type NotifierService = ServiceNotifyCandidate;

export interface ServiceNotifierUser {
  id: string;
  email: string | null;
  fullName: string;
  whmcsClientId: number | null;
  notificationPrefs: unknown;
  role: string | null;
}

export interface WhmcsServiceNotifierDeps {
  /** Whether WHMCS is configured + enabled, plus the resolved base URL. */
  getConfig: () => Promise<{ active: boolean; baseUrl: string | null }>;
  /** All ServiceHub users linked to a WHMCS client (whmcsClientId set). */
  getLinkedUsers: () => Promise<ServiceNotifierUser[]>;
  /** List a client's WHMCS services/products (read-on-demand). */
  loadServices: (
    clientId: number,
    baseUrl: string | null,
  ) => Promise<{ services: NotifierService[]; unreachable: boolean }>;
  /** Per-(user) map of WHMCS service id -> its marker. */
  getMarkers: (userId: string) => Promise<ServiceMarkerMap>;
  /** Persist the marker for `userId` + `serviceId`. */
  recordMarker: (userId: string, serviceId: number, marker: ServiceMarker) => Promise<void>;
  /**
   * Create the in-app (bell) notification row for this event and return its id
   * (or null on failure). Decoupled from push so email-only users still get a
   * bell entry. Never throws.
   */
  createInApp: (
    user: ServiceNotifierUser,
    service: NotifierService,
    kind: ServiceEventKind,
    baseUrl: string | null,
  ) => Promise<string | null>;
  /**
   * Fire a push notification (caller decides delivery; never throws). When an
   * in-app row already exists (`notificationId`), reuse it instead of creating
   * a second bell row.
   */
  sendPush: (
    user: ServiceNotifierUser,
    service: NotifierService,
    kind: ServiceEventKind,
    baseUrl: string | null,
    notificationId: string | null,
  ) => void;
  /** Fire an email (caller decides delivery; never throws). */
  sendEmail: (
    user: ServiceNotifierUser,
    service: NotifierService,
    kind: ServiceEventKind,
    baseUrl: string | null,
  ) => void;
  /** Does the user want push for this category right now (folds quiet hours)? */
  wantsPush: (user: ServiceNotifierUser, categoryKey: string) => boolean;
  /** Does the user want email for this category right now (folds quiet hours)? */
  wantsEmail: (user: ServiceNotifierUser, categoryKey: string) => boolean;
  /**
   * Are this category's channel prefs on at all, IGNORING quiet hours? Used to
   * tell "the customer turned this off" (advance the marker, don't replay later)
   * apart from "quiet hours suppressed it right now" (skip the marker, retry).
   */
  prefsOn: (user: ServiceNotifierUser, categoryKey: string) => boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

/** Renewal reminders and status changes are separate opt-in categories. */
export function categoryForKind(kind: ServiceEventKind): string {
  return kind === "renewal" ? "whmcs_service_renewal" : "whmcs_service_status";
}

export interface ServiceNotifyPassResult {
  active: boolean;
  usersScanned: number;
  eventsNotified: number;
}

/** Current calendar date (UTC) as YYYY-MM-DD. */
function todayString(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Run one notify pass over all linked customers. Pure of timers — call it from
 * a setInterval (production) or directly (tests). Never throws: a failure for
 * one user is logged and the pass continues for the rest.
 */
export async function runWhmcsServiceNotifyPass(deps: WhmcsServiceNotifierDeps): Promise<ServiceNotifyPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  const today = todayString(now);

  let usersScanned = 0;
  let eventsNotified = 0;

  let config: { active: boolean; baseUrl: string | null };
  try {
    config = await deps.getConfig();
  } catch (e) {
    console.error("[whmcs-service-notifier] getConfig failed:", (e as Error)?.message);
    return { active: false, usersScanned, eventsNotified };
  }
  if (!config.active) return { active: false, usersScanned, eventsNotified };

  let users: ServiceNotifierUser[];
  try {
    users = await deps.getLinkedUsers();
  } catch (e) {
    console.error("[whmcs-service-notifier] getLinkedUsers failed:", (e as Error)?.message);
    return { active: true, usersScanned, eventsNotified };
  }

  for (const user of users) {
    if (!user.whmcsClientId) continue;
    usersScanned++;
    try {
      const list = await deps.loadServices(user.whmcsClientId, config.baseUrl);
      // Don't write markers when WHMCS was unreachable (incl. while the API role
      // still lacks product-read perm) — retry next pass.
      if (list.unreachable) continue;

      const markers = await deps.getMarkers(user.id);
      const plans = planServiceNotifications(list.services, markers, today, RENEW_SOON_DAYS);

      for (const plan of plans) {
        const { service } = plan;

        // First sighting: record the current state silently so we never blast
        // about pre-existing suspensions / renewals.
        if (plan.isBaseline) {
          await deps.recordMarker(user.id, service.id, {
            lastSeenStatus: plan.status,
            lastRenewalNotified: plan.renewalDue ? service.nextDueDate : null,
          });
          continue;
        }

        const prev = plan.prev!;
        // Start from the previous marker; advance each field only as events are
        // accepted (delivered or prefs-off). A non-notifying status change
        // (e.g. active->terminated, pending->active) still advances lastSeenStatus
        // so future transitions compute from the truth.
        let newStatus = plan.statusEvent ? prev.lastSeenStatus : plan.status;
        let newRenewal = prev.lastRenewalNotified;

        const events: ServiceEventKind[] = [];
        if (plan.statusEvent) events.push(plan.statusEvent);
        if (plan.renewalEvent) events.push("renewal");

        for (const kind of events) {
          const categoryKey = categoryForKind(kind);
          const wantsPush = deps.wantsPush(user, categoryKey);
          const wantsEmail = !!user.email && deps.wantsEmail(user, categoryKey);
          const delivered = wantsPush || wantsEmail;

          // Create the bell row whenever the customer would be notified through
          // any channel — decoupled from push so email-only users still get one.
          let notificationId: string | null = null;
          if (delivered) notificationId = await deps.createInApp(user, service, kind, config.baseUrl);
          if (wantsPush) deps.sendPush(user, service, kind, config.baseUrl, notificationId);
          if (wantsEmail) deps.sendEmail(user, service, kind, config.baseUrl);

          // Marker rule (mirrors the invoice notifier): advance the relevant
          // marker field when we delivered OR the customer has this category
          // switched off (so toggling it on later doesn't replay). SKIP the
          // advance when prefs are on but quiet hours suppressed delivery — the
          // next post-quiet-hours pass retries.
          const suppressedByQuietHours = !delivered && deps.prefsOn(user, categoryKey);
          if (!suppressedByQuietHours) {
            if (kind === "renewal") newRenewal = service.nextDueDate;
            else newStatus = plan.status;
          }
          if (delivered) eventsNotified++;
        }

        // Persist only when something changed (covers accepted events AND silent
        // non-notifying status advances), to avoid needless write churn.
        if (newStatus !== prev.lastSeenStatus || newRenewal !== prev.lastRenewalNotified) {
          await deps.recordMarker(user.id, service.id, {
            lastSeenStatus: newStatus,
            lastRenewalNotified: newRenewal,
          });
        }
      }
    } catch (e) {
      console.error(`[whmcs-service-notifier] user ${user.id} pass failed:`, (e as Error)?.message);
    }
  }

  return { active: true, usersScanned, eventsNotified };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the recurring notifier. Runs one pass shortly after boot. */
export function startWhmcsServiceNotifier(deps: WhmcsServiceNotifierDeps): void {
  if (timer) return;
  timer = setInterval(() => {
    void runWhmcsServiceNotifyPass(deps).catch((e) =>
      console.error("[whmcs-service-notifier] pass error:", (e as Error)?.message),
    );
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  void runWhmcsServiceNotifyPass(deps).catch((e) =>
    console.error("[whmcs-service-notifier] initial pass error:", (e as Error)?.message),
  );
}

export function stopWhmcsServiceNotifier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
