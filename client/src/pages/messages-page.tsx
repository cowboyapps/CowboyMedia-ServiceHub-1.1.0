import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { queryClient, apiRequest, uploadRequest } from "@/lib/queryClient";
import { QueryErrorState } from "@/components/query-error-state";
import { serverActionErrorMessage } from "@/lib/server-error";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowLeft, Send, Shield, User as UserIcon, Clock, ChevronDown, Inbox, Paperclip, X, Download, BookOpen, ChevronRight, MessageSquare, Trash2, Users } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import type { MessageThread, ThreadMessage, PrivateMessage, User } from "@shared/schema";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { LiveConnectionBanner } from "@/components/live-connection-banner";
import { ClickableImage } from "@/components/image-lightbox";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";

type EnrichedThread = MessageThread & {
  adminName: string;
  customerName: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
};

type EnrichedThreadMessage = ThreadMessage & { senderName?: string; kbArticle?: KbArticleRef | null };

// Receipt label for the sender's own messages: progresses Sent → Delivered → Read.
// `readAt` wins over `deliveredAt` because reading implies delivery.
export function messageReceiptLabel(msg: Pick<ThreadMessage, "deliveredAt" | "readAt">): "Sent" | "Delivered" | "Read" {
  if (msg.readAt) return "Read";
  if (msg.deliveredAt) return "Delivered";
  return "Sent";
}

const newThreadSchema = z.object({
  customerId: z.string().min(1, "Customer is required"),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional().default(""),
});

function getFileType(url: string): "image" | "video" | "other" {
  const ext = url.split(".").pop()?.toLowerCase() || "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext)) return "image";
  if (["mp4", "webm", "mov", "avi", "mkv", "m4v"].includes(ext)) return "video";
  return "other";
}

function getFileName(url: string): string {
  return url.split("/").pop() || "file";
}

function ThreadFileAttachment({ url, isMe }: { url: string; isMe: boolean }) {
  const type = getFileType(url);
  if (type === "image") {
    return (
      <div className="mt-2">
        <ClickableImage src={url} alt="Attachment" className="max-w-full h-32 object-cover rounded-md" />
        <a href={url} download target="_blank" rel="noopener noreferrer" className={`mt-1 flex items-center gap-1 text-xs hover:underline ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`} data-testid="link-download-thread-image">
          <Download className="w-3 h-3" />
          <span>Download</span>
        </a>
      </div>
    );
  }
  if (type === "video") {
    return (
      <div className="mt-2">
        <video src={url} controls className="max-w-full h-40 rounded-md" />
      </div>
    );
  }
  return (
    <a href={url} download target="_blank" rel="noopener noreferrer" className={`mt-2 flex items-center gap-1.5 text-xs underline ${isMe ? "text-primary-foreground/80" : "text-foreground"}`} data-testid="link-download-thread-file">
      <Download className="w-3.5 h-3.5" />
      <span className="truncate">{getFileName(url)}</span>
    </a>
  );
}

function ThreadKbCard({ article, isMe }: { article: KbArticleRef; isMe: boolean }) {
  return (
    <Link href={`/knowledge/${article.slug}`}>
      <div
        className={`mt-2 flex items-start gap-2 p-2 rounded-md border cursor-pointer hover-elevate tap-interactive ${isMe ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/60"}`}
        data-testid="kb-card-thread-msg"
      >
        <BookOpen className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate">{article.title}</p>
          {article.categoryName && <p className="text-[10px] opacity-80 mt-0.5">{article.categoryName}</p>}
          {article.summary && <p className="text-[11px] opacity-80 mt-1 line-clamp-2">{article.summary}</p>}
        </div>
        <ChevronRight className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
      </div>
    </Link>
  );
}

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="bouncing-dots-thread">
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

function ThreadChatView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [kbArticle, setKbArticle] = useState<KbArticleRef | null>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const isNearBottomRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const prevMessageCountRef = useRef(0);

  const { data: thread } = useQuery<EnrichedThread & { adminName: string; customerName: string }>({
    queryKey: ["/api/message-threads", threadId],
  });

  const { data: messages, isLoading: messagesLoading } = useQuery<EnrichedThreadMessage[]>({
    queryKey: ["/api/message-threads", threadId, "messages"],
    refetchInterval: 5000,
  });

  const markReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/message-threads/${threadId}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  useEffect(() => {
    markReadMutation.mutate();
  // Keep: mutation object identity is unstable, but `.mutate` is stable. We want
  // this to fire once per thread open, not on every render the mutation re-creates.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    wsRef,
    deps: [threadId, user?.id],
    onOpen: (ws) => {
      if (user?.id) {
        ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
      }
    },
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "thread_message" && data.threadId === threadId) {
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
          setTypingUser(null);
          markReadMutation.mutate();
        }
        if (data.type === "thread_typing" && data.threadId === threadId && data.userId !== user?.id) {
          setTypingUser(data.userName);
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
        }
        if (data.type === "thread_messages_read" && data.threadId === threadId && data.readBy !== user?.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
        }
        if (data.type === "thread_messages_delivered" && data.threadId === threadId && data.deliveredTo !== user?.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
        }
      } catch {}
    },
    onVisible: (ws) => {
      markReadMutation.mutate();
      if (user?.id) {
        ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
      }
    },
    onBeforeUnmount: (ws) => {
      if (user?.id) {
        ws.send(JSON.stringify({ type: "left_thread", threadId, userId: user.id }));
      }
    },
  });

  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollContainerRef.current;
    if (el) {
      if (typeof el.scrollTo === "function") {
        el.scrollTo({ top: el.scrollHeight, behavior });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior });
    }
    setShowNewMessagesPill(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setShowNewMessagesPill(false);
  }, []);

  useEffect(() => {
    const count = messages?.length || 0;
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = count;
    if (count > prev && prev > 0) {
      if (isNearBottomRef.current) scrollToBottom();
      else setShowNewMessagesPill(true);
    } else if (count > 0 && prev === 0) {
      // First load: content may still be sizing, so one synchronous scroll lands
      // short. Re-pin across the next few frames to settle at the true bottom.
      scrollToBottom("auto");
      const raf = requestAnimationFrame(() => scrollToBottom("auto"));
      const t1 = setTimeout(() => scrollToBottom("auto"), 120);
      const t2 = setTimeout(() => scrollToBottom("auto"), 350);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
  }, [messages, scrollToBottom]);

  const sendTypingEvent = () => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && user?.id && user?.fullName) {
      ws.send(JSON.stringify({ type: "thread_typing", threadId, userId: user.id, userName: user.fullName }));
    }
  };

  const sendMutation = useMutation({
    mutationFn: async ({ body, file, kbSlug }: { body: string; file: File | null; kbSlug: string | null }) => {
      const formData = new FormData();
      formData.append("body", body);
      if (file) formData.append("image", file);
      if (kbSlug) formData.append("kbArticleSlug", kbSlug);
      const res = await uploadRequest("POST", `/api/message-threads/${threadId}/messages`, formData);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    },
    onError: (e: Error) => toast({ title: "Failed to send message", description: serverActionErrorMessage(e, "Couldn't send your message. Please try again."), variant: "destructive" }),
  });

  const handleSend = useCallback(() => {
    const msgText = message.trim();
    const file = imageFile;
    const kbSlug = isAdmin ? (kbArticle?.slug ?? null) : null;
    if (!msgText && !file && !kbSlug) return;
    setMessage("");
    setImageFile(null);
    setKbArticle(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    sendMutation.mutate({ body: msgText, file, kbSlug });
    if (isNearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }, 0);
  }, [message, imageFile, kbArticle, isAdmin, sendMutation, scrollToBottom]);

  const otherName = isAdmin ? thread?.customerName : thread?.adminName;

  // Keep the composer pinned above the iOS on-screen keyboard: pad the view by
  // the keyboard height so the content shrinks instead of the page scrolling.
  const keyboardInset = useKeyboardInset();
  useEffect(() => {
    if (keyboardInset > 0 && isNearBottomRef.current) {
      const t = setTimeout(() => scrollToBottom("auto"), 50);
      return () => clearTimeout(t);
    }
  }, [keyboardInset, scrollToBottom]);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        overscrollBehavior: "none",
        paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined,
        transition: "padding-bottom 150ms ease-out",
      }}
      data-testid="thread-chat-view"
    >
      <div className="flex items-center gap-2 p-2 sm:p-3 border-b flex-shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" onClick={onBack} data-testid="button-thread-back">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" data-testid="text-thread-subject">{thread?.subject || "Loading..."}</p>
          <div className="flex items-center gap-1">
            {isAdmin ? <UserIcon className="w-3 h-3 text-muted-foreground" /> : <Shield className="w-3 h-3 text-muted-foreground" />}
            <p className="text-xs text-muted-foreground truncate">{otherName || ""}</p>
          </div>
        </div>
      </div>

      <LiveConnectionBanner status={wsStatus} className="mx-2 sm:mx-3 mt-2" />

      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1 min-h-0">
        {messagesLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-3/4" />)}
          </div>
        ) : (
          <>
            {(messages || []).map((msg, idx) => {
              const isMe = msg.senderId === user?.id;
              const msgDate = new Date(msg.createdAt);
              const prevDate = idx > 0 ? new Date((messages || [])[idx - 1].createdAt) : null;
              const showSeparator = !prevDate || formatDateSeparator(msgDate) !== formatDateSeparator(prevDate);

              return (
                <div key={msg.id}>
                  {showSeparator && (
                    <div className="flex items-center justify-center my-3">
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{formatDateSeparator(msgDate)}</span>
                    </div>
                  )}
                  <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}>
                    <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3 py-2 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                      {!isMe && <p className="text-[10px] font-medium mb-0.5 opacity-70">{msg.senderName}</p>}
                      {msg.body && <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>}
                      {msg.imageUrl && <ThreadFileAttachment url={msg.imageUrl} isMe={isMe} />}
                      {msg.kbArticle && <ThreadKbCard article={msg.kbArticle} isMe={isMe} />}
                      <p className={`text-[10px] mt-0.5 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                        {format(msgDate, "h:mm a")}
                        {isMe && (
                          <span className="ml-1.5" data-testid={`status-receipt-${msg.id}`}>
                            · {messageReceiptLabel(msg)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {showNewMessagesPill && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
          <Button size="sm" variant="secondary" className="rounded-full shadow-lg text-xs gap-1 px-3" onClick={() => scrollToBottom()} data-testid="button-new-messages-pill">
            <ChevronDown className="w-3 h-3" /> New messages
          </Button>
        </div>
      )}

      <div className="border-t p-2 sm:p-3 flex-shrink-0">
        {typingUser && (
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <span className="text-xs text-muted-foreground">{typingUser}</span>
            <BouncingDots />
          </div>
        )}
        {imageFile && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-accent rounded-md" data-testid="chip-thread-image">
            <Paperclip className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs truncate flex-1">{imageFile.name}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setImageFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} data-testid="button-remove-thread-image">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
        {isAdmin && kbArticle && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-accent rounded-md" data-testid="chip-thread-kb">
            <BookOpen className="w-4 h-4 flex-shrink-0" />
            <span className="text-xs truncate flex-1">{kbArticle.title}</span>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setKbArticle(null)} data-testid="button-remove-thread-kb">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => setImageFile(e.target.files?.[0] || null)}
            data-testid="input-thread-file"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="flex-shrink-0 h-9 w-9"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-attach-thread-image"
            title="Attach a photo"
          >
            <Paperclip className="w-4 h-4" />
          </Button>
          {isAdmin && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="flex-shrink-0 h-9 w-9"
              onClick={() => setKbPickerOpen(true)}
              data-testid="button-attach-thread-kb"
              title="Link a knowledge base article"
            >
              <BookOpen className="w-4 h-4" />
            </Button>
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
            onCompositionEnd={(e) => {
              if (message.trim()) sendTypingEvent();
            }}
            placeholder="Type a message..."
            className="flex-1 min-h-[36px] max-h-[120px] resize-none text-sm"
            rows={1}
            data-testid="input-thread-message"
          />
          <Button
            size="icon"
            className="flex-shrink-0 h-9 w-9"
            onClick={handleSend}
            disabled={(!message.trim() && !imageFile && !(isAdmin && kbArticle)) || sendMutation.isPending}
            data-testid="button-send-thread-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {isAdmin && (
        <KbArticlePickerDialog open={kbPickerOpen} onOpenChange={setKbPickerOpen} onSelect={(a) => { setKbArticle(a); setKbPickerOpen(false); }} />
      )}
    </div>
  );
}

function NewConversationDialog() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [, navigate] = useLocation();
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [kbArticle, setKbArticle] = useState<KbArticleRef | null>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: users } = useQuery<User[]>({ queryKey: ["/api/admin/users"], enabled: open });
  const customers = users?.filter((u) => u.role === "customer") || [];

  const form = useForm({
    resolver: zodResolver(newThreadSchema),
    defaultValues: { customerId: "", subject: "", body: "" },
  });

  const createMutation = useMutation({
    mutationFn: async (data: z.infer<typeof newThreadSchema>) => {
      const fd = new FormData();
      fd.append("customerId", data.customerId);
      fd.append("subject", data.subject);
      fd.append("body", data.body ?? "");
      if (imageFile) fd.append("image", imageFile);
      if (kbArticle) fd.append("kbArticleSlug", kbArticle.slug);
      const res = await uploadRequest("POST", "/api/message-threads", fd);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
      return res.json();
    },
    onSuccess: (data) => {
      setOpen(false);
      form.reset();
      setImageFile(null);
      setKbArticle(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      toast({ title: "Conversation started" });
      if (data.thread?.id) navigate(`/messages/${data.thread.id}`);
    },
    onError: (e: Error) => toast({ title: "Error", description: serverActionErrorMessage(e, "Couldn't start the conversation. Please try again."), variant: "destructive" }),
  });

  const handleCreateSubmit = (d: z.infer<typeof newThreadSchema>) => {
    if (!(d.body ?? "").trim() && !imageFile && !kbArticle) {
      toast({ title: "Add a message, photo, or article", variant: "destructive" });
      return;
    }
    createMutation.mutate(d);
  };

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      form.reset();
      setImageFile(null);
      setKbArticle(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm" data-testid="button-new-conversation"><MessageSquare className="w-4 h-4 mr-1" /> New Conversation</Button>
      </DialogTrigger>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader><DialogTitle>Start Conversation</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleCreateSubmit)} className="space-y-3">
            <FormField control={form.control} name="customerId" render={({ field }) => (
              <FormItem><FormLabel>Customer</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger data-testid="select-thread-customer"><SelectValue placeholder="Select a customer" /></SelectTrigger></FormControl>
                  <SelectContent>
                    {customers.map((u) => (
                      <SelectItem key={u.id} value={u.id}>{u.fullName} (@{u.username})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              <FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="subject" render={({ field }) => (
              <FormItem><FormLabel>Subject</FormLabel><FormControl><Input data-testid="input-thread-subject" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="body" render={({ field }) => (
              <FormItem><FormLabel>First Message</FormLabel><FormControl><Textarea className="min-h-[100px]" data-testid="input-thread-body" {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            {imageFile && (
              <div className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs w-fit" data-testid="chip-new-thread-image">
                <Paperclip className="w-3.5 h-3.5" />
                <span className="truncate max-w-[200px]">{imageFile.name}</span>
                <button type="button" onClick={() => { setImageFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} data-testid="button-new-thread-remove-image"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            {kbArticle && (
              <div className="flex items-center gap-1.5 bg-muted rounded-md px-2 py-1 text-xs w-fit" data-testid="chip-new-thread-kb">
                <BookOpen className="w-3.5 h-3.5" />
                <span className="truncate max-w-[200px]">{kbArticle.title}</span>
                <button type="button" onClick={() => setKbArticle(null)} data-testid="button-new-thread-remove-kb"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) setImageFile(f); }}
              data-testid="input-new-thread-file"
            />
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} data-testid="button-new-thread-attach-image">
                <Paperclip className="w-4 h-4 mr-1" /> Photo
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setKbPickerOpen(true)} data-testid="button-new-thread-attach-kb">
                <BookOpen className="w-4 h-4 mr-1" /> Article
              </Button>
            </div>
            <Button type="submit" className="w-full" disabled={createMutation.isPending} data-testid="button-start-conversation">
              {createMutation.isPending ? "Starting..." : "Start Conversation"}
            </Button>
          </form>
        </Form>
        <KbArticlePickerDialog open={kbPickerOpen} onOpenChange={setKbPickerOpen} onSelect={(a) => { setKbArticle(a); setKbPickerOpen(false); }} />
      </DialogContent>
    </Dialog>
  );
}

function ThreadCard({ thread, isAdmin, currentUserId, onOpen, onDelete, canManage }: {
  thread: EnrichedThread;
  isAdmin: boolean;
  currentUserId?: string;
  onOpen: () => void;
  onDelete?: () => void;
  canManage: boolean;
}) {
  return (
    <Card
      className={`cursor-pointer hover-elevate transition-colors ${thread.unreadCount > 0 ? "border-primary/40 bg-primary/5" : ""}`}
      onClick={onOpen}
      data-testid={`card-thread-${thread.id}`}
    >
      <CardContent className="flex items-center gap-3 p-3 sm:p-4">
        {!isAdmin && (
          <Avatar className="w-9 h-9 flex-shrink-0">
            <AvatarFallback className="text-xs">{thread.adminName?.[0] || "A"}</AvatarFallback>
          </Avatar>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <p className={`text-sm font-medium truncate ${thread.unreadCount > 0 ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-thread-subject-${thread.id}`}>
              {thread.subject}
            </p>
            {thread.unreadCount > 0 && (
              <Badge variant="destructive" className="text-[10px] h-5 min-w-5 flex items-center justify-center px-1 flex-shrink-0" data-testid={`badge-thread-unread-${thread.id}`}>
                {thread.unreadCount}
              </Badge>
            )}
          </div>
          {!isAdmin && <p className="text-xs text-muted-foreground truncate">{thread.adminName}</p>}
          {thread.lastMessage && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {thread.lastMessage.senderId === currentUserId ? "You: " : ""}{thread.lastMessage.body}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[10px] text-muted-foreground">
            {thread.lastMessage ? format(new Date(thread.lastMessage.createdAt), "MMM d") : format(new Date(thread.createdAt), "MMM d")}
          </span>
          {isAdmin && canManage && onDelete && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={(e) => e.stopPropagation()} data-testid={`button-delete-thread-${thread.id}`}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent className="w-[calc(100vw-2rem)] sm:max-w-sm" onClick={(e) => e.stopPropagation()}>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete Conversation</AlertDialogTitle>
                  <AlertDialogDescription>Delete this entire conversation and all messages? This cannot be undone.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={onDelete} data-testid="button-confirm-delete-thread">Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MessagesPage() {
  const { user, isAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const canManage = isAdmin && hasPermission("messages.manage");

  const { data: threads, isLoading, isError, error, refetch, isFetching } = useQuery<EnrichedThread[]>({
    queryKey: ["/api/message-threads"],
    refetchInterval: 15000,
  });

  const { data: legacyMessages } = useQuery<PrivateMessage[]>({
    queryKey: ["/api/private-messages"],
    enabled: !isAdmin,
  });

  const { data: sentMessages } = useQuery<PrivateMessage[]>({
    queryKey: ["/api/admin/private-messages/sent"],
    enabled: isAdmin && hasPermission("messages.view"),
  });

  const { data: adminUsers } = useQuery<User[]>({
    queryKey: ["/api/admin/users"],
    enabled: isAdmin,
  });
  const userMap = new Map(adminUsers?.map((u) => [u.id, u.fullName]) || []);

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/message-threads/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).message || "Failed");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      toast({ title: "Conversation deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: serverActionErrorMessage(e, "Couldn't delete the conversation. Please try again."), variant: "destructive" }),
  });

  if (params.id) {
    return (
      <div className="h-full flex flex-col">
        <ThreadChatView threadId={params.id} onBack={() => navigate("/messages")} />
      </div>
    );
  }

  const renderThreadList = () => {
    if (isLoading) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      );
    }
    if (isError) {
      return (
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          isRetrying={isFetching}
          resourceName="your messages"
          data-testid="error-messages"
        />
      );
    }
    if (!threads || threads.length === 0) {
      return (
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-8">
              <Mail className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-messages">
                {isAdmin ? "No conversations yet." : "No messages yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isAdmin ? "Start one using the New Conversation button." : "When a team member sends you a message, it will appear here."}
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }

    if (isAdmin) {
      const grouped = new Map<string, EnrichedThread[]>();
      threads.forEach((t) => {
        if (!grouped.has(t.customerId)) grouped.set(t.customerId, []);
        grouped.get(t.customerId)!.push(t);
      });
      const groups = Array.from(grouped.entries()).sort((a, b) => {
        const aLatest = Math.max(...a[1].map(t => new Date(t.lastMessageAt).getTime()));
        const bLatest = Math.max(...b[1].map(t => new Date(t.lastMessageAt).getTime()));
        return bLatest - aLatest;
      });
      return (
        <div className="space-y-4">
          {groups.map(([customerId, customerThreads]) => (
            <div key={customerId}>
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <h4 className="text-sm font-medium">{customerThreads[0].customerName}</h4>
                <Badge variant="outline" className="text-[10px]">{customerThreads.length}</Badge>
              </div>
              <div className="space-y-2 ml-6">
                {customerThreads.map((t) => (
                  <ThreadCard
                    key={t.id}
                    thread={t}
                    isAdmin
                    currentUserId={user?.id}
                    canManage={canManage}
                    onOpen={() => navigate(`/messages/${t.id}`)}
                    onDelete={() => deleteMutation.mutate(t.id)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      );
    }

    return (
      <div className="space-y-2">
        {threads.map((t) => (
          <ThreadCard
            key={t.id}
            thread={t}
            isAdmin={false}
            currentUserId={user?.id}
            canManage={false}
            onOpen={() => navigate(`/messages/${t.id}`)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight" data-testid="text-messages-title">Messages</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAdmin ? "Conversations with customers" : "Conversations with the support team"}
          </p>
        </div>
        {canManage && <NewConversationDialog />}
      </div>

      {renderThreadList()}

      {!isAdmin && legacyMessages && legacyMessages.length > 0 && (
        <div className="space-y-3 mt-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Previous Messages
          </h2>
          <p className="text-xs text-muted-foreground">One-way messages received before the conversation system.</p>
          {legacyMessages.map((msg) => (
            <Card key={msg.id} data-testid={`card-legacy-message-${msg.id}`}>
              <CardContent className="p-3 sm:p-4 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className={`text-sm font-medium truncate ${!msg.readAt ? "text-foreground" : "text-muted-foreground"}`}>{msg.subject}</p>
                  {!msg.readAt && <Badge variant="destructive" className="text-[10px] h-5">New</Badge>}
                </div>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{msg.body}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(new Date(msg.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {isAdmin && sentMessages && sentMessages.length > 0 && (
        <div className="space-y-3 mt-6">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Inbox className="w-5 h-5" /> Legacy Sent Messages ({sentMessages.length})
          </h2>
          <p className="text-xs text-muted-foreground">One-way messages sent before the conversation system.</p>
          {sentMessages.map((msg) => (
            <Card key={msg.id} data-testid={`card-legacy-sent-${msg.id}`}>
              <CardContent className="p-3 sm:p-4 space-y-1">
                <p className="text-sm font-medium truncate">{msg.subject}</p>
                <p className="text-xs text-muted-foreground">To: {userMap.get(msg.recipientId) || "Unknown"}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">{msg.body}</p>
                <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {format(new Date(msg.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
