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

  // --- "New service is ready" hooks (Task #474) -------------------------------
  // All four must be supplied together to enable the feature; when any is
  // missing the notifier behaves exactly as before (no ready detection). Kept
  // optional so existing call sites / tests don't break.
  /** The customer's unfulfilled pending orders (oldest first), or [] / throws. */
  getPendingOrders?: (userId: string) => Promise<PendingOrder[]>;
  /** Mark a pending order fulfilled so the ready message never repeats. */
  markPendingOrderFulfilled?: (orderId: string) => Promise<void>;
  /**
   * Create the in-app (bell) row for the ready message and return its id (null
   * on failure). In-app is the primary channel for "ready" so this fires
   * regardless of push prefs. Never throws.
   */
  createReadyInApp?: (
    user: ServiceNotifierUser,
    service: NotifierService,
    baseUrl: string | null,
  ) => Promise<string | null>;
  /** Fire the ready push (caller decides delivery; never throws). */
  sendReadyPush?: (
    user: ServiceNotifierUser,
    service: NotifierService,
    baseUrl: string | null,
    notificationId: string | null,
  ) => void;

  // --- "New service added" hooks (Task #567) ---------------------------------
  // Detects a BRAND-NEW service (no prior marker) on an ALREADY-baselined
  // customer — e.g. one ordered directly in WHMCS, outside the ServiceHub store.
  // All six must be supplied together to enable the feature; when any is missing
  // the notifier behaves exactly as before (every first-sighting is a silent
  // baseline, no "added" detection). Kept optional so existing call sites/tests
  // don't break.
  /** Has this customer completed a baseline pass? false => first-ever poll. */
  getServiceBaseline?: (userId: string) => Promise<boolean>;
  /** Mark this customer baselined after a full reachable first pass. */
  recordServiceBaseline?: (userId: string) => Promise<void>;
  /**
   * Persist the one-time popup announcement (idempotent on (user, service)).
   * Returns false on failure so the caller leaves the service unmarked + retries.
   */
  recordAddedAnnouncement?: (user: ServiceNotifierUser, service: NotifierService) => Promise<boolean>;
  /**
   * Create the in-app (bell) row for the "added" message and return its id (null
   * on failure). In-app is a PRIMARY channel for "added" so it fires regardless
   * of push prefs. Never throws.
   */
  createAddedInApp?: (
    user: ServiceNotifierUser,
    service: NotifierService,
    baseUrl: string | null,
  ) => Promise<string | null>;
  /** Fire the "added" push (caller decides delivery; never throws). */
  sendAddedPush?: (
    user: ServiceNotifierUser,
    service: NotifierService,
    baseUrl: string | null,
    notificationId: string | null,
  ) => void;
  /** Real-time WebSocket nudge so the popup can surface without a reload. */
  broadcastAdded?: (user: ServiceNotifierUser, service: NotifierService) => void;
}

/** A customer's recorded pending order, matched to a new service by product id. */
export interface PendingOrder {
  id: string;
  whmcsProductId: number;
}

/** Renewal reminders and status changes are separate opt-in categories. */
export function categoryForKind(kind: ServiceEventKind): string {
  return kind === "renewal" ? "whmcs_service_renewal" : "whmcs_service_status";
}

/** Opt-in push category for the "new service is ready" message. */
export const SERVICE_READY_CATEGORY_KEY = "whmcs_service_ready";

/** Opt-in push category for the "new service added" message. */
export const SERVICE_ADDED_CATEGORY_KEY = "whmcs_service_added";

export interface ServiceNotifyPassResult {
  active: boolean;
  usersScanned: number;
  eventsNotified: number;
  /** Count of "new service is ready" messages fired this pass. */
  readyNotified: number;
  /** Count of "new service added" announcements fired this pass. */
  addedNotified: number;
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
  let readyNotified = 0;
  let addedNotified = 0;

  // The "new service is ready" feature is active only when ALL its hooks are
  // wired (production). Tests of the lifecycle events leave them off.
  const readyEnabled = !!(
    deps.getPendingOrders &&
    deps.markPendingOrderFulfilled &&
    deps.createReadyInApp &&
    deps.sendReadyPush
  );

  // The "new service added" feature is active only when ALL its hooks are wired
  // (production). Lifecycle-only / ready-only tests leave them off, so every
  // first-sighting stays a silent baseline (unchanged behavior).
  const addedEnabled = !!(
    deps.getServiceBaseline &&
    deps.recordServiceBaseline &&
    deps.recordAddedAnnouncement &&
    deps.createAddedInApp &&
    deps.sendAddedPush &&
    deps.broadcastAdded
  );

  let config: { active: boolean; baseUrl: string | null };
  try {
    config = await deps.getConfig();
  } catch (e) {
    console.error("[whmcs-service-notifier] getConfig failed:", (e as Error)?.message);
    return { active: false, usersScanned, eventsNotified, readyNotified, addedNotified };
  }
  if (!config.active) return { active: false, usersScanned, eventsNotified, readyNotified, addedNotified };

  let users: ServiceNotifierUser[];
  try {
    users = await deps.getLinkedUsers();
  } catch (e) {
    console.error("[whmcs-service-notifier] getLinkedUsers failed:", (e as Error)?.message);
    return { active: true, usersScanned, eventsNotified, readyNotified, addedNotified };
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

      // Pending orders for the ready-detection (Task #474). Fetched once per
      // user; consumed in-pass so two new same-pid services don't grab one order.
      // A fetch failure degrades cleanly (no ready this pass, retry next).
      let pending: PendingOrder[] | null = null;
      if (readyEnabled) {
        try {
          pending = await deps.getPendingOrders!(user.id);
        } catch (e) {
          console.error(`[whmcs-service-notifier] getPendingOrders ${user.id} failed:`, (e as Error)?.message);
          pending = null;
        }
      }

      // Whether this customer has already completed a baseline pass. On their
      // very FIRST poll (not yet baselined) every first-sighting is recorded
      // SILENTLY so linking an existing account / enabling the feature never
      // blasts them about pre-existing services. After that, a first-sighting is
      // a genuine addition. Read once per user; the marker is written after the
      // whole pass (below) only when it was reachable end-to-end.
      let customerBaselined = true;
      if (addedEnabled) {
        try {
          customerBaselined = await deps.getServiceBaseline!(user.id);
        } catch (e) {
          console.error(`[whmcs-service-notifier] getServiceBaseline ${user.id} failed:`, (e as Error)?.message);
          // Fail safe: treat as NOT baselined so we silently baseline rather than
          // risk falsely announcing pre-existing services as "added".
          customerBaselined = false;
        }
      }

      // Fire the one-time "a new service was added to your account" announcement
      // for a brand-new service (no prior marker) on a customer we have ALREADY
      // baselined — e.g. one ordered directly in WHMCS, outside the ServiceHub
      // store. Distinct from "ready": "added" fires on the FIRST sighting (no
      // marker); "ready" fires on a later pending->active transition (has a
      // marker). To guarantee a single service never fires BOTH, when "added"
      // fires we consume + fulfill any matching pending order so the "ready" path
      // (which needs an unfulfilled order) can't replay for the same provision on
      // a later pass. The persisted announcement row + bell are PRIMARY channels
      // (fire regardless of push prefs); push is gated on the opt-in category and
      // folds quiet hours. Returns true on full success (caller records the
      // baseline marker), false on a transient failure (announcement/bell create
      // failed) so the caller LEAVES the service unmarked and the next pass
      // retries the whole announcement.
      const fireAdded = async (p: typeof plans[number]): Promise<boolean> => {
        // Persist the one-time popup row FIRST (idempotent on (user, service), so
        // a retry never duplicates it). Bail on failure → retry next pass.
        const annOk = await deps.recordAddedAnnouncement!(user, p.service);
        if (!annOk) return false;
        // Bell row (primary channel). A null return is a transient failure: retry.
        const notificationId = await deps.createAddedInApp!(user, p.service, config.baseUrl);
        if (notificationId == null) return false;
        // Consume any matching pending order so the store "ready" path can't ALSO
        // fire for this provision on a later pass.
        const pid = p.service.pid;
        if (pid != null && pending && pending.length > 0) {
          const idx = pending.findIndex((o) => o.whmcsProductId === pid);
          if (idx !== -1) {
            const order = pending[idx];
            pending.splice(idx, 1);
            if (deps.markPendingOrderFulfilled) {
              try {
                await deps.markPendingOrderFulfilled(order.id);
              } catch (e) {
                console.error(`[whmcs-service-notifier] markPendingOrderFulfilled (added) failed:`, (e as Error)?.message);
              }
            }
          }
        }
        if (deps.wantsPush(user, SERVICE_ADDED_CATEGORY_KEY)) {
          deps.sendAddedPush!(user, p.service, config.baseUrl, notificationId);
        }
        deps.broadcastAdded!(user, p.service);
        addedNotified++;
        return true;
      };

      // Fire the one-time "your new service is ready" message ONLY when a service
      // we previously saw as PENDING flips to ACTIVE — i.e. WHMCS has just finished
      // provisioning a newly-ordered service — AND it matches an unfulfilled
      // pending order by product id. We deliberately DO NOT fire on first baseline:
      // an already-active service on its very first sighting is treated as
      // PRE-EXISTING, never a new provision. That keeps existing customers from
      // being falsely notified and stops a pending order being grabbed by the wrong
      // (pre-existing) service before the genuinely-new one appears. Unsuspend
      // (suspended->active) and re-enable (terminated/cancelled->active) are
      // existing services and never count. The fulfilled flag is the ultimate
      // cross-pass/restart dedup. In-app fires regardless of push prefs (it's the
      // primary channel); push is gated on the opt-in category.
      // Returns true when a ready notification was ATTEMPTED for a matching order
      // but the in-app create failed — the caller must then pin this service's
      // marker at "pending" (not advance it to "active") so the NEXT pass still
      // sees a pending->active transition and retries. Returning false means
      // either nothing to do or success; the marker may advance normally.
      const fireReadyIfNewProvision = async (p: typeof plans[number]): Promise<boolean> => {
        if (!readyEnabled || !pending || pending.length === 0) return false;
        if (p.status !== "active") return false;
        // Strictly a pending->active provisioning transition. Never baseline.
        if (p.isBaseline || p.prev!.lastSeenStatus !== "pending") return false;
        const pid = p.service.pid;
        if (pid == null) return false;
        const idx = pending.findIndex((o) => o.whmcsProductId === pid);
        if (idx === -1) return false;
        const order = pending[idx];

        // Create the in-app bell FIRST and only consume + fulfill the order once it
        // succeeds. If in-app creation fails (returns null), leave the order
        // unconsumed and unfulfilled AND signal the caller to keep the marker at
        // "pending" so the next pass retries — a transient failure must never
        // permanently swallow the ready notification (in-app is the primary
        // channel, so a lost bell row would mean the customer gets nothing).
        const notificationId = await deps.createReadyInApp!(user, p.service, config.baseUrl);
        if (notificationId == null) return true;
        pending.splice(idx, 1); // consume so a second new service won't reuse it
        if (deps.wantsPush(user, SERVICE_READY_CATEGORY_KEY)) {
          deps.sendReadyPush!(user, p.service, config.baseUrl, notificationId);
        }
        await deps.markPendingOrderFulfilled!(order.id);
        readyNotified++;
        return false;
      };

      for (const plan of plans) {
        const { service } = plan;

        // First sighting: record the current state silently so we never blast
        // about pre-existing suspensions / renewals. An already-active service on
        // its first sighting is treated as PRE-EXISTING (never a new provision) —
        // "ready" is fired only on the later pending->active transition, so we do
        // NOT check ready here. EXCEPTION (Task #567): when the feature is wired
        // AND this customer has already been baselined, a first-sighting service
        // is a genuine ADDITION (ordered directly in WHMCS) → announce it. On the
        // customer's first-ever poll (not yet baselined) we still baseline
        // silently.
        if (plan.isBaseline) {
          if (addedEnabled && customerBaselined) {
            const fired = await fireAdded(plan);
            // On a transient failure leave the service UNMARKED so the next pass
            // retries the announcement (the bell create or row insert failed).
            if (!fired) continue;
          }
          await deps.recordMarker(user.id, service.id, {
            lastSeenStatus: plan.status,
            lastRenewalNotified: plan.renewalDue ? service.nextDueDate : null,
          });
          continue;
        }

        // pending->active (provisioning finished after we'd already baselined the
        // service as Pending) is also a new provision — check before the events.
        const readyRetryNeeded = await fireReadyIfNewProvision(plan);

        const prev = plan.prev!;
        // Start from the previous marker; advance each field only as events are
        // accepted (delivered or prefs-off). A non-notifying status change
        // (e.g. active->terminated, pending->active) still advances lastSeenStatus
        // so future transitions compute from the truth. EXCEPTION: when a ready
        // notification was attempted but its in-app create failed, pin the marker
        // at the previous status ("pending") so the next pass still sees the
        // pending->active transition and retries the ready notification.
        let newStatus = plan.statusEvent || readyRetryNeeded ? prev.lastSeenStatus : plan.status;
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

      // After a full reachable pass, mark this customer baselined so subsequent
      // first-sighting services are treated as genuine additions rather than
      // silent baselines. Runs even when the customer has zero services. Only
      // reached when nothing above threw (a mid-pass failure skips this and the
      // whole pass is retried next time).
      if (addedEnabled && !customerBaselined) {
        await deps.recordServiceBaseline!(user.id);
      }
    } catch (e) {
      console.error(`[whmcs-service-notifier] user ${user.id} pass failed:`, (e as Error)?.message);
    }
  }

  return { active: true, usersScanned, eventsNotified, readyNotified, addedNotified };
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
