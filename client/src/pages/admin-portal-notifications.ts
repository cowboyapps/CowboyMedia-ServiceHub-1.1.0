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

// Resolves the in-app target a customer-notification row should link to, so an
// admin can jump from "what was this about?" to the underlying ticket / news
// story / service in one click. Read-only navigation: every candidate is an
// internal SPA route the admin already has access to.
//
// Prefer the stored `url` (the exact route the customer's own bell tapped
// through to), but only trust an internal absolute path (starts with a single
// "/") — never an external/protocol-relative URL, so a malformed row can't
// become an off-app link. When `url` is absent, fall back to resolving a small
// allowlist of (referenceType, referenceId) pairs that map cleanly to a single
// page. Everything else returns null so the row renders as plain, dead-link-free
// text.
export function resolveNotificationLink(n: {
  url?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
}): string | null {
  const url = n.url?.trim();
  if (url && url.startsWith("/") && !url.startsWith("//")) return url;

  const refType = n.referenceType?.trim();
  const refId = n.referenceId?.trim();
  if (!refType || !refId) return null;

  switch (refType) {
    case "ticket":
      return `/tickets/${refId}`;
    case "news":
      return `/news/${refId}`;
    case "service":
      return `/services/${refId}`;
    default:
      return null;
  }
}
