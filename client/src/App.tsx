import { useState, useEffect, useRef } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Smartphone, BellRing, Settings, Mail } from "lucide-react";
import logoImg from "@assets/CowboyMedia_App_Internal_Logo_(512_x_512_px)_20260128_040144_0_1771258775818.png";
import { PullToRefresh } from "@/components/pull-to-refresh";
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
import ProfilePage from "@/pages/profile-page";
import AdminPortal from "@/pages/admin-portal";
import MessagesPage from "@/pages/messages-page";
import ReportRequestPage from "@/pages/report-request-page";
import ServiceUpdatesPage from "@/pages/service-updates-page";

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/services" component={ServicesPage} />
      <Route path="/alerts" component={AlertsPage} />
      <Route path="/alerts/:id" component={AlertDetail} />
      <Route path="/news" component={NewsPage} />
      <Route path="/news/:id" component={NewsDetail} />
      <Route path="/tickets" component={TicketsPage} />
      <Route path="/tickets/:id" component={TicketDetail} />
      <Route path="/profile" component={ProfilePage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/service-updates" component={ServiceUpdatesPage} />
      <Route path="/report-request" component={ReportRequestPage} />
      <Route path="/admin" component={AdminPortal} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedLayout() {
  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <header className="flex items-center justify-between gap-2 px-4 py-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] border-b sticky top-0 z-50 bg-background">
            <SidebarTrigger className="h-12 w-12 min-h-[48px] min-w-[48px] [&_svg]:!h-7 [&_svg]:!w-7" data-testid="button-sidebar-toggle" />
            <ThemeToggle />
          </header>
          <PullToRefresh className="flex-1 overflow-auto">
            <main className="p-3 sm:p-6">
              <AppRouter />
            </main>
          </PullToRefresh>
        </div>
      </div>
    </SidebarProvider>
  );
}

function SetupReminderDialog() {
  const { user } = useAuth();
  const [showReminder, setShowReminder] = useState(false);
  const [missingPush, setMissingPush] = useState(false);
  const [missingServices, setMissingServices] = useState(false);

  useEffect(() => {
    const shouldCheck = sessionStorage.getItem("checkSetup");
    if (shouldCheck !== "true" || !user || user.role === "admin") return;
    sessionStorage.removeItem("checkSetup");

    const checkSetup = async () => {
      const { isSubscribedToPush } = await import("@/lib/push-notifications");
      const hasPush = await isSubscribedToPush();
      const hasServices = (user.subscribedServices?.length ?? 0) > 0;

      if (!hasPush || !hasServices) {
        setMissingPush(!hasPush);
        setMissingServices(!hasServices);
        setShowReminder(true);
      }
    };
    checkSetup();
  }, [user]);

  if (!showReminder) return null;

  return (
    <Dialog open={showReminder} onOpenChange={setShowReminder}>
      <DialogContent className="max-w-md" data-testid="dialog-setup-reminder">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <img src={logoImg} alt="CowboyMedia" className="h-16" />
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-setup-reminder-title">Quick Reminder</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-muted-foreground">
          <p className="text-center">
            It looks like you haven't finished setting up your account. To get the most out of ServiceHub, please visit your <strong className="text-foreground">Profile</strong> page to:
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
          <Button className="w-full" data-testid="button-reminder-go-profile" onClick={() => { setShowReminder(false); window.location.href = "/profile"; }}>
            Go to Profile
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-reminder-dismiss" onClick={() => setShowReminder(false)}>
            Remind Me Later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PrivateMessagePopup() {
  const { user } = useAuth();
  const [popupMessage, setPopupMessage] = useState<{ subject: string; body: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!user || user.role === "admin") return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "private_message" && data.recipientId === user.id) {
          setPopupMessage({ subject: data.subject, body: "You have a new private message. Open your Message Center to read it." });
          queryClient.invalidateQueries({ queryKey: ["/api/private-messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/private-messages/unread-count"] });
        }
      } catch {}
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [user]);

  if (!popupMessage) return null;

  return (
    <Dialog open={!!popupMessage} onOpenChange={(open) => { if (!open) setPopupMessage(null); }}>
      <DialogContent className="max-w-md" data-testid="dialog-private-message-popup">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Mail className="w-6 h-6 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-lg" data-testid="text-popup-subject">New Message: {popupMessage.subject}</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground whitespace-pre-wrap text-center" data-testid="text-popup-body">
          {popupMessage.body}
        </div>
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button className="w-full" data-testid="button-popup-view-messages" onClick={() => { setPopupMessage(null); window.location.href = "/messages"; }}>
            View Messages
          </Button>
          <Button variant="outline" className="w-full" data-testid="button-popup-dismiss" onClick={() => setPopupMessage(null)}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WelcomeDialog() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const shouldShow = sessionStorage.getItem("showWelcome");
    if (shouldShow === "true") {
      setShowWelcome(true);
      sessionStorage.removeItem("showWelcome");
    }
  }, []);

  return (
    <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
      <DialogContent className="max-w-md" data-testid="dialog-welcome">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <img src={logoImg} alt="CowboyMedia" className="h-16" />
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
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <BellRing className="w-4 h-4 text-primary" />
            </div>
            <p>
              Also, be sure to enable <strong className="text-foreground">push notifications</strong> under <strong className="text-foreground">"Profile"</strong> and also select the services you want to receive notifications for.
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

function AppContent() {
  const { user, isLoading } = useAuth();

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="space-y-4 w-64">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <AuthPage />;
  }

  return (
    <>
      <WelcomeDialog />
      <SetupReminderDialog />
      <PrivateMessagePopup />
      <AuthenticatedLayout />
    </>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
