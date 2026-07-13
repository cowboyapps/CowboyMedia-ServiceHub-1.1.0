import { useState, useEffect, useRef, useCallback, lazy, Suspense } from "react";
import { flushSync } from "react-dom";
import { GlobalSocketProvider, useGlobalSocket } from "@/contexts/global-socket-context";
import { Switch, Route, Router, useLocation } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { serverActionErrorMessage } from "@/lib/server-error";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SplashScreen } from "@/components/splash-screen";
import { AppErrorBoundary } from "@/components/error-boundary";
import { OfflineBanner } from "@/components/offline-banner";
import { useScrollRestore } from "@/hooks/use-scroll-restore";
import { onlineManager } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { BottomNav } from "@/components/bottom-nav";
import { useIsMobile } from "@/hooks/use-mobile";
import { Link } from "wouter";

import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, BellRing, Settings, CheckCircle, Activity, Megaphone, ArrowRightLeft, Home, PackagePlus } from "lucide-react";
import DOMPurify from "dompurify";
import type { Announcement } from "@shared/schema";
import { NotificationCenter } from "@/components/notification-center";
import { CommandPalette } from "@/components/command-palette";
import { Search } from "lucide-react";
import { OnboardingTour } from "@/components/onboarding-tour";
import { WhmcsLinkDialog } from "@/components/whmcs-link-dialog";
import { format } from "date-fns";
import { subscribeToPush, isPushSupported, isSubscribedToPush, syncPushSubscription } from "@/lib/push-notifications";
import { BrandLogo } from "@/components/brand-logo";
import { PullToRefresh } from "@/components/pull-to-refresh";
import { PwaInstallBanner } from "@/components/pwa-install-banner";
import { useAppBadge } from "@/hooks/use-app-badge";
import NotFound from "@/pages/not-found";
import AuthPage from "@/pages/auth-page";
import Dashboard from "@/pages/dashboard";
import ServicesPage from "@/pages/services-page";
import AlertsPage from "@/pages/alerts-page";
import AlertDetail from "@/pages/alert-detail";
import NewsPage from "@/pages/news-page";
import NewsDetail from "@/pages/news-detail";
import TicketsPage from "@/pages/tickets-page";
import TicketDetail from "@/pages/ticket-detail";
import WhmcsTicketDetail from "@/pages/whmcs-ticket-detail";
import SettingsPage from "@/pages/settings-page";
import BillingPage from "@/pages/billing-page";
import MyServicesPage from "@/pages/my-services-page";
import MessagesPage from "@/pages/messages-page";
import ReportRequestPage from "@/pages/report-request-page";
import ServiceUpdatesPage from "@/pages/service-updates-page";
import ServiceDetail from "@/pages/service-detail";
import DownloadsPage from "@/pages/downloads-page";
import ForgotPasswordPage from "@/pages/forgot-password-page";
import ResetPasswordPage from "@/pages/reset-password-page";
import PublicStatusPage from "@/pages/public-status-page";
import PublicIncidentPage from "@/pages/public-incident-page";
import CommunityChatPage from "@/pages/community-chat-page";
import KnowledgePage from "@/pages/knowledge-page";
import WhatsNewPage from "@/pages/whats-new-page";
import { ServicesPickerWizard } from "@/pages/services-picker-wizard";
import { VersionWelcomeDialog } from "@/components/version-welcome-dialog";
import { ChangelogPublishPrompt } from "@/components/changelog-publish-prompt";
import { WelcomeV7Dialog } from "@/components/welcome-v7-dialog";
import { SetupReminderDialog } from "@/components/setup-reminder-dialog";
import { PrivateMessagePopup } from "@/components/private-message-popup";
import { useModalSlot } from "@/lib/modal-queue";
import { BroadcastAlertPopup, TicketTransferPopup, LocationPresenceSync } from "@/components/shared-shell";

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void) => unknown;
};

/**
 * Wraps the routed page area and crossfades between routes using the browser's
 * View Transitions API — the outgoing page eases out while the incoming page
 * eases in. Crucially there is NO second React tree and NO remount: the route
 * swaps exactly once (identical to a plain navigation), so no page's mount
 * effects run twice and behavior is unchanged. The rendered content is pinned
 * to `renderedLocation` and only advanced inside the transition callback (via
 * `flushSync`) so the browser can snapshot the old frame before the DOM
 * updates. Navigation still flows through the real browser location hook, so
 * in-page links keep working normally. Falls back to an instant swap when the
 * API is unavailable or the user prefers reduced motion — nothing can ever get
 * stuck and interaction is never delayed.
 */
function PageTransition({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const prefersReduced = usePrefersReducedMotion();
  const [renderedLocation, setRenderedLocation] = useState(location);

  useEffect(() => {
    if (location === renderedLocation) return;
    const swap = () => setRenderedLocation(location);
    const doc = typeof document !== "undefined" ? (document as ViewTransitionDocument) : undefined;
    if (prefersReduced || !doc || typeof doc.startViewTransition !== "function") {
      swap();
      return;
    }
    doc.startViewTransition(() => flushSync(swap));
  }, [location, renderedLocation, prefersReduced]);

  const routerHook = useCallback(
    () => [renderedLocation, navigate] as [string, typeof navigate],
    [renderedLocation, navigate]
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <Router hook={routerHook}>{children}</Router>
    </div>
  );
}

function AdminAppRedirect() {
  useEffect(() => {
    window.location.replace(window.location.pathname + window.location.search);
  }, []);
  return (
    <div className="p-6 space-y-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function AppRouter() {
  return (
    <PageTransition>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/services" component={ServicesPage} />
        <Route path="/services/:id" component={ServiceDetail} />
        <Route path="/alerts" component={AlertsPage} />
        <Route path="/alerts/:id" component={AlertDetail} />
        <Route path="/news" component={NewsPage} />
        <Route path="/news/:id" component={NewsDetail} />
        <Route path="/tickets" component={TicketsPage} />
        <Route path="/tickets/:id" component={TicketDetail} />
        <Route path="/whmcs-tickets/:id" component={WhmcsTicketDetail} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/my-services" component={MyServicesPage} />
        <Route path="/billing" component={BillingPage} />
        <Route path="/messages" component={MessagesPage} />
        <Route path="/messages/:id" component={MessagesPage} />
        <Route path="/service-updates" component={ServiceUpdatesPage} />
        <Route path="/report-request" component={ReportRequestPage} />
        <Route path="/downloads" component={DownloadsPage} />
        <Route path="/community" component={CommunityChatPage} />
        <Route path="/knowledge" component={KnowledgePage} />
        <Route path="/knowledge/:slug" component={KnowledgePage} />
        <Route path="/whats-new" component={WhatsNewPage} />
        {/* The Admin Portal is now its own PWA served at /admin. If an
            in-SPA navigation ever lands here (stale link, old bookmark
            handled client-side), escape with a full page load so the server
            can serve the admin app's HTML entry. */}
        <Route path="/admin" component={AdminAppRedirect} />
        <Route path="/admin/*" component={AdminAppRedirect} />
        <Route component={NotFound} />
      </Switch>
    </PageTransition>
  );
}

function AuthenticatedLayout() {
  const [location] = useLocation();
  const isMobile = useIsMobile();
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.id) return;
    syncPushSubscription();
  }, [user?.id]);

  const isTicketDetail = /^\/tickets\/[^/?]+/.test(location);
  const isMessageChat = /^\/messages\/[^/?]+/.test(location);
  const isCommunityChat = /^\/community(\/|$)/.test(location);
  const isFullHeightChat = isTicketDetail || isMessageChat || isCommunityChat;
  const isNewsPage = /^\/news(\/|$)/.test(location);
  const isAdminPortal = /^\/admin/.test(location);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(scrollRef);
  useAppBadge();

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div
        className="flex w-full overflow-hidden"
        style={{
          height:
            "calc(100dvh - var(--sat, env(safe-area-inset-top, 0px)) - var(--sab, env(safe-area-inset-bottom, 0px)))",
        }}
      >
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
          <OfflineBanner />
          {/* Charcoal brand header — dark in both light and dark modes, matching
              the sidebar, so the orange accent and logo carry the identity. */}
          <header className="relative flex items-center flex-shrink-0 px-3 py-2.5 border-b border-sidebar-border bg-sidebar text-sidebar-foreground min-h-[3rem]">
            <div className="z-10">
              {isMobile ? (
                <Link href="/" className="flex items-center gap-1.5 no-underline tap-interactive rounded-lg px-2.5 py-1.5 bg-sidebar-primary hover:bg-sidebar-primary/90 transition-colors" data-testid="link-header-dashboard">
                  <Home className="w-4 h-4 text-sidebar-primary-foreground" />
                  <span className="text-xs font-semibold text-sidebar-primary-foreground">Dashboard</span>
                </Link>
              ) : (
                <SidebarTrigger className="h-10 w-10 min-h-[40px] min-w-[40px] [&_svg]:!h-5 [&_svg]:!w-5 text-sidebar-foreground/80 hover:text-sidebar-foreground" data-testid="button-sidebar-toggle" />
              )}
            </div>
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <Link href="/" className="pointer-events-auto" data-testid="link-header-home">
                <BrandLogo onDark className="h-20 md:h-8 cursor-pointer" />
              </Link>
            </div>
            <div className="z-10 ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 gap-2 px-2 sm:px-3 text-sidebar-foreground/70 hover:text-sidebar-foreground"
                onClick={() => window.dispatchEvent(new Event("open-command-palette"))}
                data-testid="button-open-command-palette"
                aria-label="Open search"
              >
                <Search className="w-4 h-4" />
                <span className="hidden md:inline text-xs">Search</span>
                <kbd className="hidden md:inline ml-1 pointer-events-none h-5 select-none items-center gap-1 rounded border border-sidebar-border bg-sidebar-accent px-1.5 font-mono text-[10px] font-medium opacity-100">
                  ⌘K
                </kbd>
              </Button>
              <NotificationCenter />
            </div>
          </header>
          <PullToRefresh ref={scrollRef} id="app-scroll-container" className={`flex-1 min-h-0 ${isFullHeightChat ? 'flex flex-col overflow-hidden' : 'overflow-auto'} ${isMobile ? 'pb-[calc(4.5rem+var(--sab,env(safe-area-inset-bottom,0px)))]' : ''}`} disabled={isFullHeightChat || isNewsPage || isAdminPortal}>
            <main className={isFullHeightChat ? "flex-1 flex flex-col min-h-0" : "p-3 sm:p-6"}>
              <AppRouter />
            </main>
          </PullToRefresh>
          <BottomNav />
        </div>
      </div>
    </SidebarProvider>
  );
}

interface WhmcsLinkStatus {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  dismissed: boolean;
}

// One-time auto-popup that invites an unlinked customer to connect their
// billing account. Shown before the onboarding tour (modal-slot priority 75 >
// tour's 70) so a brand-new signup is offered linking first. Closing it — by
// linking OR by choosing "not now" — records a server-side dismissal so it
// never auto-fires again. The Settings entry point stays available regardless.
function WhmcsLinkPrompt() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);

  const { data: status } = useQuery<WhmcsLinkStatus>({
    queryKey: ["/api/whmcs/link/status"],
    enabled: !!user && user.role === "customer",
  });

  useEffect(() => {
    if (resolved) return;
    if (status && status.configured && status.enabled && !status.linked && !status.dismissed) {
      setOpen(true);
      setResolved(true);
    }
  }, [status, resolved]);

  const isMine = useModalSlot("whmcs-link", 75, open);

  const dismissMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/whmcs/link/dismiss");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs/link/status"] });
    },
  });

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    // Whether they linked or backed out, don't auto-pester again.
    if (!next) dismissMutation.mutate();
  };

  if (!open || !isMine) return null;
  return <WhmcsLinkDialog open={open} onOpenChange={handleOpenChange} />;
}

function WelcomeDialog() {
  const [showWelcome, setShowWelcome] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("showWelcome");
    if (shouldShow === "true") {
      setShowWelcome(true);
      sessionStorage.removeItem("showWelcome");
    }
    isPushSupported().then((supported) => {
      setPushSupported(supported);
      if (supported) {
        isSubscribedToPush().then(setPushEnabled);
      }
    });
  }, []);

  // Coordinated through the modal queue so the post-registration welcome
  // doesn't render its Radix Dialog on top of the tour / announcement /
  // version-welcome — two open Radix Dialogs collide on focus trapping and
  // a dismissal can swallow the dialog underneath. Order on a brand-new
  // signup: tour (70) → announcement (60) → this welcome (55) →
  // version-welcome (50).
  const isMineWelcome = useModalSlot("welcome", 55, showWelcome);
  if (showWelcome && !isMineWelcome) return null;

  const handleEnablePush = async () => {
    setPushLoading(true);
    try {
      const result = await subscribeToPush();
      setPushEnabled(result.ok);
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-welcome">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <BrandLogo className="h-16" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-welcome-title">Welcome to CowboyMedia Service Hub!</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Smartphone className="w-4 h-4 text-primary" />
            </div>
            <p>
              If you are on <strong className="text-foreground">Android and Google Chrome</strong>, be sure to go to settings and click <strong className="text-foreground">"Add To Home Screen"</strong>. If on <strong className="text-foreground">iPhone and Safari</strong>, click the share button and then <strong className="text-foreground">"Add To Home Screen"</strong>. This installs the web app on your phone.
            </p>
          </div>
          {pushSupported && (
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BellRing className="w-4 h-4 text-primary" />
              </div>
              <div className="flex-1 space-y-2">
                <p>
                  Stay informed with <strong className="text-foreground">push notifications</strong> for service alerts, ticket updates, and more.
                </p>
                {pushEnabled ? (
                  <div className="flex items-center gap-2 text-green-500 font-medium" data-testid="text-push-enabled">
                    <CheckCircle className="w-4 h-4" />
                    Notifications Enabled!
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-2"
                    disabled={pushLoading}
                    onClick={handleEnablePush}
                    data-testid="button-welcome-enable-push"
                  >
                    <BellRing className="w-4 h-4" />
                    {pushLoading ? "Enabling..." : "Turn on Push Notifications"}
                  </Button>
                )}
              </div>
            </div>
          )}
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <p>
              Head over to <strong className="text-foreground">"Settings"</strong> and select the <strong className="text-foreground">services you subscribe to</strong> so you receive the right notifications for your services.
            </p>
          </div>
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Settings className="w-4 h-4 text-primary" />
            </div>
            <p className="font-medium text-foreground">Enjoy ServiceHub!</p>
          </div>
        </div>
        <DialogFooter>
          <Button className="w-full" data-testid="button-welcome-dismiss" onClick={() => setShowWelcome(false)}>
            Get Started
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ActiveAnnouncement = Announcement & { alreadySeen: boolean };

// Per-user suppression set for the current "app open". Lives in module state
// so it persists across in-app navigation but resets on a true new app open
// (full reload, PWA cold start, or warm resume after >5 min in background).
const shownThisAppOpen = new Map<string, Set<string>>();

// Threshold (ms) for treating a visibility resume as a fresh "app open"
// rather than a brief tab/window refocus. 5 minutes is long enough to ignore
// quick app switches but short enough that "open it the next morning" works.
const APP_RESUME_THRESHOLD_MS = 5 * 60 * 1000;

function AnnouncementPopup() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState<ActiveAnnouncement | null>(null);

  // Lightweight check on app open / login. Refetch only when we explicitly
  // invalidate (warm-resume below) — never on every tab focus.
  const { data } = useQuery<ActiveAnnouncement | null>({
    queryKey: ["/api/announcements/active"],
    enabled: !!user && user.role === "customer",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchOnMount: false,
    staleTime: Infinity,
  });

  // Reset open/current state when the logged-in user changes.
  useEffect(() => {
    setOpen(false);
    setCurrent(null);
  }, [user?.id]);

  // Warm-resume detector: when the PWA/tab becomes visible after being
  // hidden for longer than APP_RESUME_THRESHOLD_MS, treat it as a fresh
  // app open — clear suppression for this user and refetch.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!user || user.role !== "customer") return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (document.visibilityState !== "visible") return;
      const hiddenFor = hiddenAt == null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      if (hiddenFor < APP_RESUME_THRESHOLD_MS) return;
      shownThisAppOpen.delete(user.id);
      queryClient.invalidateQueries({ queryKey: ["/api/announcements/active"] });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  // Keep: the effect only reads `user.id` and `user.role`, both already listed.
  // Depending on the whole `user` object would re-register the visibility
  // listener on every auth refetch (new object identity) with no benefit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user || user.role !== "customer") return;
    if (!data || !data.id) return;
    if (!data.active) return;
    if (data.frequency === "once" && data.alreadySeen) return;
    const shownSet = shownThisAppOpen.get(user.id) ?? new Set<string>();
    if (shownSet.has(data.id)) return;
    shownSet.add(data.id);
    shownThisAppOpen.set(user.id, shownSet);
    setCurrent(data);
    setOpen(true);
  }, [data, user]);

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/announcements/${id}/dismiss`);
    },
  });

  const handleClose = () => {
    if (current) {
      dismissMutation.mutate(current.id);
    }
    setOpen(false);
  };

  const handleLink = () => {
    if (current?.linkPath) {
      setLocation(current.linkPath);
    }
    handleClose();
  };

  // Coordinated through the modal queue so a brand-new customer doesn't see
  // this stacked on top of the onboarding tour. Tour (priority 70) shows
  // first; this announcement (priority 60) takes its turn after tour ends;
  // version-welcome (priority 50) goes last.
  const isMine = useModalSlot("announcement", 60, open && !!current);

  if (!current || !isMine) return null;

  const safeHtml = DOMPurify.sanitize(current.bodyHtml, {
    ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"],
    ALLOWED_ATTR: ["style", "src", "alt", "width", "height", "href", "target"],
  });

  const buttonLabel = current.linkLabel?.trim() || "View";

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-announcement">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <BrandLogo className="h-16" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-announcement-title">Announcement</DialogTitle>
        </DialogHeader>
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: safeHtml }}
          data-testid="text-announcement-body"
        />
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          {current.linkPath && (
            <Button className="w-full" onClick={handleLink} data-testid="button-announcement-link">
              {buttonLabel}
            </Button>
          )}
          <Button
            variant={current.linkPath ? "outline" : "default"}
            className="w-full"
            onClick={handleClose}
            data-testid="button-announcement-close"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type ServiceAnnouncement = { id: string; serviceId: number; serviceName: string; title: string; body: string };

// One-time "a new service was added to your account" popup (Task #567). Fires
// for a service ordered directly in WHMCS (outside the ServiceHub store) that
// the next poll detects. Mirrors the bell + push the notifier already sends.
// Queued through the modal slot (priority 65) so it never stacks on top of the
// onboarding tour (70) / whmcs-link (75); it takes its turn ahead of the
// announcement (60) / welcome (55) dialogs.
function NewServicePopup() {
  const { user } = useAuth();
  const { subscribe } = useGlobalSocket();
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);

  const { data } = useQuery<ServiceAnnouncement[]>({
    queryKey: ["/api/whmcs/service-announcements"],
    enabled: !!user && user.role === "customer",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  // Real-time nudge: the notifier broadcasts to the customer's tabs the moment
  // it records an announcement, so refetch the queue without waiting for a
  // reload.
  useEffect(() => {
    if (!user || user.role !== "customer") return;
    const handleWs = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "whmcs_service_added") {
          queryClient.invalidateQueries({ queryKey: ["/api/whmcs/service-announcements"] });
        }
      } catch {}
    };
    return subscribe(handleWs);
  }, [user, subscribe]);

  const current = data && data.length > 0 ? data[0] : null;
  const currentId = current?.id ?? null;

  // Surface the popup whenever there's an undismissed announcement to show.
  useEffect(() => {
    setOpen(!!currentId);
  }, [currentId]);

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/whmcs/service-announcements/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/whmcs/service-announcements"] });
    },
  });

  const isMine = useModalSlot("whmcs-service-added", 65, open && !!current);

  if (!current || !isMine) return null;

  const handleClose = () => {
    setOpen(false);
    dismissMutation.mutate(current.id);
  };

  const handleView = () => {
    setOpen(false);
    dismissMutation.mutate(current.id);
    setLocation(`/my-services?service=${current.serviceId}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-new-service">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <PackagePlus className="w-7 h-7 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-new-service-title">
            {current.title}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2 text-center">
          <p className="text-base font-semibold text-foreground" data-testid="text-new-service-name">
            {current.body}
          </p>
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" onClick={handleView} data-testid="button-new-service-view">
            View service
          </Button>
          <Button variant="outline" className="w-full" onClick={handleClose} data-testid="button-new-service-close">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppContent() {
  const { user, isLoading, isAdmin } = useAuth();
  const [location] = useLocation();

  useEffect(() => {
    if (!user) return;
    const reRegisterPush = async () => {
      try {
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const subJson = subscription.toJSON();
          await fetch("/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              endpoint: subJson.endpoint,
              keys: { p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth },
            }),
          });
        }
      } catch {}
    };
    reRegisterPush();
  }, [user]);

  return (
    <AppContentInner user={user} isLoading={isLoading} isAdmin={isAdmin} location={location} />
  );
}

function AppContentInner({ user, isLoading, isAdmin, location }: { user: any; isLoading: boolean; isAdmin: boolean; location: string }) {

  if (location.startsWith("/status/incidents/")) {
    return (
      <Switch>
        <Route path="/status/incidents/:id" component={PublicIncidentPage} />
      </Switch>
    );
  }

  if (location === "/status" || location.startsWith("/status/")) {
    return <PublicStatusPage />;
  }

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

  if (!user) {
    return (
      <>
        <OfflineBanner />
        <Switch>
          <Route path="/forgot-password" component={ForgotPasswordPage} />
          <Route path="/reset-password" component={ResetPasswordPage} />
          <Route path="/status" component={PublicStatusPage} />
          <Route path="/status/incidents/:id" component={PublicIncidentPage} />
          <Route>
            <AuthPage />
          </Route>
        </Switch>
      </>
    );
  }

  const needsServicesPicker =
    !!user &&
    user.role === "customer" &&
    (user.subscribedServices?.length ?? 0) === 0 &&
    !user.servicesPickerDismissed &&
    !location.startsWith("/status");

  if (needsServicesPicker) {
    return <ServicesPickerWizard onDone={() => { /* user prefs cache refetch triggers re-render */ }} />;
  }

  return (
    <GlobalSocketProvider userId={user.id}>
      <LocationPresenceSync location={location} />
      <BroadcastAlertPopup />
      <CommandPalette />
      {isAdmin && <TicketTransferPopup />}
      <WelcomeV7Dialog />
      <WhmcsLinkPrompt />
      <WelcomeDialog />
      <VersionWelcomeDialog />
      <ChangelogPublishPrompt />
      <SetupReminderDialog />
      <PwaInstallBanner />
      <PrivateMessagePopup />
      <AnnouncementPopup />
      <NewServicePopup />
      <OnboardingTour />
      <AuthenticatedLayout />
    </GlobalSocketProvider>
  );
}

export default function App() {
  useEffect(() => {
    const handleOnline = () => {
      onlineManager.setOnline(true);
      queryClient.invalidateQueries();
    };
    const handleOffline = () => {
      onlineManager.setOnline(false);
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const [showSplash, setShowSplash] = useState(() => {
    if (sessionStorage.getItem("splashShown")) return false;
    // Skip the splash on non-phone viewports (desktop, large tablets,
    // foldable inner screens). We require a small max-width AND portrait
    // orientation so typical smartphones get the splash and everything
    // else falls through to the normal first screen.
    try {
      const isPhone =
        window.matchMedia("(max-width: 767px)").matches &&
        window.matchMedia("(orientation: portrait)").matches;
      if (!isPhone) {
        sessionStorage.setItem("splashShown", "1");
        return false;
      }
    } catch {
      // If matchMedia is unavailable for any reason, fall back to showing
      // the splash — the existing hard timeout still protects the user.
    }
    return true;
  });

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem("splashShown", "1");
    setShowSplash(false);
  }, []);

  return (
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <TooltipProvider>
            <AuthProvider>
              {showSplash && <SplashScreen onComplete={handleSplashComplete} />}
              <AppContent />
            </AuthProvider>
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  );
}
