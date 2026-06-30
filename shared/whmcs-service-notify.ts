// Pure, framework-free helpers for the background WHMCS "service lifecycle"
// notifier (mirrors shared/whmcs-invoice-notify.ts for invoices). Notifies a
// linked customer when one of their WHMCS services (products) is approaching its
// renewal date, gets suspended, or is reactivated (unsuspended).
//
// WHMCS products are read-on-demand (never stored) and there is no webhook, so a
// periodic poller (server/whmcs-service-notifier.ts) lists each linked
// customer's products and uses these helpers to diff the current state against a
// small per-(user, service) marker.
//
// Two kinds of dedup live side-by-side in one marker, because the two event
// families behave differently:
//   - Suspend / unsuspend are STATUS TRANSITIONS — we compare the current status
//     to `lastSeenStatus` and only fire on the edge (active->suspended,
//     suspended->active). The first time we ever see a service we record its
//     status SILENTLY (baseline) so enabling the feature doesn't blast customers
//     about pre-existing suspensions.
//   - Renewal is DATE-BASED and must re-fire every billing cycle — we remember
//     the `nextDueDate` we last reminded about in `lastRenewalNotified`; when
//     WHMCS advances the due date for the next cycle, the stored value differs
//     and the reminder fires again.

import { addDaysToDateString, daysUntilDue } from "./whmcs-invoice-notify";
import {
  renderNotification,
  type NotificationTemplateKey,
  type NotificationTemplateOverride,
} from "./notification-templates";

export type ServiceEventKind = "renewal" | "suspended" | "unsuspended";

export interface ServiceNotifyCandidate {
  /** WHMCS service id (tblhosting.id) — per-service unique, the marker key. */
  id: number;
  /** Product / service name for the notification copy. */
  name: string;
  /** Associated domain, if any (optional, used to disambiguate the copy). */
  domain?: string;
  /** Raw WHMCS status (Active / Suspended / Terminated / Pending / ...). */
  status: string;
  /** Next due / renewal date as YYYY-MM-DD, or null when WHMCS has none. */
  nextDueDate: string | null;
  /**
   * WHMCS product id (pid) this service was provisioned from (optional). Used by
   * the "new service is ready" notifier (Task #474) to match a brand-new active
   * service to the customer's unfulfilled pending order for the same product.
   */
  pid?: number;
}

/**
 * Per-(user, service) marker. `lastSeenStatus` drives suspend/unsuspend
 * transition dedup; `lastRenewalNotified` is the nextDueDate of the last
 * renewal reminder we sent (null = none yet), so renewal re-fires each cycle.
 */
export interface ServiceMarker {
  lastSeenStatus: string;
  lastRenewalNotified: string | null;
}

/** Map of WHMCS service id (string) -> its marker. */
export type ServiceMarkerMap = Record<string, ServiceMarker>;

export interface ServiceNotification<T> {
  service: T;
  kind: ServiceEventKind;
}

/** Per-service decision the notifier acts on (see planServiceNotifications). */
export interface ServicePlan<T extends ServiceNotifyCandidate> {
  service: T;
  /** True on the very first sighting (no prior marker): record silently. */
  isBaseline: boolean;
  /** Status-transition event to fire, or null. Always null on baseline. */
  statusEvent: "suspended" | "unsuspended" | null;
  /** Whether a renewal reminder should fire (deduped). Always false on baseline. */
  renewalEvent: boolean;
  /** Whether the service is currently inside the renewal window (raw, no dedup). */
  renewalDue: boolean;
  /** Normalized (lowercased) current status. */
  status: string;
  /** Marker that existed before this pass (null on baseline). */
  prev: ServiceMarker | null;
}

/** Lowercase + trim a WHMCS status for stable comparisons. */
export function normalizeStatus(status: string | null | undefined): string {
  return String(status ?? "").trim().toLowerCase();
}

/**
 * Is this service currently inside its renewal-reminder window? True only for
 * an ACTIVE service whose next due date is on or before today+`renewSoonDays`
 * (a suspended / terminated / pending service does not get renewal reminders).
 */
export function isRenewalDue(
  service: ServiceNotifyCandidate,
  today: string,
  renewSoonDays: number,
): boolean {
  if (normalizeStatus(service.status) !== "active") return false;
  if (!service.nextDueDate) return false;
  const windowEnd = addDaysToDateString(today, renewSoonDays);
  return service.nextDueDate <= windowEnd;
}

/**
 * Decide, for each service, what (if anything) to notify about this pass and the
 * baseline/dedup context. Pure → unit-tested without network.
 *
 *  - No prior marker => baseline: never notify, just record current state.
 *  - suspended: previous status was not "suspended" and it now is.
 *  - unsuspended: previous status was "suspended" and it is now "active".
 *  - renewal: the service is in its renewal window AND its nextDueDate differs
 *    from the date we last reminded about (so it fires once per cycle).
 */
export function planServiceNotifications<T extends ServiceNotifyCandidate>(
  services: T[],
  markers: ServiceMarkerMap,
  today: string,
  renewSoonDays: number,
): ServicePlan<T>[] {
  const out: ServicePlan<T>[] = [];
  for (const service of services) {
    const prev = markers[String(service.id)] ?? null;
    const status = normalizeStatus(service.status);
    const renewalDue = isRenewalDue(service, today, renewSoonDays);

    if (prev === null) {
      out.push({ service, isBaseline: true, statusEvent: null, renewalEvent: false, renewalDue, status, prev: null });
      continue;
    }

    let statusEvent: ServicePlan<T>["statusEvent"] = null;
    if (prev.lastSeenStatus !== "suspended" && status === "suspended") {
      statusEvent = "suspended";
    } else if (prev.lastSeenStatus === "suspended" && status === "active") {
      statusEvent = "unsuspended";
    }

    const renewalEvent = renewalDue && service.nextDueDate !== prev.lastRenewalNotified;

    out.push({ service, isBaseline: false, statusEvent, renewalEvent, renewalDue, status, prev });
  }
  return out;
}

// --- Customer-facing copy (pure, unit-tested) ---------------------------------

/** Short human label for the service, e.g. `Web Hosting (example.com)`. */
export function serviceLabel(service: ServiceNotifyCandidate): string {
  const name = String(service.name ?? "").trim();
  const domain = String(service.domain ?? "").trim();
  if (name && domain && domain.toLowerCase() !== name.toLowerCase()) return `${name} (${domain})`;
  return name || domain || "your service";
}

/** "renews today" / "renews tomorrow" / "renews in N days". */
export function serviceRenewPhrase(today: string, nextDueDate: string | null): string {
  if (!nextDueDate) return "is renewing soon";
  const d = daysUntilDue(today, nextDueDate);
  if (d <= 0) return "renews today";
  if (d === 1) return "renews tomorrow";
  return `renews in ${d} days`;
}

/** Notification-template key for a service event kind. */
export function serviceTemplateKey(kind: ServiceEventKind): NotificationTemplateKey {
  if (kind === "suspended") return "whmcs.service.suspended";
  if (kind === "unsuspended") return "whmcs.service.unsuspended";
  return "whmcs.service.renewal";
}

/** Placeholder values for a service notification. */
function serviceVars(
  service: ServiceNotifyCandidate,
  today: string,
): Record<string, string> {
  return {
    service: serviceLabel(service),
    when: serviceRenewPhrase(today, service.nextDueDate),
  };
}

/**
 * Notification title for the event kind. Delegates to the shared template
 * renderer so an admin override (when supplied) wins over the built-in default.
 */
export function serviceNotifTitle(
  kind: ServiceEventKind,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(serviceTemplateKey(kind), {}, override).title;
}

/** Body line for the event kind (admin override wins when supplied). */
export function serviceNotifBody(
  service: ServiceNotifyCandidate,
  kind: ServiceEventKind,
  today: string,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(serviceTemplateKey(kind), serviceVars(service, today), override).body;
}

// --- "New service is ready" copy (Task #474) ----------------------------------
// A one-time message fired when a newly ordered service finishes provisioning.
// It is NOT a ServiceEventKind (no marker transition drives it), so it has its
// own template key + copy helpers. Strictly credential-free: it names the
// service and tells the customer to open My Services to see their login details.

/** Notification-template key for the "new service is ready" message. */
export const SERVICE_READY_TEMPLATE_KEY: NotificationTemplateKey = "whmcs.service.ready";

/** Title for the "new service is ready" message (admin override wins). */
export function serviceReadyTitle(override?: NotificationTemplateOverride | null): string {
  return renderNotification(SERVICE_READY_TEMPLATE_KEY, {}, override).title;
}

/** Body for the "new service is ready" message (admin override wins). */
export function serviceReadyBody(
  service: ServiceNotifyCandidate,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(SERVICE_READY_TEMPLATE_KEY, { service: serviceLabel(service) }, override).body;
}

// --- "New service added" copy (Task #567) -------------------------------------
// A one-time message fired when a brand-new service is detected on an already-
// baselined customer's account — e.g. one ordered directly in WHMCS, outside the
// ServiceHub store. Like "ready" it is NOT a ServiceEventKind (no marker
// transition drives it) and is strictly credential-free: it names the service
// and deep-links to My Services where the secure details live.

/** Notification-template key for the "new service added" message. */
export const SERVICE_ADDED_TEMPLATE_KEY: NotificationTemplateKey = "whmcs.service.added";

/** Title for the "new service added" message (admin override wins). */
export function serviceAddedTitle(override?: NotificationTemplateOverride | null): string {
  return renderNotification(SERVICE_ADDED_TEMPLATE_KEY, {}, override).title;
}

/** Body for the "new service added" message (admin override wins). */
export function serviceAddedBody(
  service: ServiceNotifyCandidate,
  override?: NotificationTemplateOverride | null,
): string {
  return renderNotification(SERVICE_ADDED_TEMPLATE_KEY, { service: serviceLabel(service) }, override).body;
}
