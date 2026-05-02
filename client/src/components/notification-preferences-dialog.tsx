import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Bell, Mail, RotateCcw, BellOff } from "lucide-react";
import type { User } from "@shared/schema";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_GROUPS,
  userWantsChannel,
  countEnabledChannels,
  type NotificationChannel,
  type NotificationPrefs,
} from "@shared/notification-categories";

interface NotificationPreferencesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prefs: NotificationPrefs | null | undefined;
  pushAvailable: boolean;
}

const ME_KEY = ["/api/auth/me"] as const;

function applyToggle(
  prefs: NotificationPrefs | null | undefined,
  categoryKey: string,
  channel: NotificationChannel,
  enabled: boolean,
): NotificationPrefs {
  const next: NotificationPrefs = { ...(prefs ?? {}) };
  next[categoryKey] = { ...(next[categoryKey] ?? {}), [channel]: enabled };
  return next;
}

export function NotificationPreferencesDialog({ open, onOpenChange, prefs, pushAvailable }: NotificationPreferencesDialogProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();

  const grouped = useMemo(() => {
    return NOTIFICATION_GROUPS.map((group) => ({
      group,
      categories: NOTIFICATION_CATEGORIES.filter((c) => c.group === group),
    }));
  }, []);

  const pushSummary = countEnabledChannels(prefs, "push");
  const emailSummary = countEnabledChannels(prefs, "email");

  const toggleMutation = useMutation({
    mutationFn: async (vars: { categoryKey: string; channel: NotificationChannel; enabled: boolean }) => {
      await apiRequest("PATCH", "/api/auth/notification-prefs", vars);
    },
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      const previous = queryClient.getQueryData<User>(ME_KEY);
      if (previous) {
        const optimistic: User = {
          ...previous,
          notificationPrefs: applyToggle(previous.notificationPrefs, vars.categoryKey, vars.channel, vars.enabled),
        };
        queryClient.setQueryData<User>(ME_KEY, optimistic);
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ME_KEY, ctx.previous);
      toast({ title: "Failed to update", description: e.message, variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", "/api/auth/notification-prefs", { prefs: {} });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      const previous = queryClient.getQueryData<User>(ME_KEY);
      if (previous) {
        queryClient.setQueryData<User>(ME_KEY, { ...previous, notificationPrefs: {} });
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ME_KEY, ctx.previous);
      toast({ title: "Failed to reset", description: e.message, variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Notification preferences reset to defaults" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  const Header = (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Badge variant="secondary" className="gap-1" data-testid="badge-push-summary">
          <Bell className="w-3 h-3" /> Push {pushSummary.enabled}/{pushSummary.total}
        </Badge>
        <Badge variant="secondary" className="gap-1" data-testid="badge-email-summary">
          <Mail className="w-3 h-3" /> Email {emailSummary.enabled}/{emailSummary.total}
        </Badge>
        <div className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          className="h-8 text-xs"
          onClick={() => resetMutation.mutate()}
          disabled={resetMutation.isPending}
          data-testid="button-reset-notif-prefs-self"
        >
          <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
        </Button>
      </div>
      {!pushAvailable && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 dark:border-amber-700/40 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
          data-testid="text-push-unavailable-hint"
        >
          <BellOff className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Push toggles are disabled. Turn on push notifications first to manage them per category.</span>
        </div>
      )}
    </>
  );

  const Body = (
    <div className="space-y-5">
      {grouped.map(({ group, categories }) => (
        <div key={group} className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1" data-testid={`heading-group-${group}`}>
            {group}
          </h3>
          <div className="border rounded-lg divide-y overflow-hidden bg-card">
            {categories.map((cat) => {
              const pushEnabled = userWantsChannel(prefs, cat.key, "push");
              const emailEnabled = userWantsChannel(prefs, cat.key, "email");
              const supportsPush = cat.channels.includes("push");
              const supportsEmail = cat.channels.includes("email");
              return (
                <div key={cat.key} className="px-3 py-3 sm:px-4" data-testid={`row-notif-${cat.key}`}>
                  <div className="mb-2">
                    <p className="text-sm font-medium leading-snug">{cat.label}</p>
                    <p className="text-xs text-muted-foreground leading-snug mt-0.5">{cat.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {supportsPush ? (
                      <button
                        type="button"
                        onClick={() => {
                          if (!pushAvailable) {
                            toast({ title: "Enable push notifications first", description: "Turn on the master push switch in Settings to use per-category push toggles." });
                            return;
                          }
                          toggleMutation.mutate({ categoryKey: cat.key, channel: "push", enabled: !pushEnabled });
                        }}
                        className={`flex-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 min-h-[44px] text-left transition-colors ${
                          pushAvailable ? "hover-elevate active-elevate-2 cursor-pointer" : "cursor-not-allowed opacity-60"
                        }`}
                        data-testid={`tile-push-${cat.key}`}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <Bell className="w-4 h-4 text-muted-foreground" />
                          Push
                        </span>
                        <Switch
                          checked={pushAvailable && pushEnabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ categoryKey: cat.key, channel: "push", enabled: checked })
                          }
                          disabled={!pushAvailable}
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`switch-push-${cat.key}`}
                          aria-label={`Push notifications for ${cat.label}`}
                        />
                      </button>
                    ) : (
                      <div className="flex-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 min-h-[44px] text-xs text-muted-foreground">
                        <Bell className="w-4 h-4" /> Push not applicable
                      </div>
                    )}
                    {supportsEmail ? (
                      <button
                        type="button"
                        onClick={() => toggleMutation.mutate({ categoryKey: cat.key, channel: "email", enabled: !emailEnabled })}
                        className="flex-1 flex items-center justify-between gap-2 rounded-md border px-3 py-2 min-h-[44px] text-left hover-elevate active-elevate-2 cursor-pointer transition-colors"
                        data-testid={`tile-email-${cat.key}`}
                      >
                        <span className="flex items-center gap-2 text-sm">
                          <Mail className="w-4 h-4 text-muted-foreground" />
                          Email
                        </span>
                        <Switch
                          checked={emailEnabled}
                          onCheckedChange={(checked) =>
                            toggleMutation.mutate({ categoryKey: cat.key, channel: "email", enabled: checked })
                          }
                          onClick={(e) => e.stopPropagation()}
                          data-testid={`switch-email-${cat.key}`}
                          aria-label={`Email notifications for ${cat.label}`}
                        />
                      </button>
                    ) : (
                      <div className="flex-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 min-h-[44px] text-xs text-muted-foreground">
                        <Mail className="w-4 h-4" /> Email not applicable
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-[92vh] p-0 flex flex-col rounded-t-2xl"
          data-testid="dialog-notification-prefs"
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="px-4 pb-3 text-left">
            <SheetTitle data-testid="text-notif-prefs-title">Notification preferences</SheetTitle>
            <SheetDescription className="text-xs">
              Choose push, email, or both for each event.
            </SheetDescription>
            {Header}
          </SheetHeader>
          <ScrollArea className="flex-1 px-3 pb-6">
            {Body}
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] flex flex-col p-0" data-testid="dialog-notification-prefs">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle data-testid="text-notif-prefs-title">Notification preferences</DialogTitle>
          <DialogDescription>
            Choose which notifications you want to receive — push, email, or both — for each event.
          </DialogDescription>
          {Header}
        </DialogHeader>
        <ScrollArea className="flex-1 px-6 pb-6">
          {Body}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
