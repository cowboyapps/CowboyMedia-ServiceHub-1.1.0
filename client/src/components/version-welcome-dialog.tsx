import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles } from "lucide-react";
import { APP_VERSION, versionAnchor, shouldShowVersionWelcome } from "@shared/version";

export function VersionWelcomeDialog() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  // Reset per-user so account switching within the same SPA session still
  // surfaces the popup for the new user.
  useEffect(() => {
    setDismissedFor(null);
    setOpen(false);
  }, [user?.id]);

  useEffect(() => {
    if (!user) return;
    if (dismissedFor === user.id) return;
    if (shouldShowVersionWelcome(user.lastVersionWelcomeSeen, APP_VERSION)) {
      setOpen(true);
    }
  }, [user, dismissedFor]);

  const markSeen = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/users/me/version-welcome-seen", { version: APP_VERSION });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const close = () => {
    setOpen(false);
    if (user) setDismissedFor(user.id);
    markSeen.mutate();
  };

  const goChangelog = () => {
    close();
    navigate(`/whats-new#${versionAnchor(APP_VERSION)}`);
  };

  if (!user || !open) return null;

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
            Welcome to version {APP_VERSION}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground text-center" data-testid="text-version-welcome-body">
          Thanks for keeping the app up to date. Here&apos;s what&apos;s new in this release.
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
