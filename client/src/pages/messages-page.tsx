import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Mail, ArrowLeft, Send, Shield, User as UserIcon, Clock, ChevronDown, Inbox } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { useIsMobile } from "@/hooks/use-mobile";
import type { MessageThread, ThreadMessage, PrivateMessage } from "@shared/schema";

type EnrichedThread = MessageThread & {
  adminName: string;
  customerName: string;
  lastMessage: { body: string; senderId: string; createdAt: string } | null;
  unreadCount: number;
};

type EnrichedThreadMessage = ThreadMessage & { senderName?: string };

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
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const isNearBottomRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
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
  }, [threadId]);

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
        if (user?.id) {
          ws!.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
        }
      };

      ws.onmessage = (event) => {
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
        } catch {}
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) reconnectTimer = setTimeout(connect, 2000);
      };
      ws.onerror = () => ws?.close();
    }

    connect();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        markReadMutation.mutate();
        const current = wsRef.current;
        if (current && current.readyState === WebSocket.OPEN && user?.id) {
          current.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
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
      if (ws && ws.readyState === WebSocket.OPEN && user?.id) {
        ws.send(JSON.stringify({ type: "left_thread", threadId, userId: user.id }));
      }
      ws?.close();
      wsRef.current = null;
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
  }, [threadId, user?.id]);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    messagesEndRef.current?.scrollIntoView({ behavior });
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
    if (count > prevMessageCountRef.current && prevMessageCountRef.current > 0) {
      if (isNearBottomRef.current) scrollToBottom();
      else setShowNewMessagesPill(true);
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
    if (ws && ws.readyState === WebSocket.OPEN && user?.id && user?.fullName) {
      ws.send(JSON.stringify({ type: "thread_typing", threadId, userId: user.id, userName: user.fullName }));
    }
  };

  const sendMutation = useMutation({
    mutationFn: async (body: string) => {
      const res = await fetch(`/api/message-threads/${threadId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to send");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads", threadId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    },
    onError: () => toast({ title: "Failed to send message", variant: "destructive" }),
  });

  const handleSend = useCallback(() => {
    const msgText = message.trim();
    if (!msgText) return;
    setMessage("");
    sendMutation.mutate(msgText);
    if (isNearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }, 0);
  }, [message, sendMutation, scrollToBottom]);

  const otherName = isAdmin ? thread?.customerName : thread?.adminName;

  return (
    <div className="flex flex-col h-full" data-testid="thread-chat-view">
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
                      <p className="text-sm whitespace-pre-wrap break-words">{msg.body}</p>
                      <p className={`text-[10px] mt-0.5 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                        {format(msgDate, "h:mm a")}
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
        <div className="flex items-end gap-2">
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
            disabled={!message.trim() || sendMutation.isPending}
            data-testid="button-send-thread-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function MessagesPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();

  const { data: threads, isLoading } = useQuery<EnrichedThread[]>({
    queryKey: ["/api/message-threads"],
    refetchInterval: 15000,
  });

  const { data: legacyMessages } = useQuery<PrivateMessage[]>({
    queryKey: ["/api/private-messages"],
    enabled: !isAdmin,
  });

  if (params.id) {
    return (
      <div className="h-full flex flex-col">
        <ThreadChatView threadId={params.id} onBack={() => navigate("/messages")} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-messages-title">Messages</h1>
        <p className="text-sm text-muted-foreground mt-1">Conversations with the support team</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !threads || threads.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center py-8">
              <Mail className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-messages">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">When a team member sends you a message, it will appear here.</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.id}
              className={`cursor-pointer hover-elevate transition-colors ${t.unreadCount > 0 ? "border-primary/40 bg-primary/5" : ""}`}
              onClick={() => navigate(`/messages/${t.id}`)}
              data-testid={`card-thread-${t.id}`}
            >
              <CardContent className="flex items-center gap-3 p-3 sm:p-4">
                <Avatar className="w-9 h-9 flex-shrink-0">
                  <AvatarFallback className="text-xs">
                    {isAdmin ? (t.customerName?.[0] || "C") : (t.adminName?.[0] || "A")}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-sm font-medium truncate ${t.unreadCount > 0 ? "text-foreground" : "text-muted-foreground"}`} data-testid={`text-thread-subject-${t.id}`}>
                      {t.subject}
                    </p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {t.unreadCount > 0 && (
                        <Badge variant="destructive" className="text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid={`badge-thread-unread-${t.id}`}>
                          {t.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {isAdmin ? t.customerName : t.adminName}
                  </p>
                  {t.lastMessage && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {t.lastMessage.senderId === user?.id ? "You: " : ""}{t.lastMessage.body}
                    </p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-[10px] text-muted-foreground">
                    {t.lastMessage ? format(new Date(t.lastMessage.createdAt), "MMM d") : format(new Date(t.createdAt), "MMM d")}
                  </p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {legacyMessages && legacyMessages.length > 0 && (
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
    </div>
  );
}
