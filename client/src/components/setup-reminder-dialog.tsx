import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BellRing, Settings } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { setSetupReminderOpen } from "@/lib/setup-reminder-state";
import { useModalSlot } from "@/lib/modal-queue";

export function SetupReminderDialog() {
  const { user } = useAuth();
  const [showReminder, setShowReminder] = useState(false);
  const [missingPush, setMissingPush] = useState(false);
  const [missingServices, setMissingServices] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!user || user.role === "admin" || user.role === "master_admin") return;
    if (user.setupReminderDismissed) return;
    if (sessionStorage.getItem("setupReminderShown") === "true") return;
    if (sessionStorage.getItem("showWelcome") === "true") return;
    // Wait for the onboarding tour to finish before showing the setup reminder.
    // Otherwise the Radix Dialog's focus trap blocks tour interactions (pressing
    // Start does nothing) and the two popups stack on top of each other.
    if (user.role === "customer" && !user.onboardingTourCompletedAt) return;

    const checkSetup = async () => {
      const { isSubscribedToPush } = await import("@/lib/push-notifications");
      const hasPush = await isSubscribedToPush();
      const hasServices = (user.subscribedServices?.length ?? 0) > 0;

      if (!hasPush || !hasServices) {
        setMissingPush(!hasPush);
        setMissingServices(!hasServices);
        setShowReminder(true);
        sessionStorage.setItem("setupReminderShown", "true");
      }
    };
    checkSetup();
  }, [user]);

  // Publish open state so the PWA install banner can hold off while this modal
  // reminder is up (they must never stack — see setup-reminder-state.ts).
  useEffect(() => {
    setSetupReminderOpen(showReminder);
    return () => setSetupReminderOpen(false);
  }, [showReminder]);

  const handleDismissPermanently = async () => {
    setDismissing(true);
    try {
      const { apiRequest } = await import("@/lib/queryClient");
      await apiRequest("PATCH", "/api/auth/settings", { setupReminderDismissed: true });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {} finally {
      setDismissing(false);
      setShowReminder(false);
    }
  };

  // Claim a modal slot so the reminder never stacks on top of another
  // focus-trapping surface (onboarding tour, announcements, message popup).
  // It sits below the tour (70) and the announcement dialogs so those present
  // first, then the reminder appears cleanly once they release.
  const isMine = useModalSlot("setup-reminder", 45, showReminder);

  if (!showReminder || !isMine) return null;

  return (
    <Dialog open={showReminder} onOpenChange={setShowReminder}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-setup-reminder">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <BrandLogo className="h-16" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-setup-reminder-title">Quick Reminder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p className="text-center">
            It looks like you haven't finished setting up your account. To get the most out of ServiceHub, please visit your <strong className="text-foreground">Settings</strong> page to:
          </p>
          {missingPush && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BellRing className="w-4 h-4 text-primary" />
              </div>
              <p>
                <strong className="text-foreground">Enable push notifications</strong> so you receive instant alerts about service issues and ticket updates.
              </p>
            </div>
          )}
          {missingServices && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Settings className="w-4 h-4 text-primary" />
              </div>
              <p>
                <strong className="text-foreground">Select the services</strong> you want to receive notifications for, so you stay informed about the things that matter to you.
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" data-testid="button-reminder-go-settings" onClick={() => { setShowReminder(false); window.location.href = "/settings"; }}>
            Go to Settings
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-reminder-dismiss" onClick={() => setShowReminder(false)}>
            Remind Me Later
          </Button>
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            disabled={dismissing}
            onClick={handleDismissPermanently}
            data-testid="button-reminder-dont-remind"
          >
            {dismissing ? "Saving..." : "Don't Remind Me Again"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
