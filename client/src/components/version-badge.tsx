import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { APP_VERSION, versionAnchor } from "@shared/version";
import { useAuth } from "@/lib/auth";

// Small always-visible "v9.0" pill next to the header logo. Tapping it opens
// the What's New page. When a version's release notes have been published and
// this device hasn't visited What's New since, a subtle pulsing dot appears —
// the quiet replacement for the retired "Welcome to version X" popup.

// Per-user key so account switching on a shared device doesn't clear or
// suppress another user's "new" dot.
function seenKey(userId: string): string {
  return `whats-new-last-seen-version:${userId}`;
}

interface ChangelogRow {
  version: string;
}

export function VersionBadge() {
  const { user } = useAuth();
  const [location] = useLocation();
  const onWhatsNew = location.startsWith("/whats-new");

  // Published entries only (newest first) — same endpoint the What's New page
  // reads, so the cache is shared and this adds no extra request after a visit.
  const { data: entries } = useQuery<ChangelogRow[]>({
    queryKey: ["/api/changelog"],
    enabled: !!user,
  });
  const latestPublished = entries?.[0]?.version ?? null;

  // Visiting What's New marks the latest published version as seen on this
  // device. localStorage (not the DB) is deliberate: it's a cosmetic hint,
  // and per-device is fine.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (onWhatsNew && latestPublished && userId) {
      try {
        localStorage.setItem(seenKey(userId), latestPublished);
      } catch {}
    }
  }, [onWhatsNew, latestPublished, userId]);

  let hasNew = false;
  if (latestPublished && !onWhatsNew && userId) {
    try {
      hasNew = localStorage.getItem(seenKey(userId)) !== latestPublished;
    } catch {}
  }

  return (
    <Link
      href={`/whats-new#${versionAnchor(APP_VERSION)}`}
      className="relative hidden min-[360px]:inline-flex items-center rounded-full border border-border bg-background/60 px-2 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground no-underline hover-elevate transition-colors"
      aria-label={`Version ${APP_VERSION} — see what's new`}
      data-testid="badge-app-version"
    >
      v{APP_VERSION}
      {hasNew && (
        <span
          className="absolute -top-0.5 -right-0.5 flex h-2 w-2"
          data-testid="dot-version-new"
          aria-hidden="true"
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
      )}
    </Link>
  );
}
