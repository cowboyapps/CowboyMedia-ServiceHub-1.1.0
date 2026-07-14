import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { Bell, Mail, RotateCcw, BellOff, ChevronDown, Smartphone } from "lucide-react";
import type { User } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { QuietHoursSection } from "@/components/quiet-hours-section";
import {
  NOTIFICATION_PRESETS,
  getCategoriesForRole,
  userWantsChannel,
  countEnabledGroups,
  getGroupChannelState,
  applyGroupChannelToggle,
  buildPresetPrefs,
  matchPreset,
  type AppRole,
  type NotificationCategory,
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

function SectionIcon({ icon: Icon, tone }: { icon: React.ComponentType<{ className?: string }>; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export function NotificationPreferencesDialog({ open, onOpenChange, prefs, pushAvailable }: NotificationPreferencesDialogProps) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const role: AppRole = (user?.role as AppRole) || "customer";
  const visibleCategories = useMemo(() => getCategoriesForRole(role), [role]);

  const grouped = useMemo(() => {
    const groups = Array.from(new Set(visibleCategories.map((c) => c.group)));
    return groups.map((group) => ({
      group,
      categories: visibleCategories.filter((c) => c.group === group),
    }));
  }, [visibleCategories]);

  const inAppSummary = countEnabledGroups(prefs, "in_app", visibleCategories);
  const pushSummary = countEnabledGroups(prefs, "push", visibleCategories);
  const emailSummary = countEnabledGroups(prefs, "email", visibleCategories);
  const currentPreset = matchPreset(prefs, visibleCategories);

  const setPrefsMutation = useMutation({
    mutationFn: async (next: NotificationPrefs) => {
      await apiRequest("PATCH", "/api/auth/notification-prefs", { prefs: next });
    },
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: ME_KEY });
      const previous = queryClient.getQueryData<User>(ME_KEY);
      if (previous) {
        queryClient.setQueryData<User>(ME_KEY, { ...previous, notificationPrefs: next });
      }
      return { previous };
    },
    onError: (e: Error, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(ME_KEY, ctx.previous);
      toast({ title: "Failed to update", description: serverActionErrorMessage(e, "Couldn't update your notification preferences. Please try again."), variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

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
      toast({ title: "Failed to update", description: serverActionErrorMessage(e, "Couldn't update your notification preferences. Please try again."), variant: "destructive" });
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
      toast({ title: "Failed to reset", description: serverActionErrorMessage(e, "Couldn't reset your notification preferences. Please try again."), variant: "destructive" });
    },
    onSuccess: () => {
      toast({ title: "Notification preferences reset to defaults" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ME_KEY });
    },
  });

  const handleGroupToggle = (group: string, channel: NotificationChannel, enabled: boolean) => {
    if (channel === "push" && !pushAvailable) {
      toast({ title: "Enable push notifications first", description: "Turn on the master push switch in Settings to use per-category push toggles." });
      return;
    }
    const next = applyGroupChannelToggle(prefs, group, channel, enabled, visibleCategories);
    setPrefsMutation.mutate(next);
  };

  const handlePreset = (presetKey: string) => {
    const preset = NOTIFICATION_PRESETS.find((p) => p.key === presetKey);
    if (!preset) return;
    const next = buildPresetPrefs(preset, visibleCategories);
    setPrefsMutation.mutate(next, {
      onSuccess: () => toast({ title: `Preset applied: ${preset.label}` }),
    });
  };

  const Header = (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Badge variant="secondary" className="gap-1" data-testid="badge-in-app-summary">
          <Bell className="w-3 h-3" /> Bell {inAppSummary.enabled}/{inAppSummary.total} groups
        </Badge>
        <Badge variant="secondary" className="gap-1" data-testid="badge-push-summary">
          <Smartphone className="w-3 h-3" /> Push {pushSummary.enabled}/{pushSummary.total} groups
        </Badge>
        <Badge variant="secondary" className="gap-1" data-testid="badge-email-summary">
          <Mail className="w-3 h-3" /> Email {emailSummary.enabled}/{emailSummary.total} groups
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

  const Presets = (
    <div className="mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-1 mb-1.5">
        Quick presets
      </div>
      <div className="grid grid-cols-3 gap-1.5 rounded-lg border bg-muted/40 p-1">
        {NOTIFICATION_PRESETS.map((preset) => {
          const active = currentPreset === preset.key;
          return (
            <button
              key={preset.key}
              type="button"
              onClick={() => handlePreset(preset.key)}
              disabled={setPrefsMutation.isPending}
              className={`flex flex-col items-center justify-center gap-0.5 rounded-md px-2 py-2 min-h-[44px] text-xs font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-card hover-elevate active-elevate-2 text-foreground"
              }`}
              data-testid={`button-preset-${preset.key}`}
            >
              <span className="leading-tight">{preset.label}</span>
            </button>
          );
        })}
      </div>
      {currentPreset === null && (
        <div className="mt-1.5 px-1 text-[11px] text-muted-foreground" data-testid="text-preset-custom">
          Custom — your toggles below don't match any preset.
        </div>
      )}
    </div>
  );

  const renderCategoryRow = (cat: NotificationCategory) => {
    const inAppEnabled = userWantsChannel(prefs, cat.key, "in_app");
    const pushEnabled = userWantsChannel(prefs, cat.key, "push");
    const emailEnabled = userWantsChannel(prefs, cat.key, "email");
    const supportsInApp = cat.channels.includes("in_app");
    const supportsPush = cat.channels.includes("push");
    const supportsEmail = cat.channels.includes("email");
    return (
      <div key={cat.key} className="px-5 py-3.5" data-testid={`row-notif-${cat.key}`}>
        <div className="mb-3">
          <p className="text-sm font-medium leading-snug">{cat.label}</p>
          <p className="text-xs text-muted-foreground leading-snug mt-0.5">{cat.description}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {supportsInApp ? (
            <div
              className="flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 min-h-[44px]"
              data-testid={`tile-in-app-${cat.key}`}
            >
              <span className="flex items-center gap-2 text-sm">
                <Bell className="w-4 h-4 text-muted-foreground" /> Bell
              </span>
              <Switch
                checked={inAppEnabled}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ categoryKey: cat.key, channel: "in_app", enabled: checked })
                }
                data-testid={`switch-in-app-${cat.key}`}
                aria-label={`In-app bell for ${cat.label}`}
              />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-md border border-dashed px-3 py-2 min-h-[44px] text-xs text-muted-foreground">
              <Bell className="w-4 h-4" /> Bell not applicable
            </div>
          )}
          {supportsPush ? (
            <div
              className={`flex-1 flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 min-h-[44px] ${
                pushAvailable ? "" : "opacity-60"
              }`}
              data-testid={`tile-push-${cat.key}`}
            >
              <span className="flex items-center gap-2 text-sm">
                <Smartphone className="w-4 h-4 text-muted-foreground" /> Push
              </span>
              <Switch
                checked={pushAvailable && pushEnabled}
                onCheckedChange={(checked) => {
                  if (!pushAvailable) {
                    toast({ title: "Enable push notifications first", description: "Turn on the master push switch in Settings to use per-category push toggles." });
                    return;
                  }
                  toggleMutation.mutate({ categoryKey: cat.key, channel: "push", enabled: checked });
                }}
                disabled={!pushAvailable}
                data-testid={`switch-push-${cat.key}`}
                aria-label={`Push notifications for ${cat.label}`}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 min-h-[44px] text-xs text-muted-foreground">
              <Smartphone className="w-4 h-4" /> Push not applicable
            </div>
          )}
          {supportsEmail ? (
            <div
              className="flex-1 flex items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 min-h-[44px]"
              data-testid={`tile-email-${cat.key}`}
            >
              <span className="flex items-center gap-2 text-sm">
                <Mail className="w-4 h-4 text-muted-foreground" /> Email
              </span>
              <Switch
                checked={emailEnabled}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ categoryKey: cat.key, channel: "email", enabled: checked })
                }
                data-testid={`switch-email-${cat.key}`}
                aria-label={`Email notifications for ${cat.label}`}
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 min-h-[44px] text-xs text-muted-foreground">
              <Mail className="w-4 h-4" /> Email not applicable
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderGroupCard = (group: string, categories: NotificationCategory[]) => {
    const inAppState = getGroupChannelState(prefs, group, "in_app", visibleCategories);
    const pushState = getGroupChannelState(prefs, group, "push", visibleCategories);
    const emailState = getGroupChannelState(prefs, group, "email", visibleCategories);
    const isExpanded = !!expanded[group];
    const isMixed = inAppState === "mixed" || pushState === "mixed" || emailState === "mixed";

    return (
      <Collapsible
        key={group}
        open={isExpanded}
        onOpenChange={(o) => setExpanded((prev) => ({ ...prev, [group]: o }))}
        className="rounded-xl border border-card-border bg-card overflow-hidden"
      >
        <div className="px-5 py-4 flex items-center gap-3">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex-1 flex items-center gap-3 text-left min-h-[44px] hover-elevate active-elevate-2 -ml-2 px-2 rounded-md"
              data-testid={`button-expand-group-${group}`}
              aria-label={`${isExpanded ? "Collapse" : "Expand"} ${group} details`}
            >
              <SectionIcon icon={Bell} tone="bg-primary/10 text-primary" />
              <div className="flex flex-col min-w-0 flex-1">
                <span className="text-sm font-semibold flex items-center gap-2" data-testid={`heading-group-${group}`}>
                  {group}
                  <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </span>
                <span className="text-[11px] text-muted-foreground mt-0.5">
                  {categories.length} {categories.length === 1 ? "type" : "types"}
                  {isMixed && " · Custom"}
                </span>
              </div>
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            {inAppState !== "n/a" ? (
              <label className="flex flex-col items-center gap-0.5 cursor-pointer" data-testid={`tile-group-in-app-${group}`}>
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Bell className={`w-3 h-3 ${inAppState === "mixed" ? "text-amber-500" : ""}`} />
                  Bell
                </span>
                <Switch
                  checked={inAppState === "on"}
                  onCheckedChange={(checked) => handleGroupToggle(group, "in_app", checked)}
                  data-testid={`switch-group-in-app-${group}`}
                  aria-label={`In-app bell for ${group}`}
                />
              </label>
            ) : (
              <div className="flex flex-col items-center gap-0.5 opacity-30">
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
                  <Bell className="w-3 h-3" /> Bell
                </span>
                <span className="text-[10px]">—</span>
              </div>
            )}
            {pushState !== "n/a" ? (
              <label className="flex flex-col items-center gap-0.5 cursor-pointer" data-testid={`tile-group-push-${group}`}>
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Smartphone className={`w-3 h-3 ${pushState === "mixed" ? "text-amber-500" : ""}`} />
                  Push
                </span>
                <Switch
                  checked={pushAvailable && pushState === "on"}
                  onCheckedChange={(checked) => handleGroupToggle(group, "push", checked)}
                  disabled={!pushAvailable}
                  data-testid={`switch-group-push-${group}`}
                  aria-label={`Push for ${group}`}
                />
              </label>
            ) : (
              <div className="flex flex-col items-center gap-0.5 opacity-30">
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
                  <Bell className="w-3 h-3" /> Push
                </span>
                <span className="text-[10px]">—</span>
              </div>
            )}
            {emailState !== "n/a" ? (
              <label className="flex flex-col items-center gap-0.5 cursor-pointer" data-testid={`tile-group-email-${group}`}>
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Mail className={`w-3 h-3 ${emailState === "mixed" ? "text-amber-500" : ""}`} />
                  Email
                </span>
                <Switch
                  checked={emailState === "on"}
                  onCheckedChange={(checked) => handleGroupToggle(group, "email", checked)}
                  data-testid={`switch-group-email-${group}`}
                  aria-label={`Email for ${group}`}
                />
              </label>
            ) : (
              <div className="flex flex-col items-center gap-0.5 opacity-30">
                <span className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide">
                  <Mail className="w-3 h-3" /> Email
                </span>
                <span className="text-[10px]">—</span>
              </div>
            )}
          </div>
        </div>
        <CollapsibleContent>
          <div className="border-t border-border divide-y divide-border bg-muted/10">
            {categories.map(renderCategoryRow)}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  };

  const Body = (
    <div>
      {Presets}
      <div className="mb-4">
        <QuietHoursSection />
      </div>
      <div className="space-y-2">
        {grouped.map(({ group, categories }) => renderGroupCard(group, categories))}
      </div>
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
              Pick a preset or toggle each group. Tap a group to fine-tune individual notifications.
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
            Pick a preset or toggle each group. Click a group to fine-tune individual notifications.
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
