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
import { syncPushSubscription } from "@/lib/push-notifications";
import { serverActionErrorMessage } from "@/lib/server-error";
import { loginSchema, type LoginData } from "@shared/schema";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Shield, ShieldAlert, LogOut } from "lucide-react";

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
    // Full-bleed deep-slate backdrop with soft electric-blue glows: the admin
    // app's identity is visible from the very first screen, in both themes.
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
        {/* Deep-slate ops header — dark in BOTH modes (mirrors the customer
            app's dark shell convention, but cool slate + electric blue so the
            two apps are instantly tell-apart-able). */}
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
