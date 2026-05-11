import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { format, isToday, isYesterday } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Send, Paperclip, X, CheckCircle, User as UserIcon, Shield, Zap, ArrowRightLeft, FileText, Film, Download, RefreshCw, Clock, MoreVertical, ChevronDown, AlertCircle, RotateCcw, AlertTriangle, Sparkles, Loader2, Lock, Pencil, Trash2, Check } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsMobile } from "@/hooks/use-mobile";
import { ClickableImage, ClickableVideo } from "@/components/image-lightbox";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Ticket, TicketMessage, Service, User, QuickResponse, TicketCategory } from "@shared/schema";

type EnrichedTicketMessage = TicketMessage & { senderName?: string; senderRole?: string };

type OptimisticMessage = {
  id: string;
  ticketId: string;
  senderId: string;
  message: string;
  imageUrl: string | null;
  createdAt: string;
  senderName: string;
  senderRole: string;
  status: "sending" | "failed";
  imageFile?: File;
  isInternal?: boolean;
};

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="bouncing-dots">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-muted-foreground"
          style={{
            animation: "bounce-dot 1.4s infinite ease-in-out both",
            animationDelay: `${i * 0.16}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes bounce-dot {
          0%, 80%, 100% { transform: scale(0); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
      `}</style>
    </span>
  );
}

function formatDateSeparator(date: Date): string {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

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
  const isMobile = useIsMobile();
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState("");
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    const t = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, [isAdmin]);
  const [customerInfoOpen, setCustomerInfoOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);
  const [transferToAdminId, setTransferToAdminId] = useState("");
  const [transferReason, setTransferReason] = useState("");
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [optimisticMessages, setOptimisticMessages] = useState<OptimisticMessage[]>([]);
  const [onlineViewers, setOnlineViewers] = useState<Map<string, string>>(new Map());
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const isNearBottomRef = useRef(true);
  const searchParams = new URLSearchParams(window.location.search);
  const originTicketId = searchParams.get("from");
  const originTicketSubject = searchParams.get("fromSubject");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
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

  const { data: customerInfo, isLoading: customerInfoLoading, error: customerInfoError } = useQuery<{
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

  type Suggestion = { id: string; title: string; message: string };
  const { data: suggestions } = useQuery<Suggestion[]>({
    queryKey: ["/api/tickets", params.id, "suggestions"],
    enabled: isAdmin && !!params.id,
  });

  const { data: aiStatus } = useQuery<{ enabled: boolean }>({
    queryKey: ["/api/ai-draft/status"],
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const applySuggestion = (text: string) => {
    if (message.trim() && !window.confirm("Replace your current draft with this response?")) return;
    setMessage(text);
    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (el) {
        el.focus();
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, 120) + "px";
      }
    });
  };

  const aiDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tickets/${params.id}/ai-draft`);
      return (await res.json()) as { draft: string; remaining: number };
    },
    onSuccess: (data) => {
      applySuggestion(data.draft);
      toast({ title: "AI draft ready", description: "Edit before sending." });
    },
    onError: (err: any) => {
      toast({ title: "AI draft failed", description: err?.message || "Try again later.", variant: "destructive" });
    },
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

  const markTicketRead = useCallback(() => {
    apiRequest("POST", "/api/ticket-notifications/mark-read").then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    }).catch(() => {});
  }, []);

  const userIdRef = useRef<string | null>(null);
  const userNameRef = useRef<string | null>(null);
  const userRoleRef = useRef<string>("user");
  userIdRef.current = user?.id ?? null;
  userNameRef.current = user?.fullName ?? null;
  userRoleRef.current = isAdmin ? "admin" : "user";

  useEffect(() => {
    markTicketRead();
  }, [params.id, markTicketRead]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (userIdRef.current) {
          ws!.send(JSON.stringify({ type: "viewing_ticket", ticketId: params.id, userId: userIdRef.current, userRole: userRoleRef.current }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "ticket_message" && data.ticketId === params.id) {
            queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
            setTypingUser(null);
            markTicketRead();
          }
          if (data.type === "ticket_messages_read" && data.ticketId === params.id && data.readBy !== userIdRef.current) {
            queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
          }
          if (data.type === "typing" && data.ticketId === params.id && data.userId !== userIdRef.current) {
            setTypingUser(data.userName);
            if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
            typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
          }
          if (data.type === "ticket_updated" && data.ticket?.id === params.id) {
            queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id] });
          }
          if (data.type === "ticket_presence" && data.ticketId === params.id && data.userId !== userIdRef.current) {
            setOnlineViewers((prev) => {
              const next = new Map(prev);
              if (data.status === "online") next.set(data.userId, data.userRole || "user");
              else next.delete(data.userId);
              return next;
            });
          }
          if (data.type === "ticket_viewers" && data.ticketId === params.id) {
            const viewers = (data.viewers as { userId: string; userRole: string }[])
              .filter((v) => v.userId !== userIdRef.current);
            const map = new Map<string, string>();
            viewers.forEach((v) => map.set(v.userId, v.userRole));
            setOnlineViewers(map);
          }
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => {
        ws?.close();
      };
    }

    connect();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markTicketRead();
        const current = wsRef.current;
        if (current && current.readyState === WebSocket.OPEN && userIdRef.current) {
          current.send(JSON.stringify({ type: "viewing_ticket", ticketId: params.id, userId: userIdRef.current, userRole: userRoleRef.current }));
        } else if (!current || current.readyState === WebSocket.CLOSED) {
          connect();
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (ws && ws.readyState === WebSocket.OPEN && userIdRef.current) {
        ws.send(JSON.stringify({ type: "left_ticket", ticketId: params.id, userId: userIdRef.current }));
      }
      ws?.close();
      wsRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [params.id]);

  useEffect(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && user?.id) {
      ws.send(JSON.stringify({ type: "viewing_ticket", ticketId: params.id, userId: user.id, userRole: isAdmin ? "admin" : "user" }));
    }
  }, [user?.id, params.id]);

  const cleanupBodyStyles = () => {
    document.body.style.removeProperty("pointer-events");
    document.body.removeAttribute("data-scroll-locked");
    document.body.style.removeProperty("overflow");
    document.body.style.removeProperty("padding-right");
  };

  useEffect(() => {
    setCustomerInfoOpen(false);
    setHistoryOpen(false);
    setTransferDialogOpen(false);
    setCloseDialogOpen(false);
    setMessage("");
    setImageFile(null);
    setOptimisticMessages([]);
    setOnlineViewers(new Map());
    setShowNewMessagesPill(false);
    isNearBottomRef.current = true;
    prevMessageCountRef.current = 0;

    cleanupBodyStyles();
    const interval = setInterval(cleanupBodyStyles, 50);
    const timeout = setTimeout(() => clearInterval(interval), 500);
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [params.id]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
    setShowNewMessagesPill(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const threshold = 100;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessagesPill(false);
  }, []);

  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    const count = messages?.length || 0;
    if (count > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      if (isNearBottomRef.current) {
        scrollToBottom();
      } else {
        setShowNewMessagesPill(true);
      }
    } else if (count > 0 && prevMessageCountRef.current === 0) {
      scrollToBottom("auto");
    }
    prevMessageCountRef.current = count;
  }, [messages, scrollToBottom]);

  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && userIdRef.current && userNameRef.current) {
      ws.send(JSON.stringify({ type: "typing", ticketId: params.id, userId: userIdRef.current, userName: userNameRef.current }));
    }
  };

  const doSendMessage = useCallback((msgText: string, imgFile: File | null, optimisticId?: string, internal: boolean = false) => {
    const tempId = optimisticId || `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const optimistic: OptimisticMessage = {
      id: tempId,
      ticketId: params.id!,
      senderId: user?.id || "",
      message: msgText,
      imageUrl: null,
      createdAt: new Date().toISOString(),
      senderName: user?.fullName || "You",
      senderRole: isAdmin ? "admin" : "user",
      status: "sending",
      imageFile: imgFile || undefined,
      isInternal: internal,
    };

    if (!optimisticId) {
      setOptimisticMessages((prev) => [...prev, optimistic]);
    } else {
      setOptimisticMessages((prev) => prev.map((m) => m.id === optimisticId ? { ...m, status: "sending" as const } : m));
    }

    if (isNearBottomRef.current) {
      setTimeout(() => scrollToBottom(), 50);
    }

    const formData = new FormData();
    formData.append("message", msgText);
    if (imgFile) formData.append("image", imgFile);
    if (internal) formData.append("isInternal", "true");

    fetch(`/api/tickets/${params.id}/messages`, {
      method: "POST",
      body: formData,
      credentials: "include",
    })
      .then((res) => {
        if (!res.ok) throw new Error("Failed to send");
        return res.json();
      })
      .then(() => {
        setOptimisticMessages((prev) => prev.filter((m) => m.id !== tempId));
        queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
      })
      .catch(() => {
        setOptimisticMessages((prev) => prev.map((m) => m.id === tempId ? { ...m, status: "failed" as const } : m));
      });
  }, [params.id, user, isAdmin, scrollToBottom]);

  const handleSend = useCallback(() => {
    const msgText = message.trim();
    const imgFile = imageFile;
    if (!msgText && !imgFile) return;
    const internal = isAdmin && isInternalNote;
    setMessage("");
    setImageFile(null);
    setIsInternalNote(false);
    doSendMessage(msgText, imgFile, undefined, internal);
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) {
        el.style.height = "auto";
        el.focus();
      }
    }, 0);
  }, [message, imageFile, isInternalNote, isAdmin, doSendMessage]);

  const retryMessage = useCallback((msg: OptimisticMessage) => {
    doSendMessage(msg.message, msg.imageFile || null, msg.id, !!msg.isInternal);
  }, [doSendMessage]);

  const editNoteMutation = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      await apiRequest("PATCH", `/api/tickets/${params.id}/messages/${id}`, { message: text });
    },
    onSuccess: () => {
      setEditingNoteId(null);
      setEditingNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to edit note", description: e.message, variant: "destructive" });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/tickets/${params.id}/messages/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tickets", params.id, "messages"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed to delete note", description: e.message, variant: "destructive" });
    },
  });

  const allMessages = useMemo(() => {
    const real = (messages || []) as (EnrichedTicketMessage & { _optimistic?: false })[];
    const realIds = new Set(real.map((m) => m.id));
    const pending = optimisticMessages.filter((m) => !realIds.has(m.id));
    return [...real, ...pending.map((m) => ({ ...m, _optimistic: true as const }))];
  }, [messages, optimisticMessages]);

  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");

  useEffect(() => {
    if (!customerInfoOpen && !historyOpen && !transferDialogOpen && !closeDialogOpen) {
      cleanupBodyStyles();
      const t1 = setTimeout(cleanupBodyStyles, 100);
      const t2 = setTimeout(cleanupBodyStyles, 300);
      const t3 = setTimeout(cleanupBodyStyles, 500);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, [customerInfoOpen, historyOpen, transferDialogOpen, closeDialogOpen]);

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
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden px-3 pt-3 sm:px-6 sm:pt-4" style={{ overscrollBehavior: "none" }}>
      <div className="flex items-center justify-between gap-3 pb-4 flex-wrap flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setLocation("/tickets")} data-testid="button-back-tickets">
            <ArrowLeft className="w-4 h-4" />
          </Button>
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
              {(() => {
                const otherPartyRole = isAdmin ? "user" : "admin";
                const hasOtherParty = Array.from(onlineViewers.values()).some((role) =>
                  otherPartyRole === "admin" ? (role === "admin" || role === "master_admin") : role === "user"
                );
                const label = isAdmin ? "Customer" : "Support";
                return (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground" data-testid="presence-indicator">
                    <span className={`w-2 h-2 rounded-full ${hasOtherParty ? "bg-green-500" : "bg-gray-400"}`} />
                    {hasOtherParty ? `${label} online` : `${label} away`}
                  </span>
                );
              })()}
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
          {isMobile && isAdmin && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" data-testid="button-ticket-actions-menu">
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCustomerInfoOpen(true)} data-testid="menu-customer-info">
                  <UserIcon className="w-4 h-4 mr-2" /> Customer Info
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setHistoryOpen(true)} data-testid="menu-ticket-history">
                  <Clock className="w-4 h-4 mr-2" /> History
                </DropdownMenuItem>
                {ticket.status === "open" && ticket.claimedBy === user?.id && (
                  <DropdownMenuItem onClick={() => setTransferDialogOpen(true)} data-testid="menu-transfer-ticket">
                    <ArrowRightLeft className="w-4 h-4 mr-2" /> Transfer
                  </DropdownMenuItem>
                )}
                {ticket.status === "open" && (
                  <DropdownMenuItem onClick={() => setCloseDialogOpen(true)} data-testid="menu-close-ticket">
                    <CheckCircle className="w-4 h-4 mr-2" /> Close Ticket
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {!isMobile && (
            <>
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setCustomerInfoOpen(true)} data-testid="button-customer-info">
                  <UserIcon className="w-4 h-4 mr-1" /> Customer Info
                </Button>
              )}
              {isAdmin && (
                <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)} data-testid="button-ticket-history">
                  <Clock className="w-4 h-4 mr-1" /> History
                </Button>
              )}
              {isAdmin && ticket.status === "open" && ticket.claimedBy === user?.id && (
                <Button variant="outline" size="sm" onClick={() => setTransferDialogOpen(true)} data-testid="button-transfer-ticket">
                  <ArrowRightLeft className="w-4 h-4 mr-1" /> Transfer
                </Button>
              )}
              {ticket.status === "open" && (
                <Button variant="outline" size="sm" onClick={() => setCloseDialogOpen(true)} data-testid="button-close-ticket">
                  <CheckCircle className="w-4 h-4 mr-1" /> Close Ticket
                </Button>
              )}
            </>
          )}
          {isMobile && !isAdmin && ticket.status === "open" && (
            <Button variant="outline" size="sm" onClick={() => setCloseDialogOpen(true)} data-testid="button-close-ticket">
              <CheckCircle className="w-4 h-4 mr-1" /> Close
            </Button>
          )}
        </div>
      </div>

      <BusinessHoursBanner show={!isAdmin} />

      {originTicketId && originTicketId !== params.id && (
        <div className="flex-shrink-0 mb-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-xs gap-1.5 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/30 hover:bg-blue-100 dark:hover:bg-blue-900/40"
            onClick={() => {
              setLocation(`/tickets/${originTicketId}`);
            }}
            data-testid="button-return-to-ticket"
          >
            <ArrowLeft className="w-3 h-3" />
            Return to: {originTicketSubject || "Previous Ticket"}
          </Button>
        </div>
      )}

      <Dialog open={customerInfoOpen} onOpenChange={setCustomerInfoOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Customer & Ticket Information</DialogTitle>
          </DialogHeader>
          {customerInfoLoading ? (
            <div className="space-y-4" data-testid="customer-info-loading">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-6 w-1/3 mt-4" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : customerInfoError ? (
            <p className="text-sm text-destructive py-4" data-testid="customer-info-error">Failed to load customer information. Please close and try again.</p>
          ) : customerInfo?.customer && customerInfo?.ticket ? (
            <div className="space-y-6">
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Customer Information</h4>
                <div className="space-y-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Full Name</span>
                    <span className="text-sm" data-testid="text-customer-fullname">{customerInfo.customer.fullName || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Username</span>
                    <span className="text-sm" data-testid="text-customer-username">{customerInfo.customer.username || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Email</span>
                    <span className="text-sm" data-testid="text-customer-email">{customerInfo.customer.email || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Role</span>
                    <span className="text-sm capitalize">{customerInfo.customer.role || "—"}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-3">
                <h4 className="font-semibold text-sm">Ticket Details</h4>
                <div className="space-y-2">
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Subject</span>
                    <span className="text-sm" data-testid="text-ticket-detail-subject">{customerInfo.ticket.subject || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Description</span>
                    <span className="text-sm text-right max-w-[60%] whitespace-pre-wrap">{customerInfo.ticket.description || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Service</span>
                    <span className="text-sm">{services?.find((s) => s.id === customerInfo.ticket.serviceId)?.name || "N/A"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Priority</span>
                    <span className="text-sm capitalize" data-testid="text-ticket-detail-priority">{customerInfo.ticket.priority || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <span className="text-sm capitalize" data-testid="text-ticket-detail-status">{customerInfo.ticket.status || "—"}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Created</span>
                    <span className="text-sm">{customerInfo.ticket.createdAt ? format(new Date(customerInfo.ticket.createdAt), "MMM d, yyyy 'at' h:mm a") : "—"}</span>
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
          ) : (
            <p className="text-sm text-muted-foreground py-4" data-testid="customer-info-empty">No customer information available.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md max-h-[80vh] flex flex-col">
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
                <div
                  key={pt.id}
                  className="p-3 rounded-md border space-y-2 cursor-pointer transition-colors"
                  data-testid={`previous-ticket-${pt.id}`}
                  onClick={() => {
                    setHistoryOpen(false);
                    const fromParams = ticket ? `?from=${params.id}&fromSubject=${encodeURIComponent(ticket.subject)}` : "";
                    setLocation(`/tickets/${pt.id}${fromParams}`);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium underline underline-offset-2" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>{pt.subject}</p>
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

      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
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

      {ticket.status === "open" && isAdmin && (
        <Dialog open={closeDialogOpen} onOpenChange={(open) => { setCloseDialogOpen(open); if (!open) setResolutionNote(""); }}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
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
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
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
                onClick={() => closeMutation.mutate(resolutionNote.trim() || "Customer closed without providing a closing description")}
                data-testid="button-confirm-close-ticket"
              >
                {closeMutation.isPending ? "Closing..." : "Close Ticket"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Card className="flex-1 flex flex-col min-h-0 relative">
        <CardContent className="flex-1 flex flex-col min-h-0 p-0 relative">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto overscroll-contain"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            <div className="p-3 sm:p-4 border-b bg-card">
              <p className="text-sm whitespace-pre-wrap" style={{ overflowWrap: "anywhere", wordBreak: "break-word" }} data-testid="text-ticket-description">{ticket.description}</p>
              {ticket.imageUrl && (
                <ClickableImage src={ticket.imageUrl} alt="Ticket attachment" className="mt-2 max-w-[100px] max-h-16 object-cover rounded-md cursor-pointer" />
              )}
              <p className="text-xs text-muted-foreground mt-2">
                Opened {format(new Date(ticket.createdAt), "MMM d, yyyy 'at' h:mm a")}
              </p>
            </div>

            {ticket.status === "closed" && (
              <div className="mx-3 sm:mx-4 mt-3 sm:mt-4 space-y-2">
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

            <div className="p-3 sm:p-4">
            {messagesLoading ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
              </div>
            ) : allMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No messages yet. Start the conversation below.</p>
            ) : (
              <div className="space-y-3 sm:space-y-4">
                {allMessages.map((msg, idx) => {
                  const isMe = msg.senderId === user?.id;
                  const isAdminSender = msg.senderRole === "admin";
                  const displayName = isMe ? "You" : (msg.senderName || "Support");
                  const isOptimistic = "_optimistic" in msg && msg._optimistic;
                  const optimisticData = isOptimistic ? optimisticMessages.find((o) => o.id === msg.id) : null;
                  const isFailed = optimisticData?.status === "failed";
                  const isSending = optimisticData?.status === "sending";

                  const msgDate = new Date(msg.createdAt);
                  const prevMsg = idx > 0 ? allMessages[idx - 1] : null;
                  const prevDate = prevMsg ? new Date(prevMsg.createdAt) : null;
                  const showDateSep = !prevDate ||
                    msgDate.toDateString() !== prevDate.toDateString();

                  const isInternal = !!msg.isInternal || !!optimisticData?.isInternal;
                  const noteAgeMs = Date.now() - msgDate.getTime();
                  const canEditNote = isAdmin && isInternal && isMe && !isOptimistic && noteAgeMs < 5 * 60 * 1000;
                  const isEditingThis = editingNoteId === msg.id;

                  return (
                    <div key={msg.id}>
                      {showDateSep && (
                        <div className="flex items-center gap-3 my-3 sm:my-4" data-testid={`date-separator-${msg.id}`}>
                          <div className="flex-1 h-px bg-border" />
                          <span className="text-xs text-muted-foreground font-medium px-2">{formatDateSeparator(msgDate)}</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                      )}
                      {isInternal ? (
                        <div className="flex gap-2" data-testid={`message-${msg.id}`} data-internal="true">
                          <Avatar className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0 mt-0.5">
                            <AvatarFallback className="text-xs bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                              {msg.senderName?.[0] || "A"}
                            </AvatarFallback>
                          </Avatar>
                          <div className="max-w-[90%] min-w-0 space-y-0.5 flex-1">
                            <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
                              <Lock className="w-3 h-3" />
                              <p className="text-xs font-medium" data-testid={`text-chat-sender-${msg.id}`}>{displayName}</p>
                              <span className="text-[10px] uppercase tracking-wide font-semibold">Internal note · not visible to customer</span>
                            </div>
                            <div
                              className={`rounded-lg p-2.5 sm:p-3 text-sm whitespace-pre-wrap overflow-hidden border-l-4 border-amber-500 ${
                                isFailed
                                  ? "bg-red-50 dark:bg-red-950/30 border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
                                  : isSending
                                    ? "bg-amber-100/60 dark:bg-amber-900/30 opacity-70"
                                    : "bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100"
                              }`}
                              style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                              data-testid={`internal-note-${msg.id}`}
                            >
                              {isEditingThis ? (
                                <div className="space-y-2">
                                  <Textarea
                                    value={editingNoteText}
                                    onChange={(e) => setEditingNoteText(e.target.value)}
                                    className="min-h-[60px] text-sm bg-background"
                                    data-testid={`input-edit-note-${msg.id}`}
                                  />
                                  <div className="flex gap-1.5 justify-end">
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="ghost"
                                      onClick={() => { setEditingNoteId(null); setEditingNoteText(""); }}
                                      data-testid={`button-cancel-edit-${msg.id}`}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      type="button"
                                      size="sm"
                                      onClick={() => {
                                        const trimmed = editingNoteText.trim();
                                        if (!trimmed) return;
                                        editNoteMutation.mutate({ id: msg.id, text: trimmed });
                                      }}
                                      disabled={editNoteMutation.isPending || !editingNoteText.trim()}
                                      data-testid={`button-save-edit-${msg.id}`}
                                    >
                                      <Check className="w-3 h-3 mr-1" /> Save
                                    </Button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {msg.message}
                                  {msg.imageUrl && <FileAttachment url={msg.imageUrl} />}
                                  {isOptimistic && optimisticData?.imageFile && (
                                    <div className="mt-1 flex items-center gap-1.5 text-xs opacity-70">
                                      <Paperclip className="w-3 h-3" />
                                      <span className="truncate">{optimisticData.imageFile.name}</span>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {isSending && (
                                <span className="text-[10px] text-muted-foreground italic" data-testid={`status-sending-${msg.id}`}>Sending...</span>
                              )}
                              {isFailed && (
                                <div className="flex items-center gap-1.5" data-testid={`status-failed-${msg.id}`}>
                                  <AlertCircle className="w-3 h-3 text-red-500" />
                                  <span className="text-[10px] text-red-500">Failed to send</span>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1.5 text-[10px] text-red-600 hover:text-red-700"
                                    onClick={() => retryMessage(optimisticData!)}
                                    data-testid={`button-retry-${msg.id}`}
                                  >
                                    <RotateCcw className="w-3 h-3 mr-0.5" /> Retry
                                  </Button>
                                </div>
                              )}
                              {!isOptimistic && (
                                <p className="text-[10px] sm:text-xs text-muted-foreground">
                                  {format(msgDate, "h:mm a")}
                                </p>
                              )}
                              {canEditNote && !isEditingThis && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1.5 text-[10px]"
                                    onClick={() => { setEditingNoteId(msg.id); setEditingNoteText(msg.message); }}
                                    data-testid={`button-edit-note-${msg.id}`}
                                  >
                                    <Pencil className="w-3 h-3 mr-0.5" /> Edit
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-5 px-1.5 text-[10px] text-red-600 hover:text-red-700"
                                    onClick={() => {
                                      if (window.confirm("Delete this internal note?")) deleteNoteMutation.mutate(msg.id);
                                    }}
                                    disabled={deleteNoteMutation.isPending}
                                    data-testid={`button-delete-note-${msg.id}`}
                                  >
                                    <Trash2 className="w-3 h-3 mr-0.5" /> Delete
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      ) : (
                      <div className={`flex gap-2 ${isMe ? "flex-row-reverse" : ""}`} data-testid={`message-${msg.id}`}>
                        <Avatar className="w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0 mt-0.5">
                          <AvatarFallback className="text-xs">
                            {isMe ? (user?.fullName?.[0] || "U") : (msg.senderName?.[0] || "S")}
                          </AvatarFallback>
                        </Avatar>
                        <div className={`max-w-[80%] sm:max-w-[70%] min-w-0 space-y-0.5 ${isMe ? "items-end" : ""}`}>
                          <div className={isMe ? "text-right" : ""} data-testid={`text-chat-sender-${msg.id}`}>
                            <p className="text-xs font-medium">{displayName}</p>
                            {isAdminSender && !isMe && (
                              <p className="text-[10px] text-muted-foreground">CowboyMedia Support</p>
                            )}
                          </div>
                          <div
                            className={`rounded-lg p-2.5 sm:p-3 text-sm whitespace-pre-wrap overflow-hidden ${
                              isFailed
                                ? "bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 text-red-700 dark:text-red-300"
                                : isSending
                                  ? "bg-primary/70 text-primary-foreground opacity-70"
                                  : isMe
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-accent"
                            }`}
                            style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                          >
                            {msg.message}
                            {msg.imageUrl && (
                              <FileAttachment url={msg.imageUrl} />
                            )}
                            {isOptimistic && optimisticData?.imageFile && (
                              <div className="mt-1 flex items-center gap-1.5 text-xs opacity-70">
                                <Paperclip className="w-3 h-3" />
                                <span className="truncate">{optimisticData.imageFile.name}</span>
                              </div>
                            )}
                          </div>
                          <div className={`flex items-center gap-1.5 ${isMe ? "justify-end" : ""}`}>
                            {isSending && (
                              <span className="text-[10px] text-muted-foreground italic" data-testid={`status-sending-${msg.id}`}>Sending...</span>
                            )}
                            {isFailed && (
                              <div className="flex items-center gap-1.5" data-testid={`status-failed-${msg.id}`}>
                                <AlertCircle className="w-3 h-3 text-red-500" />
                                <span className="text-[10px] text-red-500">Failed to send</span>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-5 px-1.5 text-[10px] text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                                  onClick={() => retryMessage(optimisticData!)}
                                  data-testid={`button-retry-${msg.id}`}
                                >
                                  <RotateCcw className="w-3 h-3 mr-0.5" /> Retry
                                </Button>
                              </div>
                            )}
                            {!isOptimistic && (
                              <p className="text-[10px] sm:text-xs text-muted-foreground">
                                {format(new Date(msg.createdAt), "h:mm a")}
                                {isAdmin && isMe && msg.readAt && <span className="ml-1.5">· Read</span>}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  );
                })}
                <div ref={messagesEndRef} />
              </div>
            )}
            </div>
          </div>

          {showNewMessagesPill && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10">
              <Button
                size="sm"
                variant="secondary"
                className="rounded-full shadow-lg text-xs gap-1 px-3 py-1.5"
                onClick={() => scrollToBottom()}
                data-testid="button-new-messages"
              >
                New messages <ChevronDown className="w-3 h-3" />
              </Button>
            </div>
          )}

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
            <div className="px-3 sm:px-4 py-1" data-testid="typing-indicator">
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <span className="italic">{typingUser}</span>
                <BouncingDots />
              </p>
            </div>
          )}

          {ticket.status === "open" && (!isAdmin || ticket.claimedBy === user?.id) && (
            <div className={`p-2 sm:p-3 border-t ${isAdmin && isInternalNote ? "bg-amber-50 dark:bg-amber-950/30" : ""}`}>
              {isAdmin && (
                <div className="flex items-center gap-2 mb-2">
                  <Button
                    type="button"
                    size="sm"
                    variant={isInternalNote ? "default" : "outline"}
                    className={`h-7 px-2 text-xs gap-1 ${isInternalNote ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
                    onClick={() => setIsInternalNote((v) => !v)}
                    data-testid="button-toggle-internal-note"
                  >
                    <Lock className="w-3 h-3" />
                    {isInternalNote ? "Internal note (admins only)" : "Add internal note"}
                  </Button>
                  {isInternalNote && (
                    <span className="text-[10px] text-amber-700 dark:text-amber-400">Customer will not see this message.</span>
                  )}
                </div>
              )}
              {isAdmin && !isInternalNote && ((suggestions && suggestions.length > 0) || aiStatus?.enabled) && (
                <div className="flex flex-wrap items-center gap-1.5 mb-2" data-testid="row-suggestions">
                  {suggestions && suggestions.length > 0 && (
                    <span className="text-xs text-muted-foreground mr-1">Suggested:</span>
                  )}
                  <TooltipProvider delayDuration={300}>
                    {suggestions?.map((s) => (
                      <Tooltip key={s.id}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-7 px-2 text-xs rounded-full"
                            onClick={() => applySuggestion(s.message)}
                            data-testid={`chip-suggestion-${s.id}`}
                          >
                            {s.title}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">
                          {s.message}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                  {aiStatus?.enabled && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 px-2 text-xs rounded-full ml-auto"
                      onClick={() => aiDraftMutation.mutate()}
                      disabled={aiDraftMutation.isPending}
                      data-testid="button-ai-suggest"
                    >
                      {aiDraftMutation.isPending ? (
                        <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3 mr-1" />
                      )}
                      AI suggest
                    </Button>
                  )}
                </div>
              )}
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
              <div className="flex items-end gap-1.5 sm:gap-2">
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
                  className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10"
                  onClick={() => fileInputRef.current?.click()}
                  data-testid="button-attach-image"
                >
                  <Paperclip className="w-4 h-4" />
                </Button>
                {isAdmin && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon" variant="ghost" className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10" data-testid="button-quick-responses">
                        <Zap className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-h-60 overflow-y-auto w-56">
                      {quickResponses && quickResponses.length > 0 ? (
                        quickResponses.map((qr) => (
                          <DropdownMenuItem key={qr.id} onClick={() => setMessage(qr.message)} data-testid={`quick-response-${qr.id}`}>
                            {qr.title}
                          </DropdownMenuItem>
                        ))
                      ) : (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          No quick responses yet. Create them in Admin Portal &rarr; Quick Responses.
                        </div>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <Textarea
                  ref={messageInputRef}
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    if (e.target.value.trim()) sendTypingEvent();
                    const el = e.target;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 120) + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder={isAdmin && isInternalNote ? "Type an internal note (admins only)..." : "Type a message..."}
                  className="flex-1 min-h-[36px] max-h-[120px] resize-none text-sm py-2 leading-5"
                  rows={1}
                  data-testid="input-message"
                />
                <Button
                  type="button"
                  size="icon"
                  className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10"
                  disabled={!message.trim() && !imageFile}
                  onClick={handleSend}
                  data-testid="button-send-message"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

const BH_DISMISS_KEY = "sh-bh-banner-dismissed";

type BusinessHoursStatus = {
  enabled: boolean;
  isOpen: boolean;
  message: string;
  timezone: string;
  daysOfWeek: number[];
  startTime: string;
  endTime: string;
  nextOpenAt: string | null;
};

function formatBhNextOpen(iso: string | null, tz: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const safeTz = (() => {
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return tz; } catch { return "UTC"; }
  })();
  const dateInTz = formatInTimeZone(d, safeTz, "yyyy-MM-dd");
  const todayInTz = formatInTimeZone(new Date(), safeTz, "yyyy-MM-dd");
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowInTz = formatInTimeZone(tomorrow, safeTz, "yyyy-MM-dd");
  const time = formatInTimeZone(d, safeTz, "h:mm a");
  if (dateInTz === todayInTz) return `today at ${time}`;
  if (dateInTz === tomorrowInTz) return `tomorrow at ${time}`;
  return `${formatInTimeZone(d, safeTz, "EEEE")} at ${time}`;
}

function BusinessHoursBanner({ show }: { show: boolean }) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(BH_DISMISS_KEY) === "1";
    } catch {
      return false;
    }
  });

  const { data: bhStatus } = useQuery<BusinessHoursStatus>({
    queryKey: ["/api/business-hours/status"],
    enabled: show,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  if (!show || dismissed) return null;
  if (!bhStatus?.enabled || bhStatus.isOpen) return null;

  return (
    <div
      className="flex-shrink-0 mb-2 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 p-3"
      data-testid="banner-after-hours"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <div className="flex-1 min-w-0 text-xs text-amber-900 dark:text-amber-100">
          <p data-testid="text-banner-message">{bhStatus.message}</p>
          {bhStatus.nextOpenAt && (
            <p className="font-medium mt-0.5" data-testid="text-banner-next-open">
              We reopen {formatBhNextOpen(bhStatus.nextOpenAt, bhStatus.timezone)}.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 -mr-1 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/50 flex-shrink-0"
          onClick={() => {
            try { sessionStorage.setItem(BH_DISMISS_KEY, "1"); } catch {}
            setDismissed(true);
          }}
          data-testid="button-dismiss-after-hours-banner"
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
