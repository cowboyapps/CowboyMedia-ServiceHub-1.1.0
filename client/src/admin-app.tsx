// Root component of the ADMIN PWA (/admin). A slim, staff-only shell around
// the existing AdminPortal page: its own login screen (admins/master admins
// only — customers are rejected with a clear message), its own header, and the
// admin-relevant popups. Customer-facing chrome (sidebar, bottom nav, tours,
// welcome dialogs, install banners) intentionally does not exist here.

import { useState, useEffect, lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { AppErrorBoundary } from "@/components/error-boundary";
import { OfflineBanner } from "@/components/offline-banner";
import { GlobalSocketProvider } from "@/contexts/global-socket-context";
import { NotificationCenter } from "@/components/notification-center";
import { BrandLogo } from "@/components/brand-logo";
import { ChangelogPublishPrompt } from "@/components/changelog-publish-prompt";
import {
  AdminAwayBanner,
  BroadcastAlertPopup,
  TicketTransferPopup,
  LocationPresenceSync,
} from "@/components/shared-shell";
import { useAppBadge } from "@/hooks/use-app-badge";
import {
  syncPushSubscription,
  isPushSupported,
  isSubscribedToPush,
  subscribeToPush,
  unsubscribeFromPush,
} from "@/lib/push-notifications";
import { NotificationPreferencesDialog } from "@/components/notification-preferences-dialog";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "./lib/queryClient";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { serverActionErrorMessage } from "@/lib/server-error";
import { loginSchema, type LoginData } from "@shared/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Shield, ShieldAlert, LogOut, Settings, SlidersHorizontal, Bell } from "lucide-react";

const AdminPortal = lazy(() => import("@/pages/admin-portal"));

function AdminLoginPage() {
  const { login, verifyTwoFactor } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingChallengeId, setPendingChallengeId] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const loginForm = useForm<LoginData>({
    resolver: zodResolver(loginSchema),
    defaultValues: { username: "", password: "" },
  });

  const handleLogin = async (data: LoginData) => {
    setIsSubmitting(true);
    try {
      const result = await login(data);
      if (result?.twoFactorRequired && result.challengeId) {
        setPendingChallengeId(result.challengeId);
        setTwoFactorCode("");
      } else {
        toast({ title: "Welcome back!" });
      }
    } catch (e: any) {
      toast({
        title: "Login failed",
        description: serverActionErrorMessage(e, "Couldn't sign you in. Please check your details and try again."),
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleVerifyTwoFactor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingChallengeId) return;
    setIsSubmitting(true);
    try {
      await verifyTwoFactor(pendingChallengeId, twoFactorCode);
      toast({ title: "Welcome back!" });
      setPendingChallengeId(null);
      setTwoFactorCode("");
    } catch (e: any) {
      const msg = e?.message || "";
      if (msg.includes("expired") || msg.includes("Too many")) {
        setPendingChallengeId(null);
        setTwoFactorCode("");
        loginForm.reset();
      }
      toast({ title: "Verification failed", description: msg, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelTwoFactor = () => {
    setPendingChallengeId(null);
    setTwoFactorCode("");
    loginForm.reset();
  };

  return (
    // Full-bleed dark charcoal backdrop with soft brand-orange glows — the
    // admin app shares the customer app's CowboyMedia branding, in both themes.
    <div className="relative min-h-dvh flex items-center justify-center p-6 bg-sidebar overflow-hidden">
      <div aria-hidden className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-sidebar-primary/15 blur-3xl pointer-events-none" />
      <div aria-hidden className="absolute -bottom-40 -left-24 w-96 h-96 rounded-full bg-sidebar-primary/10 blur-3xl pointer-events-none" />
      <Card className="relative w-full max-w-md">
        <CardHeader className="text-center">
          <BrandLogo className="mx-auto h-24 mb-3" />
          <div className="flex items-center justify-center gap-1.5 text-primary">
            <Shield className="w-4 h-4" />
            <span className="text-sm font-semibold uppercase tracking-wide" data-testid="text-admin-app-title">
              Admin Portal
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">Staff sign-in only</p>
        </CardHeader>
        <CardContent>
          {pendingChallengeId ? (
            <form onSubmit={handleVerifyTwoFactor} className="space-y-4" data-testid="form-two-factor">
              <div className="space-y-1.5 text-center">
                <Shield className="w-8 h-8 mx-auto text-primary" />
                <h3 className="font-semibold" data-testid="text-2fa-title">Two-step verification</h3>
                <p className="text-sm text-muted-foreground">
                  Enter the 6-digit code from your authenticator app, or one of your backup codes.
                </p>
              </div>
              <Input
                autoFocus
                inputMode="text"
                autoComplete="one-time-code"
                placeholder="123456 or backup code"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                data-testid="input-2fa-code"
              />
              <Button type="submit" className="w-full" disabled={isSubmitting || twoFactorCode.length < 6} data-testid="button-2fa-verify">
                {isSubmitting ? "Verifying..." : "Verify"}
              </Button>
              <Button type="button" variant="ghost" className="w-full" onClick={handleCancelTwoFactor} data-testid="button-2fa-cancel">
                Cancel
              </Button>
            </form>
          ) : (
            <Form {...loginForm}>
              <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4" data-testid="form-admin-login">
                <FormField
                  control={loginForm.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Username</FormLabel>
                      <FormControl>
                        <Input autoComplete="username" data-testid="input-username" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={loginForm.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <Input type="password" autoComplete="current-password" data-testid="input-password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={isSubmitting} data-testid="button-login">
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </Form>
          )}
          <p className="text-xs text-muted-foreground text-center mt-4">
            Looking for the customer app?{" "}
            <a href="/" className="underline" data-testid="link-customer-app">
              Open ServiceHub
            </a>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

// Shown when a signed-in NON-staff account opens the admin app: a clear
// rejection instead of a broken portal. They can jump to the customer app
// (still signed in) or sign out to switch accounts.
function NotStaffScreen() {
  const { logout, user } = useAuth();
  const { toast } = useToast();
  const [signingOut, setSigningOut] = useState(false);

  const handleLogout = async () => {
    setSigningOut(true);
    try {
      await logout();
    } catch (e: any) {
      toast({
        title: "Sign out failed",
        description: serverActionErrorMessage(e, "Couldn't sign you out. Please try again."),
        variant: "destructive",
      });
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="relative min-h-dvh flex items-center justify-center p-6 bg-sidebar overflow-hidden">
      <div aria-hidden className="absolute -top-32 -right-32 w-96 h-96 rounded-full bg-sidebar-primary/15 blur-3xl pointer-events-none" />
      <Card className="relative w-full max-w-md">
        <CardContent className="pt-6 text-center space-y-4">
          <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 flex items-center justify-center">
            <ShieldAlert className="w-7 h-7 text-destructive" />
          </div>
          <div className="space-y-1">
            <h1 className="text-lg font-semibold" data-testid="text-not-staff-title">Staff access only</h1>
            <p className="text-sm text-muted-foreground" data-testid="text-not-staff-message">
              This app is for ServiceHub staff. Your account
              {user?.username ? ` (${user.username})` : ""} doesn't have admin access.
            </p>
          </div>
          <div className="space-y-2">
            <Button className="w-full" asChild data-testid="button-goto-customer-app">
              <a href="/">Open the customer app</a>
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={handleLogout}
              disabled={signingOut}
              data-testid="button-not-staff-logout"
            >
              <LogOut className="w-4 h-4 mr-2" />
              {signingOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Header gear popover: the admin app's own push-notification controls. The
// admin PWA holds an INDEPENDENT push subscription (service worker scoped to
// /admin), so staff can get ticket/request pushes here without installing or
// enabling anything in the customer app.
function AdminNotificationSettings() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);
  const [prefsDialogOpen, setPrefsDialogOpen] = useState(false);

  useEffect(() => {
    isPushSupported().then(setPushSupported);
    isSubscribedToPush().then(setPushEnabled);
  }, []);

  // Re-check on every open so the switch reflects reality even if the silent
  // background sync (or another tab) changed the subscription after mount.
  useEffect(() => {
    if (open) isSubscribedToPush().then(setPushEnabled);
  }, [open]);

  const handlePushToggle = async (checked: boolean) => {
    setPushLoading(true);
    try {
      if (checked) {
        const result = await subscribeToPush();
        if (result.ok) {
          toast({ title: "Push notifications enabled" });
        } else {
          toast({ title: "Could not enable notifications", description: result.reason, variant: "destructive" });
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
      // Reconcile with the browser's real subscription state so the switch
      // can never get stuck out of sync.
      setPushEnabled(await isSubscribedToPush());
      setPushLoading(false);
    }
  };

  const testPushMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/test-push");
      return (await res.json()) as { success: boolean; total: number; message?: string };
    },
    onSuccess: (res) => {
      if (res.success) {
        toast({
          title: "Test notification sent",
          description: `Sent to ${res.total} device(s) on your account. Check your device.`,
        });
      } else {
        toast({
          title: "No devices registered",
          description: res.message || "Turn on push notifications above, then try again.",
          variant: "destructive",
        });
      }
    },
    onError: (e: any) => {
      toast({ title: "Could not send test", description: e?.message || "Something went wrong.", variant: "destructive" });
    },
  });

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-9 w-9 p-0 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            aria-label="Notification settings"
            data-testid="button-admin-notif-settings"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80" data-testid="popover-admin-notif-settings">
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold">Notifications</p>
              <p className="text-xs text-muted-foreground">
                Settings for this admin app on this device — separate from the customer app.
              </p>
            </div>
            {pushSupported ? (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Push notifications</p>
                  <p className="text-xs text-muted-foreground">New tickets, requests, and more on this device</p>
                </div>
                <Switch
                  checked={pushEnabled}
                  onCheckedChange={handlePushToggle}
                  disabled={pushLoading}
                  data-testid="switch-admin-push-notifications"
                />
              </div>
            ) : (
              <p className="text-xs text-muted-foreground" data-testid="text-admin-push-unsupported">
                Push notifications aren't supported in this browser. On iPhone, add this app to your Home Screen first.
              </p>
            )}
            {pushSupported && pushEnabled && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Send a test</p>
                  <p className="text-xs text-muted-foreground">Confirm pushes reach this device</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testPushMutation.mutate()}
                  disabled={testPushMutation.isPending}
                  data-testid="button-admin-send-test-push"
                >
                  <Bell className="w-4 h-4 mr-1.5" />
                  {testPushMutation.isPending ? "Sending..." : "Send test"}
                </Button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setPrefsDialogOpen(true);
              }}
              data-testid="button-admin-open-notif-prefs"
            >
              <SlidersHorizontal className="w-4 h-4 mr-1.5" /> Notification preferences
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <NotificationPreferencesDialog
        open={prefsDialogOpen}
        onOpenChange={setPrefsDialogOpen}
        prefs={user?.notificationPrefs}
        pushAvailable={pushSupported && pushEnabled}
      />
    </>
  );
}

function AdminShell() {
  const { user, logout } = useAuth();
  const [location] = useLocation();
  const { toast } = useToast();
  useAppBadge();

  useEffect(() => {
    if (!user?.id) return;
    syncPushSubscription();
  }, [user?.id]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (e: any) {
      toast({
        title: "Sign out failed",
        description: serverActionErrorMessage(e, "Couldn't sign you out. Please try again."),
        variant: "destructive",
      });
    }
  };

  return (
    <GlobalSocketProvider userId={user!.id}>
      <LocationPresenceSync location={location} />
      <BroadcastAlertPopup />
      <TicketTransferPopup />
      <ChangelogPublishPrompt />
      <div
        className="flex flex-col w-full overflow-hidden"
        style={{
          height:
            "calc(100dvh - var(--sat, env(safe-area-inset-top, 0px)) - var(--sab, env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <OfflineBanner />
        <AdminAwayBanner />
        {/* Dark charcoal ops header — dark in BOTH modes, matching the
            customer app's shell convention and shared orange branding. */}
        <header className="relative flex items-center flex-shrink-0 px-3 py-2.5 border-b border-sidebar-border bg-sidebar text-sidebar-foreground min-h-[3rem]">
          <div className="z-10 flex items-center gap-2">
            <BrandLogo onDark className="h-8" />
            <span className="inline-flex items-center gap-1 rounded-md bg-sidebar-primary/15 text-sidebar-primary border border-sidebar-primary/25 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide">
              <Shield className="w-3.5 h-3.5" />
              Admin
            </span>
          </div>
          <div className="z-10 ml-auto flex items-center gap-1">
            <NotificationCenter />
            <AdminNotificationSettings />
            <Button
              variant="ghost"
              size="sm"
              className="h-9 gap-2 px-2 sm:px-3 text-sidebar-foreground/70 hover:text-sidebar-foreground"
              onClick={handleLogout}
              data-testid="button-admin-logout"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline text-xs">Sign out</span>
            </Button>
          </div>
        </header>
        <div id="app-scroll-container" className="flex-1 min-h-0 overflow-auto">
          <main>
            <Suspense
              fallback={
                <div className="p-6 space-y-3">
                  <Skeleton className="h-8 w-48" />
                  <Skeleton className="h-64 w-full" />
                </div>
              }
            >
              <AdminPortal />
            </Suspense>
          </main>
        </div>
      </div>
    </GlobalSocketProvider>
  );
}

function AdminAppContent() {
  const { user, isLoading, isAdmin } = useAuth();
  const [location] = useLocation();

  // This SPA only owns /admin. Any other path (e.g. the ticket-transfer popup
  // navigating to /tickets/:id) belongs to the customer app — leave via a full
  // page load so the server can hand out the right HTML entry.
  useEffect(() => {
    if (location === "/admin" || location.startsWith("/admin/")) return;
    window.location.assign(location + window.location.search);
  }, [location]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-dvh">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user) return <AdminLoginPage />;
  if (!isAdmin) return <NotStaffScreen />;
  return <AdminShell />;
}

export default function AdminApp() {
  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AuthProvider>
              <AdminAppContent />
            </AuthProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
