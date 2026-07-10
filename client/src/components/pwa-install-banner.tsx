import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { useToast } from "@/hooks/use-toast";
import {
  usePwaInstall,
  isInstallDismissActive,
  recordInstallDismiss,
} from "@/hooks/use-pwa-install";
import {
  getSetupReminderOpen,
  subscribeSetupReminder,
} from "@/lib/setup-reminder-state";

// Small delay before the banner slides in, so it doesn't flash on first paint
// and so any higher-priority popup (setup reminder, welcome dialog) settles
// first.
export const PWA_BANNER_SHOW_DELAY_MS = 2500;

export function PwaInstallBanner() {
  const { canPromptInstall, isIOSSafari, promptInstall } = usePwaInstall();
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const setupReminderOpen = useSyncExternalStore(
    subscribeSetupReminder,
    getSetupReminderOpen,
    getSetupReminderOpen,
  );

  const [dismissed, setDismissed] = useState<boolean>(() => isInstallDismissActive());
  const [ready, setReady] = useState(false);

  const eligible = (canPromptInstall || isIOSSafari) && !dismissed;

  useEffect(() => {
    if (!eligible) {
      setReady(false);
      return;
    }
    const t = setTimeout(() => setReady(true), PWA_BANNER_SHOW_DELAY_MS);
    return () => clearTimeout(t);
  }, [eligible]);

  if (!eligible || !ready || setupReminderOpen) return null;

  const handleInstall = async () => {
    const outcome = await promptInstall();
    if (outcome === "accepted") {
      toast({ title: "Installing ServiceHub", description: "You'll find it on your home screen." });
      setDismissed(true);
    } else if (outcome === "dismissed") {
      // User declined the native prompt — respect that with the cool-off.
      recordInstallDismiss();
      setDismissed(true);
    }
  };

  const handleDismiss = () => {
    recordInstallDismiss();
    setDismissed(true);
  };

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-40 w-[calc(100%-1.5rem)] max-w-md"
      style={{
        bottom: isMobile
          ? "calc(4rem + var(--sab, env(safe-area-inset-bottom, 0px)))"
          : "calc(1.5rem + var(--sab, env(safe-area-inset-bottom, 0px)))",
      }}
      role="dialog"
      aria-label="Install ServiceHub"
      data-testid="banner-pwa-install"
    >
      <div className="rounded-xl border bg-card text-card-foreground shadow-lg p-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" data-testid="text-pwa-install-title">
            Install ServiceHub
          </p>
          {isIOSSafari ? (
            <p className="text-sm text-muted-foreground mt-1" data-testid="text-pwa-install-ios-guide">
              Tap the <Share className="inline w-3.5 h-3.5 align-text-bottom mx-0.5" aria-label="Share" />
              Share button, then <span className="font-medium text-foreground">Add to Home Screen</span>
              <Plus className="inline w-3.5 h-3.5 align-text-bottom mx-0.5" aria-label="Add" />
              to install the app and get push notifications.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              Add it to your home screen for faster access and instant push notifications.
            </p>
          )}
          {!isIOSSafari && (
            <div className="mt-3">
              <Button size="sm" onClick={handleInstall} data-testid="button-pwa-install">
                <Download className="w-4 h-4 mr-1.5" />
                Install
              </Button>
            </div>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 flex-shrink-0 text-muted-foreground"
          onClick={handleDismiss}
          aria-label="Dismiss install banner"
          data-testid="button-pwa-install-dismiss"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
