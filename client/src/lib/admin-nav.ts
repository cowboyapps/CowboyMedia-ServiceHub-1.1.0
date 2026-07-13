// The Admin Portal now lives in its own PWA served at /admin (separate HTML
// entry, separate service-worker scope). Crossing between the customer app and
// the admin app therefore requires a FULL page load — a wouter navigation
// would just 404 inside the current SPA. These helpers centralize that rule.

export function isAdminAppContext(): boolean {
  if (typeof window === "undefined") return false;
  const p = window.location.pathname;
  return p === "/admin" || p.startsWith("/admin/");
}

/**
 * Navigate to a URL that may belong to the other app.
 * - /admin URLs inside the admin app, or non-admin URLs inside the customer
 *   app, use the provided SPA `navigate` (no reload).
 * - Anything that crosses the /admin boundary does a full page load.
 */
// jsdom cannot perform real page loads ("Not implemented: navigation to
// another Document"), so tests can swap the assign implementation to observe
// cross-app navigations instead of crashing on them.
let assignImpl: (url: string) => void = (url) => window.location.assign(url);

export function __setAssignForTests(fn: ((url: string) => void) | null): void {
  assignImpl = fn ?? ((url) => window.location.assign(url));
}

export function navigateAcrossApps(url: string, navigate: (to: string) => void): void {
  const targetIsAdmin = url === "/admin" || url.startsWith("/admin?") || url.startsWith("/admin/");
  if (targetIsAdmin === isAdminAppContext()) {
    navigate(url);
  } else {
    assignImpl(url);
  }
}
