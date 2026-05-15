// Pure helpers for the durable client-side marker used by
// VersionWelcomeDialog to guarantee the popup never re-fires across a
// reload. The server is the source of truth (PATCH /version-welcome-seen
// updates user.lastSeenVersion), but a fast reload after popup render
// can abort the in-flight PATCH; this localStorage marker bridges that
// gap so the popup stays dismissed even if the PATCH never lands.
//
// Pure / DOM-free so it can be unit-tested. The dialog reads/writes
// `window.localStorage` and forwards the value to these helpers.

const PREFIX = "vw-seen:"; // version-welcome seen marker

export function versionWelcomeMarkerKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

/**
 * Should we suppress the popup for this user+version pair, given the
 * stored marker value (or null if not set)?
 *
 * The marker stores the most recent version the user dismissed *or* was
 * shown the popup for. If it matches the version the server is currently
 * offering, suppress.
 */
export function shouldSuppressFromMarker(
  storedMarker: string | null | undefined,
  offeredVersion: string,
): boolean {
  if (!storedMarker) return false;
  return storedMarker === offeredVersion;
}
