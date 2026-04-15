import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Send, Shield, ChevronDown, Smile, Trash2, Users, Settings, Bell, BellOff, AtSign } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import type { CommunityMessage } from "@shared/schema";

type ReactionGroup = { emoji: string; userIds: string[] };
type EnrichedMessage = CommunityMessage & { reactions: ReactionGroup[]; isAdmin?: boolean };

const EMOJI_OPTIONS = ["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👎"];

function BouncingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" data-testid="bouncing-dots-community">
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

function UsernameSetupDialog({ open, onComplete }: { open: boolean; onComplete: (username: string, notifPref: string) => void }) {
  const [username, setUsername] = useState("");
  const [notifPref, setNotifPref] = useState("mentions");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const checkAvailability = useCallback(async (name: string) => {
    if (name.length < 2) return;
    setChecking(true);
    try {
      const res = await fetch(`/api/community-chat/username-available?username=${encodeURIComponent(name)}`, { credentials: "include" });
      const data = await res.json();
      if (!data.available) setError("Username already taken");
      else setError("");
    } catch {
      setError("Could not check availability");
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (username.trim().length >= 2) checkAvailability(username.trim());
    }, 500);
    return () => clearTimeout(timer);
  }, [username, checkAvailability]);

  const handleSubmit = async () => {
    const cleaned = username.trim();
    if (cleaned.length < 2 || cleaned.length > 20) {
      setError("Username must be 2-20 characters");
      return;
    }
    if (!/^[a-zA-Z0-9_\-]+$/.test(cleaned)) {
      setError("Only letters, numbers, underscores, and hyphens allowed");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/community-chat/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatUsername: cleaned, chatNotifications: notifPref }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save");
        return;
      }
      onComplete(cleaned, notifPref);
    } catch {
      setError("Failed to save username");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle data-testid="text-username-dialog-title">Set Up Community Chat</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="chat-username">Anonymous Username</Label>
            <p className="text-xs text-muted-foreground">This is how others will see you in the chat.</p>
            <Input
              id="chat-username"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                setError("");
              }}
              placeholder="e.g. CoolRider42"
              maxLength={20}
              data-testid="input-chat-username"
            />
            {error && <p className="text-xs text-destructive" data-testid="text-username-error">{error}</p>}
            {checking && <p className="text-xs text-muted-foreground">Checking availability...</p>}
            <p className="text-[11px] text-muted-foreground">2-20 characters. Letters, numbers, underscores, hyphens only.</p>
          </div>

          <div className="space-y-2">
            <Label>Push Notifications</Label>
            <p className="text-xs text-muted-foreground">Choose when to receive push notifications for chat messages. Admins can always reach everyone with @everyone.</p>
            <RadioGroup value={notifPref} onValueChange={setNotifPref} className="space-y-1.5">
              <label className="flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors" data-testid="radio-notif-all">
                <RadioGroupItem value="all" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm font-medium">All messages</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Get notified for every new chat message</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors" data-testid="radio-notif-mentions">
                <RadioGroupItem value="mentions" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <AtSign className="w-3.5 h-3.5 text-primary" />
                    <span className="text-sm font-medium">Mentions only</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Only when someone tags you with @username</p>
                </div>
              </label>
              <label className="flex items-start gap-3 p-2.5 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors" data-testid="radio-notif-none">
                <RadioGroupItem value="none" className="mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <BellOff className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-sm font-medium">None</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">No notifications (except admin @everyone)</p>
                </div>
              </label>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={handleSubmit} disabled={saving || checking || !!error || username.trim().length < 2} data-testid="button-save-username">
            {saving ? "Saving..." : "Start Chatting"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function NotificationSettingsPopover({ currentPref, onUpdate }: { currentPref: string; onUpdate: (pref: string) => void }) {
  const [pref, setPref] = useState(currentPref);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => { setPref(currentPref); }, [currentPref]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/community-chat/username", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatNotifications: pref }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      onUpdate(pref);
      setOpen(false);
      toast({ title: "Notification preference updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/user"] });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const prefIcon = pref === "all" ? <Bell className="w-3.5 h-3.5" /> : pref === "mentions" ? <AtSign className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="p-1.5 rounded-md hover:bg-muted transition-colors text-muted-foreground" data-testid="button-chat-settings">
          <Settings className="w-4 h-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3" data-testid="popover-chat-settings">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium">Chat Notifications</p>
            <p className="text-[11px] text-muted-foreground">Admin @everyone always reaches you.</p>
          </div>
          <RadioGroup value={pref} onValueChange={setPref} className="space-y-1">
            <label className="flex items-center gap-2.5 p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors" data-testid="settings-radio-all">
              <RadioGroupItem value="all" />
              <Bell className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-sm">All messages</span>
            </label>
            <label className="flex items-center gap-2.5 p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors" data-testid="settings-radio-mentions">
              <RadioGroupItem value="mentions" />
              <AtSign className="w-3.5 h-3.5 text-primary flex-shrink-0" />
              <span className="text-sm">Mentions only</span>
            </label>
            <label className="flex items-center gap-2.5 p-2 rounded-md cursor-pointer hover:bg-muted/50 transition-colors" data-testid="settings-radio-none">
              <RadioGroupItem value="none" />
              <BellOff className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-sm">None</span>
            </label>
          </RadioGroup>
          <Button size="sm" className="w-full" onClick={handleSave} disabled={saving || pref === currentPref} data-testid="button-save-notif-pref">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function EmojiPicker({ onSelect, onClose, alignRight }: { onSelect: (emoji: string) => void; onClose: () => void; alignRight?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className={`absolute bottom-full mb-1 ${alignRight ? "right-0" : "left-0"} bg-popover border rounded-lg shadow-lg p-1 grid grid-cols-4 gap-0.5 z-50 w-[144px]`} data-testid="emoji-picker">
      {EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="w-8 h-8 flex items-center justify-center rounded hover:bg-muted transition-colors text-base"
          data-testid={`button-emoji-${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function ReactionBadges({ reactions, userId, onToggle }: { reactions: ReactionGroup[]; userId: string; onToggle: (emoji: string) => void }) {
  if (reactions.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {reactions.map((r) => {
        const isMine = r.userIds.includes(userId);
        return (
          <button
            key={r.emoji}
            onClick={() => onToggle(r.emoji)}
            className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${isMine ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted border-border hover:bg-muted/80"}`}
            data-testid={`reaction-badge-${r.emoji}`}
          >
            <span>{r.emoji}</span>
            <span className="text-[10px] font-medium">{r.userIds.length}</span>
          </button>
        );
      })}
    </div>
  );
}

type Participant = { username: string; isAdmin: boolean };

function MentionAutocomplete({
  query,
  participants,
  isAdmin,
  onSelect,
  selectedIndex,
}: {
  query: string;
  participants: Participant[];
  isAdmin: boolean;
  onSelect: (username: string) => void;
  selectedIndex: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.toLowerCase();

  const filtered = useMemo(() => {
    const items: Participant[] = [];
    if (isAdmin && "everyone".startsWith(q)) {
      items.push({ username: "everyone", isAdmin: true });
    }
    for (const p of participants) {
      if (p.username.toLowerCase().startsWith(q)) {
        items.push(p);
      }
    }
    if (items.length === 0) {
      for (const p of participants) {
        if (p.username.toLowerCase().includes(q) && !items.some(i => i.username === p.username)) {
          items.push(p);
        }
      }
    }
    return items.slice(0, 8);
  }, [q, participants, isAdmin]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement;
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (filtered.length === 0) return null;

  return (
    <div ref={listRef} className="absolute bottom-full mb-1 left-0 right-0 bg-popover border rounded-lg shadow-lg overflow-y-auto max-h-48 z-50" data-testid="mention-autocomplete">
      {filtered.map((p, i) => (
        <button
          key={p.username}
          onMouseDown={(e) => { e.preventDefault(); onSelect(p.username); }}
          className={`w-full text-left px-3 py-2 flex items-center gap-2 text-sm transition-colors ${i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          data-testid={`mention-option-${p.username}`}
        >
          {p.username === "everyone" ? (
            <Users className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          ) : p.isAdmin ? (
            <Shield className="w-3.5 h-3.5 text-primary flex-shrink-0" />
          ) : (
            <AtSign className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="truncate">{p.username === "everyone" ? "@everyone" : p.username}</span>
          {p.username === "everyone" && (
            <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">notify all</span>
          )}
          {p.isAdmin && p.username !== "everyone" && (
            <span className="text-[10px] text-muted-foreground ml-auto flex-shrink-0">admin</span>
          )}
        </button>
      ))}
    </div>
  );
}

export default function CommunityChatPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [chatNotifPref, setChatNotifPref] = useState("mentions");
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionStartRef = useRef<number | null>(null);
  const isNearBottomRef = useRef(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const lastTypingSentRef = useRef<number>(0);
  const prevMessageCountRef = useRef(0);
  const typingTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    if (!user) return;
    const isAdminUser = user.role === "admin" || user.role === "master_admin";
    if (isAdminUser) {
      setChatUsername(user.fullName);
    } else if (user.chatUsername) {
      setChatUsername(user.chatUsername);
    } else {
      setShowUsernameDialog(true);
    }
    setChatNotifPref(user.chatNotifications || "mentions");
  }, [user]);

  const { data: messages, isLoading } = useQuery<EnrichedMessage[]>({
    queryKey: ["/api/community-chat/messages"],
    refetchInterval: 30000,
  });

  const { data: participants } = useQuery<Participant[]>({
    queryKey: ["/api/community-chat/participants"],
    staleTime: 60000,
  });

  const detectMention = useCallback((text: string, cursorPos: number) => {
    const before = text.slice(0, cursorPos);
    const match = before.match(/@([^\s@]*)$/);
    if (match) {
      mentionStartRef.current = cursorPos - match[1].length;
      setMentionQuery(match[1]);
      setMentionIndex(0);
    } else {
      mentionStartRef.current = null;
      setMentionQuery(null);
    }
  }, []);

  const insertMention = useCallback((username: string) => {
    const el = messageInputRef.current;
    if (!el || mentionStartRef.current === null) return;
    const start = mentionStartRef.current - 1;
    const before = message.slice(0, start);
    const after = message.slice(el.selectionStart);
    const newMsg = `${before}@${username} ${after}`;
    setMessage(newMsg);
    setMentionQuery(null);
    mentionStartRef.current = null;
    setTimeout(() => {
      const pos = start + username.length + 2;
      el.setSelectionRange(pos, pos);
      el.focus();
    }, 0);
  }, [message]);

  useEffect(() => {
    let disposed = false;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "community_message") {
            queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
          }
          if (data.type === "community_message_deleted") {
            queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
          }
          if (data.type === "community_reaction") {
            queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
          }
          if (data.type === "community_typing" && data.userId !== user?.id) {
            setTypingUsers((prev) => {
              const next = new Map(prev);
              next.set(data.userId, data.chatUsername);
              return next;
            });
            const existing = typingTimeoutsRef.current.get(data.userId);
            if (existing) clearTimeout(existing);
            typingTimeoutsRef.current.set(data.userId, setTimeout(() => {
              setTypingUsers((prev) => {
                const next = new Map(prev);
                next.delete(data.userId);
                return next;
              });
            }, 3000));
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

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
      typingTimeoutsRef.current.forEach((t) => clearTimeout(t));
    };
  }, [user?.id]);

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

  const sendTypingEvent = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 2000) return;
    lastTypingSentRef.current = now;
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && chatUsername) {
      ws.send(JSON.stringify({ type: "community_typing", chatUsername }));
    }
  }, [chatUsername]);

  const handleSend = useCallback(async () => {
    const content = message.trim();
    if (!content) return;
    setMessage("");
    setMentionQuery(null);
    mentionStartRef.current = null;
    try {
      const res = await fetch("/api/community-chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: "Failed to send", description: data.error, variant: "destructive" });
        setMessage(content);
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
      if (isNearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
    } catch {
      toast({ title: "Failed to send message", variant: "destructive" });
      setMessage(content);
    }
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }, 0);
  }, [message, scrollToBottom, toast]);

  const handleReaction = useCallback(async (messageId: string, emoji: string) => {
    try {
      await fetch(`/api/community-chat/messages/${messageId}/reactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
        credentials: "include",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
    } catch {
      toast({ title: "Failed to react", variant: "destructive" });
    }
  }, [toast]);

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    try {
      const res = await fetch(`/api/community-chat/messages/${messageId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
      toast({ title: "Message deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }, [toast]);

  const handleUsernameComplete = useCallback((newUsername: string, notifPref: string) => {
    setChatUsername(newUsername);
    setChatNotifPref(notifPref);
    setShowUsernameDialog(false);
    queryClient.invalidateQueries({ queryKey: ["/api/user"] });
  }, []);

  const typingNames = useMemo(() => Array.from(typingUsers.values()), [typingUsers]);

  const isAdminUser = user?.role === "admin" || user?.role === "master_admin";

  return (
    <div className="flex flex-col h-full" data-testid="community-chat-page">
      <div className="flex items-center gap-2 p-2 sm:p-3 border-b flex-shrink-0">
        <Users className="w-5 h-5 text-primary flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <h1 className="text-sm font-semibold" data-testid="text-community-title">Community Chat</h1>
          <p className="text-[10px] text-muted-foreground">
            Chatting as <span className="font-medium">{chatUsername || "..."}</span>
            {isAdminUser && <Shield className="w-3 h-3 inline ml-1 text-primary" />}
          </p>
        </div>
        <NotificationSettingsPopover currentPref={chatNotifPref} onUpdate={setChatNotifPref} />
      </div>

      <div ref={scrollContainerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden p-2 sm:p-3 space-y-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-3/4" />)}
          </div>
        ) : !messages || messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Users className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-community-messages">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">Be the first to say something!</p>
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const isMe = msg.userId === user?.id;
              const msgDate = new Date(msg.createdAt);
              const prevDate = idx > 0 ? new Date(messages[idx - 1].createdAt) : null;
              const showSeparator = !prevDate || formatDateSeparator(msgDate) !== formatDateSeparator(prevDate);
              const msgIsAdmin = msg.isAdmin || false;

              return (
                <div key={msg.id} data-testid={`community-message-${msg.id}`}>
                  {showSeparator && (
                    <div className="flex items-center justify-center my-3">
                      <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{formatDateSeparator(msgDate)}</span>
                    </div>
                  )}
                  <div className={`flex ${isMe ? "justify-end" : "justify-start"} mb-1`}>
                    <div className="relative max-w-[85%] sm:max-w-[70%] min-w-0">
                      <div className={`rounded-2xl px-3 py-2 ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <p className={`text-[10px] font-medium mb-0.5 flex items-center gap-1 ${isMe ? "text-primary-foreground/70" : msgIsAdmin ? "text-primary" : "opacity-70"}`}>
                          <span className="truncate">{msg.chatUsername}</span>
                          {msgIsAdmin && <Shield className="w-2.5 h-2.5 flex-shrink-0" />}
                        </p>
                        <p className="text-sm whitespace-pre-wrap break-words overflow-hidden" data-testid={`text-community-msg-${msg.id}`}>{msg.content}</p>
                        <div className={`flex items-center gap-1.5 mt-0.5 ${isMe ? "justify-end" : "justify-start"}`}>
                          <p className={`text-[10px] flex-shrink-0 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                            {format(msgDate, "h:mm a")}
                          </p>
                          <div className="relative flex-shrink-0">
                            <button
                              onClick={() => setActiveEmojiPicker(activeEmojiPicker === msg.id ? null : msg.id)}
                              className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${isMe ? "text-primary-foreground/50 hover:text-primary-foreground/80" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                              data-testid={`button-react-${msg.id}`}
                            >
                              <Smile className="w-3 h-3" />
                            </button>
                            {activeEmojiPicker === msg.id && (
                              <EmojiPicker onSelect={(emoji) => handleReaction(msg.id, emoji)} onClose={() => setActiveEmojiPicker(null)} alignRight={isMe} />
                            )}
                          </div>
                          {isAdminUser && !isMe && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              className="w-5 h-5 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-destructive transition-colors flex-shrink-0"
                              data-testid={`button-delete-msg-${msg.id}`}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                      <ReactionBadges reactions={msg.reactions} userId={user?.id || ""} onToggle={(emoji) => handleReaction(msg.id, emoji)} />
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
          <Button size="sm" variant="secondary" className="rounded-full shadow-lg text-xs gap-1 px-3" onClick={() => scrollToBottom()} data-testid="button-community-new-messages">
            <ChevronDown className="w-3 h-3" /> New messages
          </Button>
        </div>
      )}

      <div className="border-t p-2 sm:p-3 flex-shrink-0">
        {typingNames.length > 0 && (
          <div className="flex items-center gap-1.5 mb-1.5 px-1">
            <span className="text-xs text-muted-foreground">
              {typingNames.length === 1 ? typingNames[0] : `${typingNames.length} people`}
            </span>
            <BouncingDots />
          </div>
        )}
        <div className="flex items-end gap-2 relative">
          {mentionQuery !== null && participants && (
            <MentionAutocomplete
              query={mentionQuery}
              participants={participants}
              isAdmin={isAdminUser}
              onSelect={insertMention}
              selectedIndex={mentionIndex}
            />
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
              detectMention(e.target.value, el.selectionStart);
            }}
            onKeyDown={(e) => {
              if (mentionQuery !== null && participants) {
                const q = mentionQuery.toLowerCase();
                const filtered: Participant[] = [];
                if (isAdminUser && "everyone".startsWith(q)) {
                  filtered.push({ username: "everyone", isAdmin: true });
                }
                for (const p of participants) {
                  if (p.username.toLowerCase().startsWith(q)) filtered.push(p);
                }
                if (filtered.length === 0) {
                  for (const p of participants) {
                    if (p.username.toLowerCase().includes(q) && !filtered.some(f => f.username === p.username)) filtered.push(p);
                  }
                }
                const shown = filtered.slice(0, 8);
                if (shown.length > 0) {
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setMentionIndex(i => (i + 1) % shown.length);
                    return;
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setMentionIndex(i => (i - 1 + shown.length) % shown.length);
                    return;
                  }
                  if (e.key === "Enter" || e.key === "Tab") {
                    e.preventDefault();
                    insertMention(shown[mentionIndex].username);
                    return;
                  }
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setMentionQuery(null);
                    mentionStartRef.current = null;
                    return;
                  }
                }
              }
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                handleSend();
              }
            }}
            onSelect={(e) => {
              const el = e.target as HTMLTextAreaElement;
              detectMention(el.value, el.selectionStart);
            }}
            placeholder="Type a message..."
            className="flex-1 min-h-[36px] max-h-[120px] resize-none text-sm"
            rows={1}
            data-testid="input-community-message"
          />
          <Button
            size="icon"
            className="flex-shrink-0 h-9 w-9"
            onClick={handleSend}
            disabled={!message.trim()}
            data-testid="button-send-community-message"
          >
            <Send className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <UsernameSetupDialog open={showUsernameDialog} onComplete={handleUsernameComplete} />
    </div>
  );
}
