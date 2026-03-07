import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { format } from "date-fns";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Send, Paperclip, X, CheckCircle, User as UserIcon, Shield, Zap, ArrowRightLeft, FileText, Film, Download, RefreshCw, Clock } from "lucide-react";
import { ClickableImage, ClickableVideo } from "@/components/image-lightbox";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Ticket, TicketMessage, Service, User, QuickResponse, TicketCategory } from "@shared/schema";

type EnrichedTicketMessage = TicketMessage & { senderName?: string; senderRole?: string };

function getFileType(url: string): "image" | "video" | "other" {
  const ext = url.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi", "mkv", "m4v"].includes(ext)) return "video";
  return "other";
}

function getFileName(url: string): string {
  return url.split("/").pop() || "file";
}

function FileAttachment({ url, className }: { url: string; className?: string }) {
  const type = getFileType(url);
  if (type === "image") {
    return (
      <div className="mt-2">
        <ClickableImage src={url} alt="Attachment" className={className || "max-w-full h-32 object-cover rounded-md"} />
        <a href={url} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-download-image">
          <Download className="w-3 h-3" />
          <span>Download</span>
        </a>
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className="mt-2">
        <ClickableVideo src={url} className="max-w-full max-h-48" />
        <a href={url} download target="_blank" rel="noopener noreferrer" className="mt-1 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors" data-testid="link-download-video">
          <Download className="w-3 h-3" />
          <span>Download</span>
        </a>
      </div>
    );
  }
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" download className="mt-2 flex items-center gap-2 p-2 bg-background/50 rounded-md hover:bg-background/80 transition-colors" data-testid="file-attachment">
      <FileText className="w-4 h-4 flex-shrink-0" />
      <span className="text-xs underline break-all">{getFileName(url)}</span>
      <Download className="w-3 h-3 flex-shrink-0 ml-auto" />
    </a>
  );
}

export default function TicketDetail() {
  const params = useParams<{ id: string }>();
  const { user, isAdmin } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferToAdminId, setTransferToAdminId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);

  const { data: ticket, isLoading } = useQuery<Ticket>({
    queryKey: ["/api/tickets", params.id],
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<EnrichedTicketMessage[]>({
    queryKey: ["/api/tickets", params.id, "messages"],
    refetchInterval: 5000,
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: customerInfo } = useQuery<{
    customer: { id: string; username: string; email: string; fullName: string; role: string };
    ticket: { id: string; subject: string; description: string; serviceId: string | null; status: string; priority: string; createdAt: string; closedAt: string | null; imageUrl: string | null };
  }>({
    queryKey: ["/api/tickets", params.id, "customer"],
    enabled: isAdmin,
  });

  const { data: quickResponses } = useQuery<QuickResponse[]>({
    queryKey: ["/api/quick-responses"],
    enabled: isAdmin,
  });

  type PreviousTicket = {
    id: string;
    subject: string;
    status: string;
    resolutionNote: string | null;
    closedBy: string | null;
    categoryId: string | null;
    categoryName: string | null;
    createdAt: string;
    closedAt: string | null;
  };

  const { data: previousTickets, isLoading: previousTicketsLoading } = useQuery<PreviousTicket[]>({
    queryKey: ["/api/admin/customers", ticket?.customerId, "tickets", { excludeTicketId: params.id }],
    queryFn: async () => {
      const res = await fetch(`/api/admin/customers/${ticket!.customerId}/tickets?excludeTicketId=${params.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: isAdmin && !!ticket?.customerId && historyOpen,
  });

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (user) {
        ws.send(JSON.stringify({ type: "viewing_ticket", ticketId: params.id, userId: user.id }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "ticket_message" && data.ticketId === params.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
          setTypingUser(null);
        }
        if (data.type === "typing" && data.ticketId === params.id && data.userId !== user?.id) {
          setTypingUser(data.userName);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
        }
      } catch {}
    };

    return () => {
      if (user && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "left_ticket", ticketId: params.id, userId: user.id }));
      }
      ws.close();
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [params.id, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && user) {
      ws.send(JSON.stringify({ type: "typing", ticketId: params.id, userId: user.id, userName: user.fullName }));
    }
  };

  const sendMutation = useMutation({
    mutationFn: async () => {
      const formData = new FormData();
      formData.append("message", message);
      if (imageFile) formData.append("image", imageFile);

      const res = await fetch(`/api/tickets/${params.id}/messages`, {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
      setMessage("");
      setImageFile(null);
    },
    onError: (e: Error) => {
      toast({ title: "Failed to send message", description: e.message, variant: "destructive" });
    },
  });

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");

  const closeMutation = useMutation({
    mutationFn: async (note?: string) => {
      const body: any = { status: "closed" };
      if (note) body.resolutionNote = note;
      await apiRequest("PATCH", `/api/tickets/${params.id}`, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      setCloseDialogOpen(false);
      setResolutionNote("");
      toast({ title: "Ticket closed" });
    },
  });

  const claimMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/tickets/${params.id}/claim`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket claimed" });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to claim ticket", description: e.message, variant: "destructive" });
    },
  });

  const { data: supportAdmins } = useQuery<{ id: string; fullName: string }[]>({
    queryKey: ["/api/admin/support-admins"],
    enabled: transferDialogOpen,
  });

  const transferMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/tickets/${params.id}/transfer`, {
        toAdminId: transferToAdminId,
        reason: transferReason,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/tickets"] });
      toast({ title: "Ticket transferred successfully" });
      setTransferDialogOpen(false);
      setTransferToAdminId("");
      setTransferReason("");
      setLocation("/tickets");
    },
    onError: (e: Error) => {
      toast({ title: "Failed to transfer ticket", description: e.message, variant: "destructive" });
    },
  });

  const { data: categories } = useQuery<TicketCategory[]>({ queryKey: ["/api/ticket-categories"] });
  const serviceName = services?.find((s) => s.id === ticket?.serviceId)?.name;
  const categoryName = categories?.find((c) => c.id === ticket?.categoryId)?.name;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!ticket) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Ticket not found</p>
        <Link href="/tickets">
          <Button variant="ghost" className="mt-2">Back to Tickets</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-4rem)] max-h-[calc(100vh-4rem)] overflow-x-hidden">
      <div className="flex items-center justify-between gap-3 pb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Link href="/tickets">
            <Button variant="ghost" size="icon" data-testid="button-back-tickets">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
              queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
            }}
            data-testid="button-refresh-ticket"
          >
            <RefreshCw className="w-4 h-4" />
          </Button>
          <div>
            <h2 className="font-semibold text-lg" data-testid="text-ticket-subject">{ticket.subject}</h2>
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={ticket.status === "open" ? "default" : "secondary"} className="text-xs capitalize">{ticket.status}</Badge>
              <Badge variant={ticket.priority === "high" ? "destructive" : "secondary"} className="text-xs capitalize">{ticket.priority}</Badge>
              {serviceName && <Badge variant="secondary" className="text-xs">{serviceName}</Badge>}
              {categoryName && <Badge variant="outline" className="text-xs">{categoryName}</Badge>}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && ticket.status === "open" && !ticket.claimedBy && (
            <Button variant="default" size="sm" onClick={() => claimMutation.mutate()} disabled={claimMutation.isPending} data-testid="button-claim-ticket">
              <Shield className="w-4 h-4 mr-1" /> {claimMutation.isPending ? "Claiming..." : "Claim Ticket"}
            </Button>
          )}
          {ticket.claimedBy && (
            <Badge variant="outline" className="text-xs gap-1" data-testid="badge-claimed-by">
              <Shield className="w-3 h-3" />
              {isAdmin ? (ticket.claimedBy === user?.id ? "Claimed by you" : `Claimed by ${(ticket as any).claimedByName || "admin"}`) : "Claimed"}
            </Badge>
          )}
          {isAdmin && (
            <Dialog open={customerInfoOpen} onOpenChange={setCustomerInfoOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-customer-info">
                  <UserIcon className="w-4 h-4 mr-1" /> Customer Info
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Customer & Ticket Information</DialogTitle>
                </DialogHeader>
                {customerInfo && (
                  <div className="space-y-6">
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">Customer Information</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Full Name</span>
                          <span className="text-sm" data-testid="text-customer-fullname">{customerInfo.customer.fullName}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Username</span>
                          <span className="text-sm" data-testid="text-customer-username">{customerInfo.customer.username}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Email</span>
                          <span className="text-sm" data-testid="text-customer-email">{customerInfo.customer.email}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Role</span>
                          <span className="text-sm capitalize">{customerInfo.customer.role}</span>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <h4 className="font-semibold text-sm">Ticket Details</h4>
                      <div className="space-y-2">
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Subject</span>
                          <span className="text-sm" data-testid="text-ticket-detail-subject">{customerInfo.ticket.subject}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Description</span>
                          <span className="text-sm text-right max-w-[60%]">{customerInfo.ticket.description}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Service</span>
                          <span className="text-sm">{services?.find((s) => s.id === customerInfo.ticket.serviceId)?.name || "N/A"}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Priority</span>
                          <span className="text-sm capitalize" data-testid="text-ticket-detail-priority">{customerInfo.ticket.priority}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Status</span>
                          <span className="text-sm capitalize" data-testid="text-ticket-detail-status">{customerInfo.ticket.status}</span>
                        </div>
                        <div className="flex justify-between gap-2">
                          <span className="text-sm text-muted-foreground">Created</span>
                          <span className="text-sm">{format(new Date(customerInfo.ticket.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
                        </div>
                        {customerInfo.ticket.closedAt && (
                          <div className="flex justify-between gap-2">
                            <span className="text-sm text-muted-foreground">Closed</span>
                            <span className="text-sm">{format(new Date(customerInfo.ticket.closedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                          </div>
                        )}
                        {customerInfo.ticket.imageUrl && (
                          <div className="flex justify-between gap-2">
                            <span className="text-sm text-muted-foreground">Attachment</span>
                            <FileAttachment url={customerInfo.ticket.imageUrl} className="max-w-[120px] h-20 object-cover rounded-md" />
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          )}
          {isAdmin && (
            <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-ticket-history">
                  <Clock className="w-4 h-4 mr-1" /> History
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[80vh] flex flex-col">
                <DialogHeader><DialogTitle>Customer's Previous Tickets</DialogTitle></DialogHeader>
                <div className="flex-1 overflow-y-auto space-y-3">
                  {previousTicketsLoading ? (
                    <div className="space-y-3">
                      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
                    </div>
                  ) : !previousTickets || previousTickets.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-8">No previous tickets from this customer</p>
                  ) : (
                    previousTickets.map((pt) => (
                      <div key={pt.id} className="p-3 rounded-md border space-y-2" data-testid={`previous-ticket-${pt.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{pt.subject}</p>
                          <Badge variant={pt.status === "closed" ? "secondary" : "default"} className="text-xs capitalize flex-shrink-0">{pt.status}</Badge>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                          <span>Opened {format(new Date(pt.createdAt), "MMM d, yyyy")}</span>
                          {pt.closedAt && <span>· Closed {format(new Date(pt.closedAt), "MMM d, yyyy")}</span>}
                          {pt.categoryName && <Badge variant="outline" className="text-[10px]">{pt.categoryName}</Badge>}
                          {pt.closedBy && (
                            <Badge variant="outline" className="text-[10px]">
                              {pt.closedBy === ticket.customerId ? "Closed by Customer" : "Closed by Admin"}
                            </Badge>
                          )}
                        </div>
                        {pt.resolutionNote && (
                          <div className={`p-2 rounded text-xs whitespace-pre-wrap ${pt.closedBy === ticket.customerId ? "bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300" : "bg-green-50 dark:bg-green-950/30 text-green-700 dark:text-green-300"}`} style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                            <span className="font-semibold">{pt.closedBy === ticket.customerId ? "Customer Note: " : "Resolution: "}</span>
                            {pt.resolutionNote}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </DialogContent>
            </Dialog>
          )}
          {isAdmin && ticket.status === "open" && ticket.claimedBy === user?.id && (
            <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-transfer-ticket">
                  <ArrowRightLeft className="w-4 h-4 mr-1" /> Transfer
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Transfer Ticket</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <Select value={transferToAdminId} onValueChange={setTransferToAdminId}>
                    <SelectTrigger data-testid="select-transfer-admin">
                      <SelectValue placeholder="Select an admin" />
                    </SelectTrigger>
                    <SelectContent>
                      {supportAdmins?.filter((a) => a.id !== user?.id).map((admin) => (
                        <SelectItem key={admin.id} value={admin.id}>
                          {admin.fullName}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Textarea
                    placeholder="Reason for transfer..."
                    value={transferReason}
                    onChange={(e) => setTransferReason(e.target.value)}
                    data-testid="input-transfer-reason"
                  />
                  <Button
                    onClick={() => transferMutation.mutate()}
                    disabled={!transferToAdminId || !transferReason.trim() || transferMutation.isPending}
                    className="w-full"
                    data-testid="button-submit-transfer"
                  >
                    {transferMutation.isPending ? "Transferring..." : "Transfer Ticket"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {ticket.status === "open" && isAdmin && (
            <Dialog open={closeDialogOpen} onOpenChange={(open) => { setCloseDialogOpen(open); if (!open) setResolutionNote(""); }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-close-ticket">
                  <CheckCircle className="w-4 h-4 mr-1" /> Close Ticket
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Close Ticket</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Textarea
                    placeholder="Describe the issue and how it was resolved..."
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    rows={5}
                    data-testid="input-resolution-note"
                  />
                  <p className="text-xs text-muted-foreground">Customer will receive a copy of your detailed ticket summary</p>
                  <Button
                    className="w-full"
                    disabled={closeMutation.isPending || !resolutionNote.trim()}
                    onClick={() => closeMutation.mutate(resolutionNote.trim())}
                    data-testid="button-confirm-close-ticket"
                  >
                    {closeMutation.isPending ? "Closing..." : "Close Ticket"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
          {ticket.status === "open" && !isAdmin && (
            <Dialog open={closeDialogOpen} onOpenChange={(open) => { setCloseDialogOpen(open); if (!open) setResolutionNote(""); }}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" data-testid="button-close-ticket">
                  <CheckCircle className="w-4 h-4 mr-1" /> Close Ticket
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>Close Ticket</DialogTitle></DialogHeader>
                <div className="space-y-4">
                  <Textarea
                    placeholder="Add a note about this ticket (optional)"
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    rows={4}
                    data-testid="input-customer-close-note"
                  />
                  <Button
                    className="w-full"
                    disabled={closeMutation.isPending}
                    onClick={() => closeMutation.mutate(resolutionNote.trim() || undefined)}
                    data-testid="button-confirm-close-ticket"
                  >
                    {closeMutation.isPending ? "Closing..." : "Close Ticket"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="flex-1 flex flex-col min-h-0 p-0">
          <div className="p-4 border-b bg-card">
            <p className="text-sm" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} data-testid="text-ticket-description">{ticket.description}</p>
            {ticket.imageUrl && (
              <FileAttachment url={ticket.imageUrl} className="mt-2 max-w-xs h-32 object-cover rounded-md" />
            )}
            <p className="text-xs text-muted-foreground mt-2">
              Opened {format(new Date(ticket.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>

          {ticket.status === "closed" && (
            <div className="mx-4 mt-4 space-y-2">
              {ticket.closedBy && (
                <Badge variant="outline" className="text-xs" data-testid="badge-closed-by">
                  {ticket.closedBy === ticket.customerId ? "Closed by Customer" : "Closed by Admin"}
                </Badge>
              )}
              {ticket.resolutionNote && ticket.closedBy === ticket.customerId && (
                <div className="p-3 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30" data-testid="customer-close-note">
                  <p className="text-xs font-semibold text-blue-800 dark:text-blue-400 mb-1">Customer's Closing Note</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300 whitespace-pre-wrap" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{ticket.resolutionNote}</p>
                </div>
              )}
              {ticket.resolutionNote && ticket.closedBy !== ticket.customerId && (
                <div className="p-3 rounded-md border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30" data-testid="resolution-note">
                  <p className="text-xs font-semibold text-green-800 dark:text-green-400 mb-1">Resolution Summary</p>
                  <p className="text-sm text-green-700 dark:text-green-300 whitespace-pre-wrap" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{ticket.resolutionNote}</p>
                </div>
              )}
            </div>
          )}

          <div className="flex-1 p-4 overflow-y-auto overscroll-contain" style={{ WebkitOverflowScrolling: "touch" }}>
            {messagesLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : !messages || messages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Start the conversation below.</p>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const isMe = msg.senderId === user?.id;
                  const isAdminSender = msg.senderRole === "admin";
                  const displayName = isMe ? "You" : (msg.senderName || "Support");
                  return (
                    <div key={msg.id} className={`flex gap-2.5 ${isMe ? "flex-row-reverse" : ""}`} data-testid={`message-${msg.id}`}>
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="text-xs">
                          {isMe ? (user?.fullName?.[0] || "U") : (msg.senderName?.[0] || "S")}
                        </AvatarFallback>
                      </Avatar>
                      <div className={`max-w-[70%] min-w-0 space-y-1 ${isMe ? "items-end" : ""}`}>
                        <div className={isMe ? "text-right" : ""} data-testid={`text-chat-sender-${msg.id}`}>
                          <p className="text-xs font-medium">{displayName}</p>
                          {isAdminSender && !isMe && (
                            <p className="text-[10px] text-muted-foreground">CowboyMedia Support</p>
                          )}
                        </div>
                        <div className={`rounded-md p-3 text-sm whitespace-pre-wrap overflow-hidden ${isMe ? "bg-primary text-primary-foreground" : "bg-accent"}`} style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                          {msg.message}
                          {msg.imageUrl && (
                            <FileAttachment url={msg.imageUrl} />
                          )}
                        </div>
                        <p className={`text-xs text-muted-foreground ${isMe ? "text-right" : ""}`}>
                          {format(new Date(msg.createdAt), "h:mm a")}
                        </p>
                      </div>
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {ticket.status === "open" && isAdmin && !ticket.claimedBy && (
            <div className="p-3 border-t bg-accent/50">
              <p className="text-sm text-muted-foreground text-center" data-testid="text-claim-required">
                You must claim this ticket before you can respond.
              </p>
            </div>
          )}

          {ticket.status === "open" && isAdmin && ticket.claimedBy && ticket.claimedBy !== user?.id && (
            <div className="p-3 border-t bg-accent/50">
              <p className="text-sm text-muted-foreground text-center" data-testid="text-claimed-by-other">
                This ticket has been claimed by another admin.
              </p>
            </div>
          )}

          {typingUser && (
            <div className="px-4 py-1" data-testid="typing-indicator">
              <p className="text-xs text-muted-foreground italic">{typingUser} is typing<span className="animate-pulse">...</span></p>
            </div>
          )}

          {ticket.status === "open" && (!isAdmin || ticket.claimedBy === user?.id) && (
            <div className="p-3 border-t">
              {imageFile && (
                <div className="flex items-center gap-2 mb-2 p-2 bg-accent rounded-md">
                  {imageFile.type.startsWith("video/") ? <Film className="w-4 h-4 flex-shrink-0" /> :
                   imageFile.type.startsWith("image/") ? <Paperclip className="w-4 h-4 flex-shrink-0" /> :
                   <FileText className="w-4 h-4 flex-shrink-0" />}
                  <span className="text-xs truncate flex-1">{imageFile.name}</span>
                  <Button size="icon" variant="ghost" onClick={() => setImageFile(null)} data-testid="button-remove-image">
                    <X className="w-3 h-3" />
                  </Button>
                </div>
              )}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (message.trim() || imageFile) sendMutation.mutate();
                }}
                className="flex items-center gap-2"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="*/*"
                  className="hidden"
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach-image"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                {isAdmin && quickResponses && quickResponses.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" data-testid="button-quick-responses">
                        <Zap className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto">
                      {quickResponses.map((qr) => (
                        <DropdownMenuItem key={qr.id} onClick={() => setMessage(qr.message)} data-testid={`quick-response-${qr.id}`}>
                          {qr.title}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Input
                  ref={messageInputRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    if (e.target.value.trim()) sendTypingEvent();
                  }}
                  placeholder="Type a message..."
                  className="flex-1"
                  data-testid="input-message"
                />
                <Button type="submit" size="icon" disabled={sendMutation.isPending || (!message.trim() && !imageFile)} data-testid="button-send-message">
                  <Send className="w-4 h-4" />
                </Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
