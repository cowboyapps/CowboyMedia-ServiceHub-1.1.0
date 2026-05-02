import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Bell, Mail, RotateCcw } from "lucide-react";
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[85vh] flex flex-col p-0" data-testid="dialog-notification-prefs">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle data-testid="text-notif-prefs-title">Notification preferences</DialogTitle>
          <DialogDescription>
            Choose which notifications you want to receive — push, email, or both — for each event.
          </DialogDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
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
              className="text-xs"
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
              data-testid="button-reset-notif-prefs-self"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset to defaults
            </Button>
          </div>
          {!pushAvailable && (
            <p className="text-xs text-muted-foreground pt-1" data-testid="text-push-unavailable-hint">
              Turn on push notifications above to use the push column.
            </p>
          )}
        </DialogHeader>

        <ScrollArea className="flex-1 px-6 pb-6">
          <TooltipProvider delayDuration={150}>
            <div className="space-y-5">
              {grouped.map(({ group, categories }) => (
                <div key={group} className="space-y-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" data-testid={`heading-group-${group}`}>
                    {group}
                  </h3>
                  <div className="border rounded-md divide-y">
                    {categories.map((cat) => {
                      const pushEnabled = userWantsChannel(prefs, cat.key, "push");
                      const emailEnabled = userWantsChannel(prefs, cat.key, "email");
                      const supportsPush = cat.channels.includes("push");
                      const supportsEmail = cat.channels.includes("email");
                      return (
                        <div key={cat.key} className="flex items-start gap-3 px-3 py-3" data-testid={`row-notif-${cat.key}`}>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{cat.label}</p>
                            <p className="text-xs text-muted-foreground">{cat.description}</p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            {supportsPush ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <label className={`flex items-center gap-1.5 ${pushAvailable ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}>
                                    <Bell className="w-3.5 h-3.5 text-muted-foreground" />
                                    <Switch
                                      checked={pushAvailable && pushEnabled}
                                      onCheckedChange={(checked) =>
                                        toggleMutation.mutate({ categoryKey: cat.key, channel: "push", enabled: checked })
                                      }
                                      disabled={!pushAvailable}
                                      data-testid={`switch-push-${cat.key}`}
                                    />
                                  </label>
                                </TooltipTrigger>
                                {!pushAvailable && (
                                  <TooltipContent side="top">
                                    Enable push notifications above to use this
                                  </TooltipContent>
                                )}
                              </Tooltip>
                            ) : (
                              <span className="w-[64px]" />
                            )}
                            {supportsEmail ? (
                              <label className="flex items-center gap-1.5 cursor-pointer" title="Email notification">
                                <Mail className="w-3.5 h-3.5 text-muted-foreground" />
                                <Switch
                                  checked={emailEnabled}
                                  onCheckedChange={(checked) =>
                                    toggleMutation.mutate({ categoryKey: cat.key, channel: "email", enabled: checked })
                                  }
                                  data-testid={`switch-email-${cat.key}`}
                                />
                              </label>
                            ) : (
                              <span className="w-[64px]" />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </TooltipProvider>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
