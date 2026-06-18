import { useState, useEffect } from "react";
import { Link } from "wouter";
import { APP_VERSION, versionAnchor } from "@shared/version";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme-provider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { isPushSupported, subscribeToPush, unsubscribeFromPush, isSubscribedToPush } from "@/lib/push-notifications";
import { Input } from "@/components/ui/input";
import { User, Mail, Moon, Sun, Bell, BellOff, Download, Smartphone, CreditCard, SlidersHorizontal, HelpCircle, PlayCircle, Monitor, LogOut, ImagePlus, Trash2, CheckCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { replayOnboardingTour, ONBOARDING_OPEN_NOTIF_PREFS_EVENT } from "@/components/onboarding-tour";
import type { Service } from "@shared/schema";
import { countEnabledGroups, getCategoriesForRole, type AppRole, type NotificationPrefs } from "@shared/notification-categories";
import { isInQuietHours, type QuietHoursUser } from "@shared/quiet-hours";
import { NotificationPreferencesDialog } from "@/components/notification-preferences-dialog";
import { TwoFactorSecurityCard } from "@/components/two-factor-security";
import { WhmcsLinkDialog } from "@/components/whmcs-link-dialog";
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

function ProfileEditorCard({ user }: { user: { id: string; fullName: string; avatarUrl: string | null; bio: string | null } }) {
  const { toast } = useToast();
  const [bio, setBio] = useState(user.bio || "");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setBio(user.bio || "");
  }, [user.bio]);

  const saveBioMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { bio });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Profile updated" });
    },
    onError: (e: any) => {
      toast({ title: "Update failed", description: serverActionErrorMessage(e, "Couldn't update your profile. Please try again."), variant: "destructive" });
    },
  });

  const removeAvatarMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/profile", { avatarUrl: null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Avatar removed" });
    },
    onError: (e: any) => {
      toast({ title: "Remove failed", description: serverActionErrorMessage(e, "Couldn't remove your avatar. Please try again."), variant: "destructive" });
    },
  });

  const handleAvatarFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please choose an image.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Maximum 5MB.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/auth/profile/avatar", { method: "POST", body: fd, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Avatar updated" });
    } catch (e: any) {
      toast({ title: "Upload failed", description: serverActionErrorMessage(e, "Couldn't upload your avatar. Please try again."), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const remaining = 280 - bio.length;
  const dirty = (user.bio || "") !== bio.trim();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <User className="w-4 h-4" /> Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar className="w-16 h-16">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName} />}
            <AvatarFallback className="text-lg">{user.fullName[0]}</AvatarFallback>
          </Avatar>
          <div className="flex flex-col gap-1.5">
            <label>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                data-testid="input-avatar-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleAvatarFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={uploading}
                data-testid="button-upload-avatar"
                asChild
              >
                <span className="cursor-pointer">
                  <ImagePlus className="w-3.5 h-3.5 mr-1.5" />
                  {uploading ? "Uploading..." : user.avatarUrl ? "Change avatar" : "Upload avatar"}
                </span>
              </Button>
            </label>
            {user.avatarUrl && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => removeAvatarMutation.mutate()}
                disabled={removeAvatarMutation.isPending}
                data-testid="button-remove-avatar"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Remove
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="profile-bio">Bio</Label>
          <Textarea
            id="profile-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value.slice(0, 280))}
            placeholder="Tell others a little about yourself..."
            rows={3}
            data-testid="input-profile-bio"
          />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{remaining} characters left</p>
            <Button
              size="sm"
              onClick={() => saveBioMutation.mutate()}
              disabled={saveBioMutation.isPending || !dirty}
              data-testid="button-save-bio"
            >
              {saveBioMutation.isPending ? "Saving..." : "Save bio"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

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
    onError: (e: Error) => toast({ title: "Failed to sign out session", description: serverActionErrorMessage(e, "Couldn't sign out that session. Please try again."), variant: "destructive" }),
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
    onError: (e: Error) => toast({ title: "Failed to sign out", description: serverActionErrorMessage(e, "Couldn't sign out your other sessions. Please try again."), variant: "destructive" }),
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
  const [whmcsLinkOpen, setWhmcsLinkOpen] = useState(false);

  const { data: whmcsLinkStatus } = useQuery<{
    configured: boolean;
    enabled: boolean;
    linked: boolean;
    dismissed: boolean;
  }>({
    queryKey: ["/api/whmcs/link/status"],
    enabled: !!user && user.role === "customer",
  });
  const whmcsConfigured = !!whmcsLinkStatus?.configured && !!whmcsLinkStatus?.enabled;
  const whmcsLinked = !!whmcsLinkStatus?.linked;

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
      toast({ title: "Failed to update name", description: serverActionErrorMessage(e, "Couldn't update your name. Please try again."), variant: "destructive" });
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
        const result = await subscribeToPush();
        if (result.ok) {
          toast({ title: "Push notifications enabled" });
        } else {
          toast({
            title: "Could not enable notifications",
            description: result.reason,
            variant: "destructive",
          });
        }
      } else {
        const success = await unsubscribeFromPush();
        if (success) {
          toast({ title: "Push notifications disabled" });
        } else {
          toast({ title: "Could not disable notifications", description: "Please try again.", variant: "destructive" });
        }
      }
    } catch {
      toast({ title: "Error toggling notifications", variant: "destructive" });
    } finally {
      // Always reconcile the switch with the browser's real subscription state
      // and clear the loading flag, so the toggle can never get stuck disabled.
      setPushEnabled(await isSubscribedToPush());
      setPushLoading(false);
    }
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
      const result = await subscribeToPush();
      if (result.ok) {
        setPushEnabled(true);
        toast({ title: "Push notifications enabled" });
      } else {
        toast({
          title: "Could not enable notifications",
          description: result.reason,
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
      toast({ title: "Failed to save", description: serverActionErrorMessage(e, "Couldn't save your preferences. Please try again."), variant: "destructive" });
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
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.fullName} />}
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

      <ProfileEditorCard user={user} />
      

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

      {whmcsConfigured && (
        <Card data-testid="card-whmcs-link">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CreditCard className="w-4 h-4" />
              {whmcsLinked ? "Account linked" : "Link your account"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {whmcsLinked ? (
              <div
                className="flex items-center gap-2 text-sm text-green-600 dark:text-green-500"
                data-testid="status-whmcs-linked"
              >
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span>Your billing account is connected. Your invoices and payments appear below.</span>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Connect your account management profile to view your invoices, payments, services, and
                  reminders right here in the app.
                </p>
                <Button onClick={() => setWhmcsLinkOpen(true)} data-testid="button-open-whmcs-link">
                  <CreditCard className="w-4 h-4 mr-2" />
                  Link your account
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Billing &amp; Invoices
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Link href="/billing" data-testid="button-online-account">
            <Button>
              <CreditCard className="w-4 h-4 mr-2" />
              View billing &amp; invoices
            </Button>
          </Link>
        </CardContent>
      </Card>

      <WhmcsLinkDialog open={whmcsLinkOpen} onOpenChange={setWhmcsLinkOpen} />

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
            const qhUser = user as QuietHoursUser;
            const quietActive = isInQuietHours(qhUser);
            const quietSummary = qhUser?.quietHoursEnabled
              ? `${qhUser.quietHoursStart || "22:00"}–${qhUser.quietHoursEnd || "07:00"} ${qhUser.quietHoursTimezone || "UTC"}`
              : "Off";
            return (
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium">Notification preferences</p>
                  <p className="text-xs text-muted-foreground">
                    Push {pushSummary.enabled}/{pushSummary.total} groups · Email {emailSummary.enabled}/{emailSummary.total} groups
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-quiet-hours-summary">
                    Quiet hours: {quietSummary}
                    {quietActive && (
                      <span className="ml-1.5 inline-flex items-center rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium" data-testid="badge-settings-quiet-active">
                        Active now
                      </span>
                    )}
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

      <Card data-testid="card-service-subscriptions">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Service notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">Choose which services you want to hear about. We'll only alert you about the ones you pick here.</p>
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
        Version {APP_VERSION}
      </p>
      <p className="text-center text-xs mb-1">
        <Link href={`/whats-new#${versionAnchor(APP_VERSION)}`} className="text-primary hover:underline" data-testid="link-whats-new">
          What&apos;s new in this version
        </Link>
      </p>
      <p className="text-center text-xs text-muted-foreground mb-2" data-testid="text-developed-by">
        Developed by CowboyApps
      </p>
    </div>
  );
}
