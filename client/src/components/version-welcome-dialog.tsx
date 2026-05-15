import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { versionAnchor } from "@shared/version";
import { useModalSlot } from "@/lib/modal-queue";

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

  useEffect(() => {
    if (!user) return;
    if (dismissedFor === user.id) return;
    if (welcome) {
      setOpen(true);
    }
  }, [user, welcome, dismissedFor]);

  const markSeen = useMutation({
    mutationFn: async (version: string) => {
      await apiRequest("PATCH", "/api/users/me/version-welcome-seen", { version });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      queryClient.invalidateQueries({ queryKey: ["/api/version-welcome"] });
    },
  });

  const close = () => {
    setOpen(false);
    if (user) setDismissedFor(user.id);
    if (welcome) markSeen.mutate(welcome.version);
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
