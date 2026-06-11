// Pure, framework-free helpers for the "new billing-ticket reply" indicator.
//
// WHMCS tickets are read-on-demand (never stored — see Task #334), so there is
// no server-side unread state to lean on. Instead we remember, client-side, the
// latest reply date the customer has already seen for each ticket and flag any
// ticket whose newest STAFF reply is newer than that. Granularity is per-day
// because the WHMCS list payload only carries YYYY-MM-DD dates (the same
// `lastReply` the list already renders), so the comparison stays consistent
// with what the customer sees in the list.

export type SeenMap = Record<string, string>;

export interface UnreadTicketLike {
  id: number;
  /** Normalized WHMCS status key. "answered" means staff replied last. */
  statusKey: string;
  /** Last activity date (YYYY-MM-DD) or null. */
  lastReply: string | null;
}

/**
 * A ticket carries a new staff reply the customer hasn't seen yet when WHMCS
 * marks it "answered" (staff replied last, so the ball is in the customer's
 * court) AND its last-reply date is newer than the date we recorded the last
 * time the customer opened the thread. A ticket the customer has never opened
 * counts as new as soon as staff have answered it.
 */
export function ticketHasNewReply(ticket: UnreadTicketLike, seen: SeenMap): boolean {
  if (ticket.statusKey !== "answered") return false;
  if (!ticket.lastReply) return false;
  const seenAt = seen[String(ticket.id)];
  return !seenAt || seenAt < ticket.lastReply;
}

/** How many of the given tickets have an unseen staff reply. */
export function countNewReplies(tickets: UnreadTicketLike[], seen: SeenMap): number {
  let n = 0;
  for (const t of tickets) if (ticketHasNewReply(t, seen)) n++;
  return n;
}

/** The ids of tickets with an unseen staff reply (for per-row highlighting). */
export function newReplyTicketIds(tickets: UnreadTicketLike[], seen: SeenMap): number[] {
  return tickets.filter((t) => ticketHasNewReply(t, seen)).map((t) => t.id);
}

/** Latest reply date (YYYY-MM-DD) among a thread's messages, or null. */
export function latestReplyDate(messages: { date: string | null }[]): string | null {
  let max: string | null = null;
  for (const m of messages) {
    if (m.date && (max === null || m.date > max)) max = m.date;
  }
  return max;
}

/**
 * Merge a freshly-seen reply date into the seen map. Never regresses — keeps
 * the later of the two dates. Returns the SAME reference when nothing changed
 * so callers can skip a redundant persist/notify.
 */
export function markSeen(seen: SeenMap, ticketId: number, latestDate: string | null): SeenMap {
  if (!latestDate) return seen;
  const key = String(ticketId);
  const prev = seen[key];
  if (prev && prev >= latestDate) return seen;
  return { ...seen, [key]: latestDate };
}
