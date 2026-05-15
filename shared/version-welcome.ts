// Pure selection logic shared between the /api/version-welcome route and
// its tests. Returns the version to surface in the welcome popup, or null
// when nothing should be shown. Kept stateless so it can be exercised
// without a DB.
export type LatestPublished = { version: string; title: string } | null;

export function selectVersionWelcome(
  latestPublished: LatestPublished,
  lastSeen: string | null | undefined,
): { version: string; title: string } | null {
  if (!latestPublished) return null;
  if ((lastSeen ?? "") === latestPublished.version) return null;
  return { version: latestPublished.version, title: latestPublished.title ?? "" };
}
