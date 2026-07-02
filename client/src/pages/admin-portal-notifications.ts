// Pure pagination helpers for the Admin Portal customer-notification history
// view (CustomerNotificationsSection in admin-portal.tsx). Extracted so the
// UI ↔ API pagination contract is unit-testable without a DOM: the API caps a
// single request's `limit` (max 100), so the client MUST paginate by advancing
// an `offset` with a constant page size — never by growing `limit` (which would
// clamp and loop on the first page forever, hiding older history).

export const NOTIFICATION_PAGE_SIZE = 30;

export interface NotificationPage {
  notifications: unknown[];
  hasMore: boolean;
}

// Offset for the next page = how many rows we've loaded so far, but only while
// the server says there's more. Returns undefined to stop.
export function nextNotificationPageOffset(pages: NotificationPage[]): number | undefined {
  const last = pages[pages.length - 1];
  if (!last || !last.hasMore) return undefined;
  return pages.reduce((n, p) => n + p.notifications.length, 0);
}

// Builds the query string for one page request. Page size is always constant;
// only the offset moves. An "all" (or empty) type means no filter.
export function buildNotificationPageQuery(offset: number, type: string): string {
  const params = new URLSearchParams();
  params.set("limit", String(NOTIFICATION_PAGE_SIZE));
  params.set("offset", String(offset));
  if (type && type !== "all") params.set("type", type);
  return params.toString();
}
