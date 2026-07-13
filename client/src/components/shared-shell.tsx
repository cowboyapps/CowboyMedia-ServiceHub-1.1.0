// Shell components shared between the CUSTOMER app (App.tsx) and the ADMIN PWA
// (admin-app.tsx). These used to live inside App.tsx; they were extracted so
// the admin app can reuse them without pulling in the whole customer shell.

import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useGlobalSocket } from "@/contexts/global-socket-context";
import { useToast } from "@/hooks/use-toast";
import { serverActionErrorMessage } from "@/lib/server-error";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Megaphone, ArrowRightLeft } from "lucide-react";
import { format } from "date-fns";

// ---------------------------------------------------------------------------
// Admin "support away" banner
// ---------------------------------------------------------------------------

type AdminAwayStatus = {
  enabled: boolean;
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
  message: string;
};

function useSupportAwayStatus() {
  const { user } = useAuth();
  return useQuery<AdminAwayStatus>({
    queryKey: ["/api/support-away/status"],
    enabled: !!user,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  });
}

export function AdminAwayBanner() {
  const { user } = useAuth();
  const { data } = useSupportAwayStatus();
  if (!user || (user.role !== "admin" && user.role !== "master_admin")) return null;
  if (!data?.isActive) return null;
  const endLabel = data.endAt
    ? new Date(data.endAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })
    : null;
  return (
    <div
      className="flex items-start gap-2 px-3 py-2 border-b bg-orange-500/15 dark:bg-orange-500/20 text-xs"
      data-testid="banner-admin-away-active"
    >
      <span className="inline-flex items-center rounded-sm bg-orange-500 text-white px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 mt-0.5">
        Away
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-orange-900 dark:text-orange-100">
          <span className="font-medium">Support away message is active.</span>{" "}
          New tickets receive the away auto-reply{endLabel ? ` until ${endLabel}` : ""}.
        </p>
      </div>
      <Link
        href="/admin?tab=support-away"
        className="text-orange-900 dark:text-orange-100 underline whitespace-nowrap"
        data-testid="link-admin-away-manage"
      >
        Manage
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Broadcast (urgent admin alert) popup
// ---------------------------------------------------------------------------

interface BroadcastMsg {
  id: string;
  title: string;
  message: string;
  senderId: string;
  createdAt: string;
}

export function BroadcastAlertPopup() {
  const { user } = useAuth();
  const { subscribe } = useGlobalSocket();
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
    const handleWs = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "broadcast_alert" && data.recipientIds?.includes(user.id)) {
          const newBroadcast = { id: data.broadcastId, title: data.title, message: data.message, senderId: "", createdAt: new Date().toISOString() };
          setQueue(prev => prev.some(b => b.id === newBroadcast.id) ? prev : [...prev, newBroadcast]);
        }
      } catch {}
    };
    return subscribe(handleWs);
  }, [user, subscribe]);

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

// ---------------------------------------------------------------------------
// Ticket transfer request popup (admins only)
// ---------------------------------------------------------------------------

interface TransferData {
  id: number;
  ticketId: string;
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

export function TicketTransferPopup() {
  const { user } = useAuth();
  const { subscribe } = useGlobalSocket();
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
    return subscribe(handleWs);
  }, [user, subscribe]);

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
      toast({ title: "Failed to claim ticket", description: serverActionErrorMessage(e, "Couldn't claim this ticket. Please try again."), variant: "destructive" });
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

// ---------------------------------------------------------------------------
// Presence sync — reports the current page over the global websocket
// ---------------------------------------------------------------------------

export function LocationPresenceSync({ location }: { location: string }) {
  const { sendMessage } = useGlobalSocket();
  useEffect(() => {
    sendMessage({ type: "current_page", page: location });
  }, [location, sendMessage]);
  return null;
}
