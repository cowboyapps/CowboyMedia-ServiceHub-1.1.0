// Background poller that pushes/emails a customer as one of their WHMCS
// invoices' due date draws near (and again when it becomes overdue), with a
// one-tap action that opens the WHMCS payment page for that invoice. Mirrors the
// WHMCS ticket-reply notifier (server/whmcs-ticket-notifier.ts).
//
// WHMCS invoices are read-on-demand (never stored) and there is no WHMCS webhook
// today, so the only way to learn "this invoice is now due / overdue"
// out-of-band is to periodically list each linked customer's invoices and diff
// against a small server-side per-invoice STAGE marker
// (whmcs_invoice_notifications). An invoice escalates none -> due_soon ->
// overdue and notifies at most once per stage (see shared/whmcs-invoice-notify).
//
// Safety / no-op contract (identical to the ticket notifier):
//   - No-op when WHMCS is unconfigured or disabled (getConfig().active=false).
//   - No-op for users with no linked WHMCS client id.
//   - Skips a user cleanly when WHMCS is unreachable for them (no marker write),
//     so the reminder is retried next pass instead of being silently swallowed.
//     This is also what makes the feature degrade cleanly while the WHMCS API
//     role still lacks the GetInvoices permission — every list comes back
//     `unreachable`, nothing is written, nothing crashes.
//   - De-duplicated via the persisted per-invoice stage marker, so the same
//     stage never notifies twice across passes or restarts.
//   - Quiet-hours aware: when a customer wants the reminder but it's currently
//     quiet hours, the marker is NOT written, so the next post-quiet-hours pass
//     re-delivers it (the stage persists day-over-day, so this is safe).

import {
  selectInvoicesToNotify,
  type InvoiceNotifyCandidate,
  type InvoiceStage,
  type InvoiceStageMap,
} from "@shared/whmcs-invoice-notify";

const POLL_INTERVAL_MS = 5 * 60_000;
// Notify when an unpaid invoice's due date is within this many days. Day
// granularity (WHMCS list payloads carry YYYY-MM-DD).
export const DUE_SOON_DAYS = 3;

export type NotifierInvoice = InvoiceNotifyCandidate;

export interface InvoiceNotifierUser {
  id: string;
  email: string | null;
  fullName: string;
  whmcsClientId: number | null;
  notificationPrefs: unknown;
  role: string | null;
}

export interface WhmcsInvoiceNotifierDeps {
  /** Whether WHMCS is configured + enabled, plus the resolved base URL. */
  getConfig: () => Promise<{ active: boolean; baseUrl: string | null }>;
  /** All ServiceHub users linked to a WHMCS client (whmcsClientId set). */
  getLinkedUsers: () => Promise<InvoiceNotifierUser[]>;
  /** List a client's WHMCS invoices (read-on-demand). */
  loadInvoices: (
    clientId: number,
    baseUrl: string | null,
  ) => Promise<{ invoices: NotifierInvoice[]; unreachable: boolean }>;
  /** Per-(user) map of WHMCS invoice id -> last-notified stage. */
  getNotifyState: (userId: string) => Promise<InvoiceStageMap>;
  /** Persist that we notified `userId` about `invoiceId` at `stage`. */
  recordNotified: (userId: string, invoiceId: number, stage: InvoiceStage) => Promise<void>;
  /**
   * Create the in-app (bell) notification row for this reminder and return its
   * id (or null on failure). Decoupled from push so email-only users still get
   * a bell entry. Never throws.
   */
  createInApp: (user: InvoiceNotifierUser, invoice: NotifierInvoice, stage: InvoiceStage) => Promise<string | null>;
  /**
   * Fire a push notification (caller decides delivery; never throws). When an
   * in-app row already exists (`notificationId`), reuse it instead of creating
   * a second bell row.
   */
  sendPush: (
    user: InvoiceNotifierUser,
    invoice: NotifierInvoice,
    stage: InvoiceStage,
    notificationId: string | null,
  ) => void;
  /** Fire an email (caller decides delivery; never throws). */
  sendEmail: (user: InvoiceNotifierUser, invoice: NotifierInvoice, stage: InvoiceStage) => void;
  /** Does the user want push for this category right now (folds quiet hours)? */
  wantsPush: (user: InvoiceNotifierUser, categoryKey: string) => boolean;
  /** Does the user want email for this category right now (folds quiet hours)? */
  wantsEmail: (user: InvoiceNotifierUser, categoryKey: string) => boolean;
  /**
   * Are this category's channel prefs on at all, IGNORING quiet hours? Used to
   * tell "the customer turned this off" (record the marker, don't replay later)
   * apart from "quiet hours suppressed it right now" (skip the marker, retry).
   */
  prefsOn: (user: InvoiceNotifierUser, categoryKey: string) => boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

const CATEGORY_KEY = "whmcs_invoice_due";

export interface InvoiceNotifyPassResult {
  active: boolean;
  usersScanned: number;
  invoicesNotified: number;
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
export async function runWhmcsInvoiceNotifyPass(deps: WhmcsInvoiceNotifierDeps): Promise<InvoiceNotifyPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  const today = todayString(now);

  let usersScanned = 0;
  let invoicesNotified = 0;

  let config: { active: boolean; baseUrl: string | null };
  try {
    config = await deps.getConfig();
  } catch (e) {
    console.error("[whmcs-invoice-notifier] getConfig failed:", (e as Error)?.message);
    return { active: false, usersScanned, invoicesNotified };
  }
  if (!config.active) return { active: false, usersScanned, invoicesNotified };

  let users: InvoiceNotifierUser[];
  try {
    users = await deps.getLinkedUsers();
  } catch (e) {
    console.error("[whmcs-invoice-notifier] getLinkedUsers failed:", (e as Error)?.message);
    return { active: true, usersScanned, invoicesNotified };
  }

  for (const user of users) {
    if (!user.whmcsClientId) continue;
    usersScanned++;
    try {
      const list = await deps.loadInvoices(user.whmcsClientId, config.baseUrl);
      // Don't write markers when WHMCS was unreachable (incl. while the API
      // role still lacks GetInvoices) — retry next pass.
      if (list.unreachable) continue;

      const notified = await deps.getNotifyState(user.id);
      const toNotify = selectInvoicesToNotify(list.invoices, notified, today, DUE_SOON_DAYS);

      for (const { invoice, stage } of toNotify) {
        const wantsPush = deps.wantsPush(user, CATEGORY_KEY);
        const wantsEmail = !!user.email && deps.wantsEmail(user, CATEGORY_KEY);
        const delivered = wantsPush || wantsEmail;

        // Create the in-app (bell) record whenever the customer would be
        // notified through any channel — decoupled from push so email-only
        // users still get a bell entry. The push then reuses this row.
        let notificationId: string | null = null;
        if (delivered) notificationId = await deps.createInApp(user, invoice, stage);
        if (wantsPush) deps.sendPush(user, invoice, stage, notificationId);
        if (wantsEmail) deps.sendEmail(user, invoice, stage);

        // Marker rule: record when we actually delivered, OR when the customer
        // has this category's channels switched off (so toggling them on later
        // doesn't replay an old stage). SKIP the marker when prefs are on but
        // quiet hours suppressed delivery — the next pass after quiet hours
        // ends will re-deliver. The stage persists day-over-day, so a skipped
        // marker can't lose a reminder.
        const suppressedByQuietHours = !delivered && deps.prefsOn(user, CATEGORY_KEY);
        if (!suppressedByQuietHours) {
          await deps.recordNotified(user.id, invoice.id, stage);
        }
        if (delivered) invoicesNotified++;
      }
    } catch (e) {
      console.error(`[whmcs-invoice-notifier] user ${user.id} pass failed:`, (e as Error)?.message);
    }
  }

  return { active: true, usersScanned, invoicesNotified };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the recurring notifier. Runs one pass shortly after boot. */
export function startWhmcsInvoiceNotifier(deps: WhmcsInvoiceNotifierDeps): void {
  if (timer) return;
  timer = setInterval(() => {
    void runWhmcsInvoiceNotifyPass(deps).catch((e) =>
      console.error("[whmcs-invoice-notifier] pass error:", (e as Error)?.message),
    );
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  void runWhmcsInvoiceNotifyPass(deps).catch((e) =>
    console.error("[whmcs-invoice-notifier] initial pass error:", (e as Error)?.message),
  );
}

export function stopWhmcsInvoiceNotifier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
