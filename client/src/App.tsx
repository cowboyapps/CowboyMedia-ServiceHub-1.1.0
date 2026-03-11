import { useState, useEffect, useRef, useCallback } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, apiRequest } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/lib/theme-provider";
import { AuthProvider, useAuth } from "@/lib/auth";
import { SplashScreen } from "@/components/splash-screen";
import { OfflineBanner } from "@/components/offline-banner";
import { useScrollRestore } from "@/hooks/use-scroll-restore";
import { onlineManager } from "@tanstack/react-query";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeToggle } from "@/components/theme-toggle";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Smartphone, BellRing, Settings, Mail, CheckCircle, Activity, Megaphone, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";
import { subscribeToPush, isPushSupported, isSubscribedToPush } from "@/lib/push-notifications";
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
import ServiceDetail from "@/pages/service-detail";

function PageTransition({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  return (
    <div key={location} className="animate-page-enter">
      {children}
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
        <Route path="/profile" component={ProfilePage} />
        <Route path="/messages" component={MessagesPage} />
        <Route path="/service-updates" component={ServiceUpdatesPage} />
        <Route path="/report-request" component={ReportRequestPage} />
        <Route path="/admin" component={AdminPortal} />
        <Route component={NotFound} />
      </Switch>
    </PageTransition>
  );
}

function AuthenticatedLayout() {
  const [location] = useLocation();
  const isTicketDetail = /^\/tickets\/[^/?]+/.test(location);
  const isAdminPortal = /^\/admin/.test(location);
  const scrollRef = useRef<HTMLDivElement>(null);
  useScrollRestore(scrollRef);

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full">
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <div className="sticky top-0 z-50">
            <OfflineBanner />
            <header className="flex items-center justify-between gap-2 px-4 py-4 pt-[calc(env(safe-area-inset-top,0px)+1rem)] border-b bg-background">
              <SidebarTrigger className="h-12 w-12 min-h-[48px] min-w-[48px] [&_svg]:!h-7 [&_svg]:!w-7" data-testid="button-sidebar-toggle" />
              <ThemeToggle />
            </header>
          </div>
          <PullToRefresh ref={scrollRef} className={`flex-1 ${isTicketDetail ? 'overflow-hidden' : 'overflow-auto'}`} disabled={isTicketDetail || isAdminPortal}>
            <main className={isTicketDetail ? "h-full" : "p-3 sm:p-6"}>
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
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    if (!user || user.role === "admin" || user.role === "master_admin") return;
    if (user.setupReminderDismissed) return;
    if (sessionStorage.getItem("setupReminderShown") === "true") return;
    if (sessionStorage.getItem("showWelcome") === "true") return;

    const checkSetup = async () => {
      const { isSubscribedToPush } = await import("@/lib/push-notifications");
      const hasPush = await isSubscribedToPush();
      const hasServices = (user.subscribedServices?.length ?? 0) > 0;

      if (!hasPush || !hasServices) {
        setMissingPush(!hasPush);
        setMissingServices(!hasServices);
        setShowReminder(true);
        sessionStorage.setItem("setupReminderShown", "true");
      }
    };
    checkSetup();
  }, [user]);

  const handleDismissPermanently = async () => {
    setDismissing(true);
    try {
      const { apiRequest } = await import("@/lib/queryClient");
      await apiRequest("PATCH", "/api/auth/profile", { setupReminderDismissed: true });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    } catch {} finally {
      setDismissing(false);
      setShowReminder(false);
    }
  };

  if (!showReminder) return null;

  return (
    <Dialog open={showReminder} onOpenChange={setShowReminder}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-setup-reminder">
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
          <Button
            variant="ghost"
            className="w-full text-muted-foreground"
            disabled={dismissing}
            onClick={handleDismissPermanently}
            data-testid="button-reminder-dont-remind"
          >
            {dismissing ? "Saving..." : "Don't Remind Me Again"}
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
    if (!user || user.role === "admin" || user.role === "master_admin") return;

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
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-private-message-popup">
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

interface BroadcastMsg {
  id: string;
  title: string;
  message: string;
  senderId: string;
  createdAt: string;
}

function BroadcastAlertPopup() {
  const { user } = useAuth();
  const [queue, setQueue] = useState<BroadcastMsg[]>([]);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  const { data: unreadBroadcasts } = useQuery<BroadcastMsg[]>({
    queryKey: ["/api/broadcasts/unread"],
    enabled: !!user,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!unreadBroadcasts) return;
    setQueue(prev => {
      const existingIds = new Set(prev.map(b => b.id));
      const newFromApi = unreadBroadcasts.filter(b => !existingIds.has(b.id) && !acknowledgedIds.has(b.id));
      const stillUnread = prev.filter(b => unreadBroadcasts.some(u => u.id === b.id) || !acknowledgedIds.has(b.id));
      const merged = [...stillUnread];
      for (const b of newFromApi) {
        if (!merged.some(m => m.id === b.id)) merged.push(b);
      }
      return merged.filter(b => !acknowledgedIds.has(b.id));
    });
  }, [unreadBroadcasts, acknowledgedIds]);

  useEffect(() => {
    if (!user) return;
    let currentWs: WebSocket | null = null;
    const handleWs = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "broadcast_alert" && data.recipientIds?.includes(user.id)) {
          const newBroadcast = { id: data.broadcastId, title: data.title, message: data.message, senderId: "", createdAt: new Date().toISOString() };
          setQueue(prev => prev.some(b => b.id === newBroadcast.id) ? prev : [...prev, newBroadcast]);
        }
      } catch {}
    };
    const attachWs = () => {
      const ws = (window as any).__ws;
      if (ws && ws !== currentWs) {
        if (currentWs) currentWs.removeEventListener("message", handleWs);
        ws.addEventListener("message", handleWs);
        currentWs = ws;
      }
    };
    attachWs();
    const interval = setInterval(attachWs, 2000);
    return () => {
      clearInterval(interval);
      if (currentWs) currentWs.removeEventListener("message", handleWs);
    };
  }, [user]);

  const acknowledgeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/broadcasts/${id}/acknowledge`);
      return id;
    },
    onSuccess: (id: string) => {
      setAcknowledgedIds(prev => new Set([...prev, id]));
      setQueue(prev => prev.filter(b => b.id !== id));
      queryClient.invalidateQueries({ queryKey: ["/api/broadcasts/unread"] });
    },
  });

  const current = queue[0];
  if (!current) return null;

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-md [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="dialog-broadcast-alert"
      >
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-destructive/10 flex items-center justify-center">
              <Megaphone className="w-7 h-7 text-destructive" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl" data-testid="text-broadcast-title">
            Urgent Admin Alert
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <p className="font-semibold text-center" data-testid="text-broadcast-subtitle">{current.title}</p>
          <div className="text-sm text-muted-foreground whitespace-pre-wrap text-center" data-testid="text-broadcast-message">
            {current.message}
          </div>
        </div>
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground text-center">
            {queue.length - 1} more alert{queue.length - 1 > 1 ? "s" : ""} remaining
          </p>
        )}
        <DialogFooter className="flex flex-col sm:flex-col">
          <Button
            className="w-full"
            onClick={() => acknowledgeMutation.mutate(current.id)}
            disabled={acknowledgeMutation.isPending}
            data-testid="button-broadcast-acknowledge"
          >
            {acknowledgeMutation.isPending ? "Acknowledging..." : "Acknowledge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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

  const handleEnablePush = async () => {
    setPushLoading(true);
    try {
      const success = await subscribeToPush();
      setPushEnabled(success);
    } finally {
      setPushLoading(false);
    }
  };

  return (
    <Dialog open={showWelcome} onOpenChange={setShowWelcome}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-welcome">
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
              Head over to <strong className="text-foreground">"Profile"</strong> and select the <strong className="text-foreground">services you subscribe to</strong> so you receive the right notifications for your services.
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

interface TransferData {
  id: number;
  ticketId: number;
  fromAdminId: number;
  toAdminId: number;
  reason: string;
  status: string;
  createdAt: string;
  ticket: {
    id: number;
    subject: string;
    description: string;
    priority: string;
    serviceName?: string;
    categoryName?: string;
    createdAt: string;
  };
  customer: {
    fullName: string;
    email: string;
    username: string;
  };
  fromAdmin: {
    fullName: string;
  };
}

function TicketTransferPopup() {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [queue, setQueue] = useState<TransferData[]>([]);
  const [open, setOpen] = useState(true);

  const { data: pendingTransfers } = useQuery<TransferData[]>({
    queryKey: ["/api/ticket-transfers/pending"],
    enabled: !!user,
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  useEffect(() => {
    if (!pendingTransfers) return;
    setQueue(prev => {
      const existingIds = new Set(prev.map(t => t.id));
      const newFromApi = pendingTransfers.filter(t => !existingIds.has(t.id));
      const merged = [...prev];
      for (const t of newFromApi) {
        if (!merged.some(m => m.id === t.id)) merged.push(t);
      }
      return merged.filter(t => pendingTransfers.some(p => p.id === t.id));
    });
  }, [pendingTransfers]);

  useEffect(() => {
    if (!user) return;
    let currentWs: WebSocket | null = null;
    const handleWs = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ticket_transfer" && data.transfer?.toAdminId === user.id) {
          const newTransfer: TransferData = {
            id: data.transfer.id,
            ticketId: data.transfer.ticketId,
            fromAdminId: data.transfer.fromAdminId,
            toAdminId: data.transfer.toAdminId,
            reason: data.transfer.reason,
            status: data.transfer.status,
            createdAt: data.transfer.createdAt,
            ticket: data.ticket,
            customer: data.customer,
            fromAdmin: data.fromAdmin,
          };
          setQueue(prev => prev.some(t => t.id === newTransfer.id) ? prev : [...prev, newTransfer]);
          setOpen(true);
          queryClient.invalidateQueries({ queryKey: ["/api/ticket-transfers/pending"] });
        }
      } catch {}
    };
    const attachWs = () => {
      const ws = (window as any).__ws;
      if (ws && ws !== currentWs) {
        if (currentWs) currentWs.removeEventListener("message", handleWs);
        ws.addEventListener("message", handleWs);
        currentWs = ws;
      }
    };
    attachWs();
    const interval = setInterval(attachWs, 2000);
    return () => {
      clearInterval(interval);
      if (currentWs) currentWs.removeEventListener("message", handleWs);
    };
  }, [user]);

  useEffect(() => {
    if (queue.length > 0) setOpen(true);
  }, [queue.length]);

  const claimMutation = useMutation({
    mutationFn: async (ticketId: string) => {
      await apiRequest("POST", `/api/tickets/${ticketId}/claim`);
    },
    onSuccess: (_data, ticketId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-transfers/pending"] });
      setQueue(prev => prev.filter(t => t.ticketId !== ticketId));
      setOpen(false);
      setLocation(`/tickets/${ticketId}`);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to claim ticket", description: e.message, variant: "destructive" });
    },
  });

  const current = queue[0];
  if (!current || !open || !current.ticket || !current.customer || !current.fromAdmin) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-ticket-transfer">
        <DialogHeader>
          <div className="flex justify-center mb-2">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <ArrowRightLeft className="w-7 h-7 text-primary" />
            </div>
          </div>
          <DialogTitle className="text-center text-xl">Ticket Transfer Request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground text-center">
            From: <span className="font-semibold text-foreground">{current.fromAdmin.fullName}</span>
          </p>
          <div className="bg-muted rounded-md p-3 text-sm">
            <span className="font-medium">Reason:</span> {current.reason}
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Customer Info</p>
            <p className="text-muted-foreground">Full Name: {current.customer.fullName}</p>
            <p className="text-muted-foreground">Email: {current.customer.email}</p>
            <p className="text-muted-foreground">Username: {current.customer.username}</p>
          </div>
          <div className="space-y-1 text-sm">
            <p className="font-semibold text-foreground">Ticket Info</p>
            <p className="text-muted-foreground">Subject: {current.ticket.subject}</p>
            <p className="text-muted-foreground">Description: {(current.ticket.description || "").length > 100 ? current.ticket.description.slice(0, 100) + "..." : current.ticket.description || "N/A"}</p>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-muted-foreground">Priority:</span>
              <Badge variant="outline" className="text-xs">{current.ticket.priority}</Badge>
            </div>
            {current.ticket.serviceName && (
              <p className="text-muted-foreground">Service: {current.ticket.serviceName}</p>
            )}
            {current.ticket.categoryName && (
              <p className="text-muted-foreground">Category: {current.ticket.categoryName}</p>
            )}
            <p className="text-muted-foreground">Created: {format(new Date(current.ticket.createdAt), "MMM d, yyyy h:mm a")}</p>
          </div>
        </div>
        {queue.length > 1 && (
          <p className="text-xs text-muted-foreground text-center">
            ({queue.length - 1} more pending)
          </p>
        )}
        <DialogFooter className="flex flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            data-testid="button-accept-claim"
            disabled={claimMutation.isPending}
            onClick={() => claimMutation.mutate(current.ticketId)}
          >
            {claimMutation.isPending ? "Claiming..." : "Accept & Claim"}
          </Button>
          <Button
            variant="outline"
            className="w-full"
            data-testid="button-view-ticket"
            onClick={() => {
              setOpen(false);
              setQueue(prev => prev.filter(t => t.id !== current.id));
              setLocation(`/tickets/${current.ticketId}`);
            }}
          >
            View Ticket
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => setOpen(false)}>
            Dismiss
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AppContent() {
  const { user, isLoading, isAdmin } = useAuth();

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

  useEffect(() => {
    if (!user) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    (window as any).__ws = ws;
    ws.onclose = () => {
      setTimeout(() => {
        if ((window as any).__ws === ws) {
          const newWs = new WebSocket(`${protocol}//${window.location.host}/ws`);
          (window as any).__ws = newWs;
        }
      }, 3000);
    };
    return () => {
      ws.close();
      if ((window as any).__ws === ws) {
        (window as any).__ws = null;
      }
    };
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
    return (
      <>
        <OfflineBanner />
        <AuthPage />
      </>
    );
  }

  return (
    <>
      <BroadcastAlertPopup />
      {isAdmin && <TicketTransferPopup />}
      <WelcomeDialog />
      <SetupReminderDialog />
      <PrivateMessagePopup />
      <AuthenticatedLayout />
    </>
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
    return !sessionStorage.getItem("splashShown");
  });

  const handleSplashComplete = useCallback(() => {
    sessionStorage.setItem("splashShown", "1");
    setShowSplash(false);
  }, []);

  return (
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
  );
}
