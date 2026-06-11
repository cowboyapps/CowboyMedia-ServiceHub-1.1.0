// Background poller that pushes/emails a customer when one of their WHMCS
// (billing & account support) tickets gets a staff reply (Task #344).
//
// WHMCS tickets are read-on-demand (never stored — Task #334) and there is no
// WHMCS webhook today, so the only way to learn "staff replied" out-of-band is
// to periodically list each linked customer's tickets and diff against a small
// server-side "last notified" marker (whmcs_ticket_notifications). This mirrors
// how native ServiceHub tickets notify on reply, but for the mirrored WHMCS
// inbox that otherwise only surfaces an unread badge while the customer is on
// the tickets page.
//
// Safety/no-op contract:
//   - No-op when WHMCS is unconfigured or disabled (getConfig().active=false).
//   - No-op for users with no linked WHMCS client id.
//   - Skips a user cleanly when WHMCS is unreachable for them (no marker write,
//     so the reply is retried next pass instead of being silently swallowed).
//   - De-duplicated via the persisted per-ticket last-notified date, so the
//     same reply never notifies twice across passes or restarts.
//   - A recency window keeps the first pass on an existing inbox from blasting
//     historical answered tickets (see shared/whmcs-notify.ts).

import { selectTicketsToNotify, cutoffDateString, type NotifyCandidate } from "@shared/whmcs-notify";
import type { SeenMap } from "@shared/whmcs-unread";

const POLL_INTERVAL_MS = 5 * 60_000;
// Only notify for staff replies dated within this many days. Day-granularity
// (WHMCS list payloads carry YYYY-MM-DD). 3 days tolerates a missed poll /
// short outage while keeping the first-run blast tiny.
const RECENCY_WINDOW_DAYS = 3;

export interface NotifierTicket extends NotifyCandidate {
  id: number;
  subject?: string;
}

export interface NotifierUser {
  id: string;
  email: string | null;
  fullName: string;
  whmcsClientId: number | null;
  notificationPrefs: unknown;
  role: string | null;
}

export interface WhmcsNotifierDeps {
  /** Whether WHMCS is configured + enabled, plus the resolved base URL. */
  getConfig: () => Promise<{ active: boolean; baseUrl: string | null }>;
  /** All ServiceHub users linked to a WHMCS client (whmcsClientId set). */
  getLinkedUsers: () => Promise<NotifierUser[]>;
  /** List a client's WHMCS tickets (read-on-demand, may be cached). */
  loadTickets: (clientId: number, baseUrl: string | null) => Promise<{ tickets: NotifierTicket[]; unreachable: boolean }>;
  /** Per-(user) map of WHMCS ticket id -> last-notified reply date (YYYY-MM-DD). */
  getNotifyState: (userId: string) => Promise<SeenMap>;
  /** Persist that we notified `userId` about `ticketId`'s reply dated `date`. */
  recordNotified: (userId: string, ticketId: number, date: string) => Promise<void>;
  /**
   * Create the in-app (bell) notification row for this reply and return its id
   * (or null if creation failed). Decoupled from push so email-only users still
   * get a bell entry. Never throws.
   */
  createInApp: (user: NotifierUser, ticket: NotifierTicket) => Promise<string | null>;
  /**
   * Fire a push notification (caller decides delivery; never throws). When an
   * in-app row already exists (`notificationId`), reuse it instead of creating
   * a second bell row.
   */
  sendPush: (user: NotifierUser, ticket: NotifierTicket, notificationId: string | null) => void;
  /** Fire an email (caller decides delivery; never throws). */
  sendEmail: (user: NotifierUser, ticket: NotifierTicket) => void;
  /** Does the user want push for this category? */
  wantsPush: (user: NotifierUser, categoryKey: string) => boolean;
  /** Does the user want email for this category? */
  wantsEmail: (user: NotifierUser, categoryKey: string) => boolean;
  /** Injectable clock for tests. */
  now?: () => Date;
}

const CATEGORY_KEY = "whmcs_ticket_reply";

export interface NotifyPassResult {
  active: boolean;
  usersScanned: number;
  ticketsNotified: number;
}

/**
 * Run one notify pass over all linked customers. Pure of timers — call it from
 * a setInterval (production) or directly (tests). Never throws: a failure for
 * one user is logged and the pass continues for the rest.
 */
export async function runWhmcsTicketNotifyPass(deps: WhmcsNotifierDeps): Promise<NotifyPassResult> {
  const now = (deps.now ?? (() => new Date()))();
  const cutoff = cutoffDateString(now, RECENCY_WINDOW_DAYS);

  let usersScanned = 0;
  let ticketsNotified = 0;

  let config: { active: boolean; baseUrl: string | null };
  try {
    config = await deps.getConfig();
  } catch (e) {
    console.error("[whmcs-notifier] getConfig failed:", (e as Error)?.message);
    return { active: false, usersScanned, ticketsNotified };
  }
  if (!config.active) return { active: false, usersScanned, ticketsNotified };

  let users: NotifierUser[];
  try {
    users = await deps.getLinkedUsers();
  } catch (e) {
    console.error("[whmcs-notifier] getLinkedUsers failed:", (e as Error)?.message);
    return { active: true, usersScanned, ticketsNotified };
  }

  for (const user of users) {
    if (!user.whmcsClientId) continue;
    usersScanned++;
    try {
      const list = await deps.loadTickets(user.whmcsClientId, config.baseUrl);
      // Don't write markers when WHMCS was unreachable — retry next pass.
      if (list.unreachable) continue;

      const notified = await deps.getNotifyState(user.id);
      const toNotify = selectTicketsToNotify(list.tickets, notified, cutoff);

      for (const ticket of toNotify) {
        if (!ticket.lastReply) continue;
        const wantsPush = deps.wantsPush(user, CATEGORY_KEY);
        const wantsEmail = !!user.email && deps.wantsEmail(user, CATEGORY_KEY);
        // Create the in-app (bell) record whenever the customer would be
        // notified through any channel — decoupled from push so email-only
        // users still get a bell entry (Task #350). The push then reuses this
        // row instead of creating its own, so push users still get exactly one.
        let notificationId: string | null = null;
        if (wantsPush || wantsEmail) {
          notificationId = await deps.createInApp(user, ticket);
        }
        if (wantsPush) deps.sendPush(user, ticket, notificationId);
        if (wantsEmail) deps.sendEmail(user, ticket);
        // Record the marker even when both channels are off, so toggling a
        // channel on later doesn't replay every already-seen reply. The reply
        // is still surfaced in-app via the unread badge regardless.
        await deps.recordNotified(user.id, ticket.id, ticket.lastReply);
        if (wantsPush || wantsEmail) ticketsNotified++;
      }
    } catch (e) {
      console.error(`[whmcs-notifier] user ${user.id} pass failed:`, (e as Error)?.message);
    }
  }

  return { active: true, usersScanned, ticketsNotified };
}

let timer: ReturnType<typeof setInterval> | null = null;

/** Start the recurring notifier. Runs one pass shortly after boot. */
export function startWhmcsTicketNotifier(deps: WhmcsNotifierDeps): void {
  if (timer) return;
  timer = setInterval(() => {
    void runWhmcsTicketNotifyPass(deps).catch((e) =>
      console.error("[whmcs-notifier] pass error:", (e as Error)?.message),
    );
  }, POLL_INTERVAL_MS);
  timer.unref?.();
  void runWhmcsTicketNotifyPass(deps).catch((e) =>
    console.error("[whmcs-notifier] initial pass error:", (e as Error)?.message),
  );
}

export function stopWhmcsTicketNotifier(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
