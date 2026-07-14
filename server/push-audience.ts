// Route a push to the right app's devices. Admin-audience pushes (payload.url
// deep-links into /admin) go ONLY to admin-app subscriptions when the user has
// any — staff shouldn't be pinged about admin work in the customer app, and
// the /admin deep link only opens reliably from the admin app's own service
// worker. If the user has no admin-app subscription yet, fall back to all
// devices so nothing is silently dropped. Customer pushes symmetrically prefer
// customer-app subscriptions.

export type PushAudience = "admin" | "customer";

export function pushAudienceForUrl(url: string | undefined): PushAudience {
  return url && (url === "/admin" || url.startsWith("/admin?") || url.startsWith("/admin/"))
    ? "admin"
    : "customer";
}

export function subsForAudience<T extends { appScope: string }>(subs: T[], audience: PushAudience): T[] {
  const matching = subs.filter((s) => (s.appScope === "admin") === (audience === "admin"));
  return matching.length > 0 ? matching : subs;
}
