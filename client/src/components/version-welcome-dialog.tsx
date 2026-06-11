import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { versionAnchor } from "@shared/version";
import {
  versionWelcomeMarkerKey,
  shouldSuppressFromMarker,
} from "@shared/version-welcome-marker";
import { useModalSlot } from "@/lib/modal-queue";

// Send the seen-PATCH in a way the browser will deliver even if the page
// is unloading (e.g. user reloads moments after the popup renders). We
// prefer fetch with `keepalive: true`; sendBeacon is the legacy fallback.
// Both are best-effort — the localStorage marker (written synchronously
// before this call) is the durable guarantee that we don't re-show the
// popup on the next load even if the network call is dropped.
function sendSeenBeacon(version: string): void {
  const url = "/api/users/me/version-welcome-seen";
  const body = JSON.stringify({ version });
  try {
    void fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body,
      credentials: "include",
      keepalive: true,
    });
  } catch {
    try {
      navigator.sendBeacon?.(
        url,
        new Blob([body], { type: "application/json" }),
      );
    } catch {
      // Best-effort only — the localStorage marker already protects us.
    }
  }
}

// Server tells us the version (and optional headline) the user hasn't seen
// a published changelog for yet. Null = nothing to show. The popup is
// completely decoupled from the APP_VERSION constant on the client now —
// admin must publish a changelog entry for a version before this fires.
type VersionWelcome = { version: string; title: string } | null;

export function VersionWelcomeDialog() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const { data: welcome } = useQuery<VersionWelcome>({
    queryKey: ["/api/version-welcome"],
    enabled: !!user,
  });

  // Reset per-user so account switching within the same SPA session still
  // surfaces the popup for the new user.
  useEffect(() => {
    setDismissedFor(null);
    setOpen(false);
  }, [user?.id]);

  const invalidateAfterSeen = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    queryClient.invalidateQueries({ queryKey: ["/api/version-welcome"] });
  };

  // Mark seen the moment we surface the popup, not on close, with three
  // layers of defence so the popup never re-fires across a reload:
  //   1) localStorage marker (durable, synchronous, written BEFORE any
  //      network call) — survives reloads even if the PATCH is aborted.
  //   2) PATCH with `keepalive: true` (or sendBeacon fallback) so the
  //      server still records the seen state if the user reloads
  //      immediately after render.
  //   3) Local `dismissedFor` state so the effect doesn't re-fire within
  //      the same render cycle.
  useEffect(() => {
    if (!user) return;
    if (dismissedFor === user.id) return;
    if (!welcome) return;

    // Suppress the popup entirely if a marker for this exact version
    // already exists from a prior session — bypass even setOpen.
    let storedMarker: string | null = null;
    try {
      storedMarker = window.localStorage.getItem(versionWelcomeMarkerKey(user.id));
    } catch {
      // localStorage can throw in private modes / disabled storage —
      // treat as "no marker", we still have the in-memory guard.
    }
    if (shouldSuppressFromMarker(storedMarker, welcome.version)) {
      setDismissedFor(user.id);
      // Reconcile server state in the background; we already know the
      // user has seen this version locally.
      sendSeenBeacon(welcome.version);
      invalidateAfterSeen();
      return;
    }

    // Write the durable marker BEFORE the network call. If the user
    // reloads in the next tick, this is what protects us.
    try {
      window.localStorage.setItem(
        versionWelcomeMarkerKey(user.id),
        welcome.version,
      );
    } catch {
      // ignore — see above
    }

    setOpen(true);
    setDismissedFor(user.id);
    sendSeenBeacon(welcome.version);
    invalidateAfterSeen();
  }, [user, welcome, dismissedFor]);

  const close = () => {
    setOpen(false);
  };

  const goChangelog = () => {
    const v = welcome?.version;
    close();
    if (v) navigate(`/whats-new#${versionAnchor(v)}`);
    else navigate("/whats-new");
  };

  const isMine = useModalSlot("version-welcome", 50, open && !!user && !!welcome);

  if (!user || !open || !isMine || !welcome) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-version-welcome">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-version-welcome-title">
            Welcome to version {welcome.version}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center" data-testid="text-version-welcome-body">
          {welcome.title?.trim()
            ? welcome.title
            : `What\u2019s new in ${welcome.version}`}
        </p>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={goChangelog} data-testid="button-version-welcome-changelog">
            See what&apos;s new
          </Button>
          <Button variant="outline" className="w-full" onClick={close} data-testid="button-version-welcome-dismiss">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
