// Pure, framework-free helpers for the background "staff replied to your
// billing ticket" notifier (Task #344).
//
// WHMCS tickets are read-on-demand (never stored — see Task #334), so there is
// no webhook and no stored unread state. A periodic poller (server/whmcs-
// ticket-notifier.ts) iterates linked customers, lists their WHMCS tickets, and
// uses these helpers to decide which tickets carry a fresh staff reply worth a
// push/email. De-duplication leans on the same "answered + newer than X" rule
// as the in-app unread badge (shared/whmcs-unread.ts), where X is the per-ticket
// last-notified date persisted server-side instead of the client's last-seen
// date.

import { ticketHasNewReply, type SeenMap, type UnreadTicketLike } from "./whmcs-unread";

export interface NotifyCandidate extends UnreadTicketLike {
  /** Human ticket number for the notification body (optional). */
  tid?: string;
  /** Ticket subject for the notification body (optional). */
  subject?: string;
}

/**
 * In-app deep-link path to a single WHMCS billing ticket. Used for both the
 * push payload `url` and (once joined to a base URL) the email CTA. Matches the
 * client route registered in `client/src/App.tsx` (`/whmcs-tickets/:id`).
 */
export function whmcsTicketPath(ticketId: number | string): string {
  return `/whmcs-tickets/${ticketId}`;
}

/**
 * Absolute deep link to a WHMCS ticket for use in email (which has no relative
 * base). `baseUrl` should be the app origin (e.g. APP_BASE_URL); trailing
 * slashes are trimmed so we never emit `//whmcs-tickets`.
 */
export function whmcsTicketUrl(baseUrl: string, ticketId: number | string): string {
  return `${baseUrl.replace(/\/+$/, "")}${whmcsTicketPath(ticketId)}`;
}

/**
 * Return the YYYY-MM-DD date that is `days` days before `from`, in UTC and at
 * day granularity (matching the WHMCS list payload). Used as the recency cutoff
 * below.
 */
export function cutoffDateString(from: Date, days: number): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * Decide which tickets warrant a "staff replied" notification this pass.
 *
 * A ticket qualifies when BOTH:
 *  - it has an unseen staff reply versus the per-ticket last-notified map
 *    (status "answered" AND lastReply strictly newer than what we last
 *    notified — exactly the in-app unread rule), AND
 *  - that reply is recent (lastReply >= `cutoffDate`).
 *
 * The recency guard is what keeps the very first poll on an existing inbox from
 * blasting every historical answered ticket: with an empty notified map every
 * answered ticket would otherwise look "new". Once a ticket is notified its
 * date is recorded, so subsequent passes (and restarts) skip it until staff
 * reply again on a later day.
 */
export function selectTicketsToNotify<T extends NotifyCandidate>(
  tickets: T[],
  notified: SeenMap,
  cutoffDate: string,
): T[] {
  return tickets.filter(
    (t) => ticketHasNewReply(t, notified) && !!t.lastReply && t.lastReply >= cutoffDate,
  );
}
