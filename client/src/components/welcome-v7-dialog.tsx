import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/brand-logo";
import { useModalSlot } from "@/lib/modal-queue";

// Fixed copy for this one-time announcement. Intentionally NOT tied to
// APP_VERSION: the dismissal gate (users.welcomeV7DismissedAt) is v7-specific,
// so a later version bump must not re-label this popup "Version 8.0".
const WELCOME_V7_VERSION = "7.0";

// One-time welcome / account-linking announcement for customers. Shows once
// per customer; either button permanently dismisses it (server-persisted via
// users.welcomeV7DismissedAt, so it never re-fires across devices/reloads).
export function WelcomeV7Dialog() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);

  // Reset per-user so account switching within the same SPA session re-evaluates.
  useEffect(() => {
    setResolved(false);
    setOpen(false);
  }, [user?.id]);

  useEffect(() => {
    if (resolved) return;
    if (!user) return;
    if (user.role !== "customer") return;
    if (user.welcomeV7DismissedAt) return;
    setOpen(true);
    setResolved(true);
  }, [user, resolved]);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/users/me/welcome-v7-dismiss");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const dismiss = () => {
    setOpen(false);
    dismissMutation.mutate();
  };

  const goSettings = async () => {
    setOpen(false);
    // Persist the dismissal before navigating away so a click on "Link my
    // account" still counts as a permanent dismissal. Best-effort: on network
    // failure we still navigate, and the popup may re-show on the next load.
    try {
      await dismissMutation.mutateAsync();
    } catch {
      // ignore — see above
    }
    navigate("/settings");
  };

  const isMine = useModalSlot("welcome-v7", 80, open && !!user);

  if (!user || !open || !isMine) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-welcome-v7">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <BrandLogo className="h-12" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-welcome-v7-title">
            Welcome to CowboyMedia ServiceHub Version {WELCOME_V7_VERSION}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" data-testid="text-welcome-v7-body">
          You can now link your ServiceHub account with your CowboyMedia Online
          Account System! This allows you to see important account information
          directly in ServiceHub without having to check two places at once.
          Most accounts linked automatically due to your email address, but if
          you used a different email address than your online account system,
          head to settings and link your account today! Lots of amazing new
          features on the way soon for ServiceHub, so stay tuned!
        </p>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={goSettings} data-testid="button-welcome-v7-settings">
            Link my account in Settings
          </Button>
          <Button variant="outline" className="w-full" onClick={dismiss} data-testid="button-welcome-v7-dismiss">
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
