import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, isSubscribedToPush } from "@/lib/push-notifications";
import { Input } from "@/components/ui/input";
import { User, Mail, Moon, Sun, Bell, BellOff, Download, Smartphone, ExternalLink, SlidersHorizontal, HelpCircle, PlayCircle, Monitor, LogOut } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { replayOnboardingTour, ONBOARDING_OPEN_NOTIF_PREFS_EVENT } from "@/components/onboarding-tour";
import type { Service } from "@shared/schema";
import { countEnabledGroups, getCategoriesForRole, type AppRole, type NotificationPrefs } from "@shared/notification-categories";
import { NotificationPreferencesDialog } from "@/components/notification-preferences-dialog";
import { TwoFactorSecurityCard } from "@/components/two-factor-security";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type SessionRow = {
  sid: string;
  deviceLabel: string;
  device: string;
  browser: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  expire: string | null;
  current: boolean;
};

function ActiveSessionsCard() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SessionRow[]>({ queryKey: ["/api/me/sessions"] });
  const [confirmAll, setConfirmAll] = useState(false);

  const signOutOne = useMutation({
    mutationFn: async (sid: string) => {
      const res = await apiRequest("DELETE", `/api/me/sessions/${encodeURIComponent(sid)}`);
      return res.json() as Promise<{ ok: boolean; self: boolean }>;
    },
    onSuccess: (result) => {
      if (result.self) {
        window.location.href = "/auth";
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/me/sessions"] });
      toast({ title: "Session signed out" });
    },
    onError: (e: Error) => toast({ title: "Failed to sign out session", description: e.message, variant: "destructive" }),
  });

  const signOutAll = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/me/sessions");
      return res.json() as Promise<{ ok: boolean; removed: number }>;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/sessions"] });
      toast({ title: `Signed out ${result.removed} other session${result.removed === 1 ? "" : "s"}` });
      setConfirmAll(false);
    },
    onError: (e: Error) => toast({ title: "Failed to sign out", description: e.message, variant: "destructive" }),
  });

  const sessions = (data || []).slice().sort((a, b) => {
    if (a.current && !b.current) return -1;
    if (!a.current && b.current) return 1;
    const at = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
    const bt = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
    return bt - at;
  });
  const otherCount = sessions.filter(s => !s.current).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Monitor className="w-4 h-4" />
          Active Sessions
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">Devices currently signed in to your account.</p>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-14" />)}
          </div>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div
                key={s.sid}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
                data-testid={`row-session-${s.sid}`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium" data-testid={`text-device-${s.sid}`}>{s.deviceLabel}</p>
                    {s.current && (
                      <Badge variant="secondary" className="text-[10px] px-1.5" data-testid={`badge-current-${s.sid}`}>This device</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {s.ip ? `${s.ip} • ` : ""}
                    {s.lastSeenAt ? `Last active ${formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}` : "Last active unknown"}
                  </p>
                  {s.createdAt && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Signed in {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
                    </p>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => signOutOne.mutate(s.sid)}
                  disabled={signOutOne.isPending}
                  data-testid={`button-signout-${s.sid}`}
                >
                  <LogOut className="w-3.5 h-3.5 mr-1" />
                  {s.current ? "Sign out" : "Revoke"}
                </Button>
              </div>
            ))}
          </div>
        )}
        {otherCount > 0 && (
          <div className="pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAll(true)}
              data-testid="button-signout-others"
            >
              Sign out all other sessions ({otherCount})
            </Button>
          </div>
        )}
      </CardContent>
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out other sessions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will revoke {otherCount} session{otherCount === 1 ? "" : "s"} other than this device. Those devices will need to sign in again.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-confirm-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => signOutAll.mutate()} data-testid="button-confirm-signout-others">
              Sign out others
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { theme, resolvedTheme, setTheme } = useTheme();
  const { toast } = useToast();

  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [prefsDialogOpen, setPrefsDialogOpen] = useState(false);
  const [pushPromptOpen, setPushPromptOpen] = useState(false);
  const [enablingPushFromPrompt, setEnablingPushFromPrompt] = useState(false);

  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const [fullName, setFullName] = useState(user?.fullName || "");

  const [selectedServices, setSelectedServices] = useState<string[]>(
    user?.subscribedServices || []
  );

  const fullNameMutation = useMutation({
    mutationFn: async (newFullName: string) => {
      await apiRequest("PATCH", "/api/auth/settings", { fullName: newFullName });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Full name updated" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to update name", description: e.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    isPushSupported().then(setPushSupported);
    isSubscribedToPush().then(setPushEnabled);

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  useEffect(() => {
    const onOpen = () => setPrefsDialogOpen(true);
    window.addEventListener(ONBOARDING_OPEN_NOTIF_PREFS_EVENT, onOpen);
    return () => window.removeEventListener(ONBOARDING_OPEN_NOTIF_PREFS_EVENT, onOpen);
  }, []);

  const handlePushToggle = async (checked: boolean) => {
    setPushLoading(true);
    try {
      if (checked) {
        const success = await subscribeToPush();
        if (success) {
          setPushEnabled(true);
          toast({ title: "Push notifications enabled" });
        } else {
          toast({ title: "Could not enable notifications", description: "Please allow notifications in your browser settings", variant: "destructive" });
        }
      } else {
        await unsubscribeFromPush();
        setPushEnabled(false);
        toast({ title: "Push notifications disabled" });
      }
    } catch {
      toast({ title: "Error toggling notifications", variant: "destructive" });
    }
    setPushLoading(false);
  };

  const handleOpenPrefs = () => {
    if (pushSupported && !pushEnabled) {
      setPushPromptOpen(true);
      return;
    }
    setPrefsDialogOpen(true);
  };

  const handleEnablePushAndOpen = async () => {
    setEnablingPushFromPrompt(true);
    try {
      const success = await subscribeToPush();
      if (success) {
        setPushEnabled(true);
        toast({ title: "Push notifications enabled" });
      } else {
        toast({
          title: "Could not enable notifications",
          description: "Please allow notifications in your browser settings",
          variant: "destructive",
        });
      }
    } catch {
      toast({ title: "Error enabling notifications", variant: "destructive" });
    }
    setEnablingPushFromPrompt(false);
    setPushPromptOpen(false);
    setPrefsDialogOpen(true);
  };

  const handleSkipPushAndOpen = () => {
    setPushPromptOpen(false);
    setPrefsDialogOpen(true);
  };

  const handleInstallApp = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const result = await installPrompt.userChoice;
      if (result.outcome === "accepted") {
        setInstallPrompt(null);
        toast({ title: "App installed successfully" });
      }
    }
  };

  const updateMutation = useMutation({
    mutationFn: async (subscribedServices: string[]) => {
      await apiRequest("PATCH", "/api/auth/settings", { subscribedServices });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Preferences saved" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to save", description: e.message, variant: "destructive" });
    },
  });

  const toggleService = (serviceId: string) => {
    setSelectedServices((prev) =>
      prev.includes(serviceId)
        ? prev.filter((id) => id !== serviceId)
        : [...prev, serviceId]
    );
  };

  const savePreferences = () => {
    updateMutation.mutate(selectedServices);
  };

  if (!user) return null;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-settings-title">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage your account and preferences</p>
      </div>

      <Card>
        <CardContent className="flex items-center gap-4 p-6">
          <Avatar className="w-16 h-16">
            <AvatarFallback className="text-lg">{user.fullName[0]}</AvatarFallback>
          </Avatar>
          <div className="space-y-0.5">
            <h2 className="font-semibold text-lg" data-testid="text-settings-name">{user.fullName}</h2>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <Mail className="w-3.5 h-3.5" /> {user.email}
            </p>
            <p className="text-sm text-muted-foreground flex items-center gap-1">
              <User className="w-3.5 h-3.5" /> @{user.username}
            </p>
            <Badge variant="secondary" className="text-xs capitalize mt-1">{user.role}</Badge>
          </div>
        </CardContent>
      </Card>

      {installPrompt && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone className="w-4 h-4" />
              Install App
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Add to Home Screen</p>
                <p className="text-xs text-muted-foreground">Install ServiceHub for a native app experience</p>
              </div>
              <Button onClick={handleInstallApp} data-testid="button-install-app">
                <Download className="w-4 h-4 mr-2" />
                Install
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4" />
            Update Full Name
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Label htmlFor="fullName" className="text-sm">Please enter your full name as it appears on your online account</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Full Name"
            data-testid="input-full-name"
          />
          <Button
            onClick={() => fullNameMutation.mutate(fullName)}
            disabled={fullNameMutation.isPending}
            data-testid="button-save-fullname"
          >
            {fullNameMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="w-4 h-4" />
            Online Account
          </CardTitle>
        </CardHeader>
        <CardContent>
          <a
            href="http://cowboymedia.net/billing"
            target="_blank"
            rel="noopener noreferrer"
            data-testid="button-online-account"
          >
            <Button>
              <ExternalLink className="w-4 h-4 mr-2" />
              Login to my online account
            </Button>
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {resolvedTheme === "dark" ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            Appearance
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              variant={theme === "system" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("system")}
              data-testid="button-theme-system"
            >
              System
            </Button>
            <Button
              variant={theme === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("light")}
              data-testid="button-theme-light"
            >
              <Sun className="w-4 h-4 mr-1" /> Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("dark")}
              data-testid="button-theme-dark"
            >
              <Moon className="w-4 h-4 mr-1" /> Dark
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {theme === "system" ? "Automatically matches your device settings" : `Using ${theme} theme`}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {pushSupported && (
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">Enable Push Notifications</p>
                <p className="text-xs text-muted-foreground">Master switch for push notifications on this device</p>
              </div>
              <Switch
                checked={pushEnabled}
                onCheckedChange={handlePushToggle}
                disabled={pushLoading}
                data-testid="switch-push-notifications"
              />
            </div>
          )}
          {(() => {
            const prefs: NotificationPrefs | null | undefined = user?.notificationPrefs;
            const visible = getCategoriesForRole((user?.role as AppRole) || "customer");
            const pushSummary = countEnabledGroups(prefs, "push", visible);
            const emailSummary = countEnabledGroups(prefs, "email", visible);
            return (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Notification preferences</p>
                  <p className="text-xs text-muted-foreground">
                    Push {pushSummary.enabled}/{pushSummary.total} groups · Email {emailSummary.enabled}/{emailSummary.total} groups
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleOpenPrefs}
                  data-testid="button-open-notif-prefs"
                >
                  <SlidersHorizontal className="w-4 h-4 mr-1.5" /> Manage
                </Button>
              </div>
            );
          })()}
        </CardContent>
      </Card>

      {(user.role === "admin" || user.role === "master_admin") && <TwoFactorSecurityCard />}

      <NotificationPreferencesDialog
        open={prefsDialogOpen}
        onOpenChange={setPrefsDialogOpen}
        prefs={user?.notificationPrefs}
        pushAvailable={pushSupported && pushEnabled}
      />

      <AlertDialog open={pushPromptOpen} onOpenChange={setPushPromptOpen}>
        <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-push-prompt">
          <AlertDialogHeader>
            <AlertDialogTitle data-testid="text-push-prompt-title">Enable push notifications?</AlertDialogTitle>
            <AlertDialogDescription>
              Push notifications aren't on yet for this device. Turn them on now to get instant alerts, or continue without push to manage email-only preferences.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col-reverse sm:flex-row gap-2">
            <AlertDialogCancel
              onClick={handleSkipPushAndOpen}
              disabled={enablingPushFromPrompt}
              data-testid="button-push-prompt-skip"
            >
              No, continue
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleEnablePushAndOpen();
              }}
              disabled={enablingPushFromPrompt}
              data-testid="button-push-prompt-enable"
            >
              {enablingPushFromPrompt ? "Enabling..." : "Yes, enable push"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ActiveSessionsCard />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Service Subscriptions
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Select which services you want to receive alerts for</p>
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8" />)}
            </div>
          ) : !services || services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services available</p>
          ) : (
            <div className="space-y-3">
              {services.map((service) => (
                <div key={service.id} className="flex items-center gap-3" data-testid={`checkbox-service-${service.id}`}>
                  <Checkbox
                    id={service.id}
                    checked={selectedServices.includes(service.id)}
                    onCheckedChange={() => toggleService(service.id)}
                  />
                  <Label htmlFor={service.id} className="text-sm cursor-pointer flex-1">
                    {service.name}
                    {service.description && (
                      <span className="text-muted-foreground ml-1">- {service.description}</span>
                    )}
                  </Label>
                </div>
              ))}
            </div>
          )}
          <Button onClick={savePreferences} disabled={updateMutation.isPending} data-testid="button-save-preferences">
            {updateMutation.isPending ? "Saving..." : "Save Preferences"}
          </Button>
        </CardContent>
      </Card>

      {user.role === "customer" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              Help
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">Replay onboarding tour</p>
                <p className="text-xs text-muted-foreground">Walk through the app's main sections again.</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => replayOnboardingTour()}
                data-testid="button-replay-tour"
              >
                <PlayCircle className="w-4 h-4 mr-1.5" /> Replay
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <p className="text-center text-xs text-muted-foreground mt-6 mb-1" data-testid="text-app-version">
        Version 4.4
      </p>
      <p className="text-center text-xs text-muted-foreground mb-2" data-testid="text-developed-by">
        Developed by CowboyApps
      </p>
    </div>
  );
}
