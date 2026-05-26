import { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { UserProfileDialog } from "@/components/user-profile-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useIsMobile } from "@/hooks/use-mobile";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Send, Shield, ChevronDown, Smile, Trash2, Users, Settings, Bell, BellOff, AtSign, AlertTriangle, Ban, X, Reply, UserSearch, Mail, Calendar, Ticket, Loader2, BarChart3, ImagePlus, BookOpen, ChevronRight, Search } from "lucide-react";
import { LiveConnectionBanner } from "@/components/live-connection-banner";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { Link } from "wouter";
import { Poll } from "@/components/poll";
import { ClickableImage } from "@/components/image-lightbox";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";
import { PollComposerDialog } from "@/components/poll-composer";
import { Badge } from "@/components/ui/badge";
import { format, isToday, isYesterday } from "date-fns";
import type { CommunityMessage } from "@shared/schema";

type AdminAction =
  | { type: "menu"; messageId: string; userId: string; username: string }
  | { type: "warn"; userId: string; username: string }
  | { type: "review"; userId: string; username: string }
  | { type: "reply-only"; username: string }
  | null;

type ReactionGroup = { emoji: string; userIds: string[] };
type EnrichedMessage = CommunityMessage & { reactions: ReactionGroup[]; isAdmin?: boolean; avatarUrl?: string | null; kbArticle?: KbArticleRef | null };

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
  const isMobile = useIsMobile();
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

  const body = (
    <>
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
        <div className="pt-2">
          <Button className="w-full" onClick={handleSubmit} disabled={saving || checking || !!error || username.trim().length < 2} data-testid="button-save-username">
            {saving ? "Saving..." : "Start Chatting"}
          </Button>
        </div>
    </>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={() => {}}>
        <SheetContent
          side="bottom"
          className="h-[92vh] p-0 flex flex-col rounded-t-2xl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
          data-testid="dialog-username-setup"
        >
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1.5 rounded-full bg-muted-foreground/30" />
          </div>
          <SheetHeader className="px-4 pb-3 text-left">
            <SheetTitle data-testid="text-username-dialog-title">Set Up Community Chat</SheetTitle>
          </SheetHeader>
          <ScrollArea className="flex-1 px-4 pb-6">{body}</ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()} data-testid="dialog-username-setup">
        <DialogHeader>
          <DialogTitle data-testid="text-username-dialog-title">Set Up Community Chat</DialogTitle>
        </DialogHeader>
        {body}
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
    <div ref={ref} className={`absolute bottom-full mb-1 ${alignRight ? "right-0" : "left-0"} bg-popover border rounded-lg shadow-lg p-1.5 grid grid-cols-4 gap-1 z-50 w-[200px]`} data-testid="emoji-picker">
      {EMOJI_OPTIONS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => { onSelect(emoji); onClose(); }}
          className="w-11 h-11 flex items-center justify-center rounded hover:bg-muted active:bg-muted/80 transition-colors text-xl"
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
            className={`inline-flex items-center gap-1 px-2.5 py-1 min-h-[28px] rounded-full text-xs border transition-colors ${isMine ? "bg-primary/15 border-primary/30 text-primary" : "bg-muted border-border hover:bg-muted/80 active:bg-muted/60"}`}
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

type UserSnapshot = {
  fullName: string;
  email: string;
  username: string;
  chatUsername: string | null;
  createdAt: string;
  subscribedServices: string[];
  openTickets: number;
  totalTickets: number;
  chatBanned: boolean;
};

function ReviewCustomerDialog({ userId, username, onClose }: { userId: string; username: string; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<UserSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/admin/community-chat/user-snapshot/${userId}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : null)
      .then(d => { setSnapshot(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [userId]);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-review-customer">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserSearch className="w-4 h-4 text-primary" />
            Review Customer
          </DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        ) : !snapshot ? (
          <p className="text-sm text-muted-foreground text-center py-4">Could not load customer info.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <Avatar className="w-10 h-10">
                <AvatarFallback className="text-sm font-medium">{snapshot.fullName.charAt(0).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-medium text-sm truncate" data-testid="text-review-fullname">{snapshot.fullName}</p>
                <p className="text-xs text-muted-foreground truncate">@{snapshot.username}</p>
              </div>
              {snapshot.chatBanned && <Badge variant="destructive" className="text-[10px] ml-auto flex-shrink-0">Banned</Badge>}
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex items-center gap-2">
                <AtSign className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Chat name:</span>
                <span className="truncate font-medium" data-testid="text-review-chatname">{snapshot.chatUsername || "Not set"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Email:</span>
                <span className="truncate" data-testid="text-review-email">{snapshot.email}</span>
              </div>
              <div className="flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Member since:</span>
                <span data-testid="text-review-joined">{format(new Date(snapshot.createdAt), "MMM d, yyyy")}</span>
              </div>
              <div className="flex items-center gap-2">
                <Ticket className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Tickets:</span>
                <span data-testid="text-review-tickets">{snapshot.openTickets} open / {snapshot.totalTickets} total</span>
              </div>
              <div className="flex items-center gap-2">
                <Bell className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <span className="text-muted-foreground">Subscriptions:</span>
                <span data-testid="text-review-subs">
                  {snapshot.subscribedServices.length > 0
                    ? snapshot.subscribedServices.join(", ")
                    : "None"}
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MessageActionPopup({ action, onClose, onDelete, onWarnSubmit, onBan, onReply }: {
  action: AdminAction;
  onClose: (next?: string) => void;
  onDelete: (messageId: string) => void;
  onWarnSubmit: (userId: string, message: string) => void;
  onBan: (userId: string) => void;
  onReply: (username: string) => void;
}) {
  const [warnMessage, setWarnMessage] = useState("");
  const [saving, setSaving] = useState(false);

  if (!action) return null;

  if (action.type === "review") {
    return <ReviewCustomerDialog userId={action.userId} username={action.username} onClose={() => onClose()} />;
  }

  if (action.type === "warn") {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md" data-testid="dialog-warn-user">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-yellow-500" />
              Warn {action.username}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Send a warning notification to this user. They'll receive a push notification and in-app alert.</p>
            <Textarea
              value={warnMessage}
              onChange={(e) => setWarnMessage(e.target.value)}
              placeholder="Enter your warning message..."
              className="min-h-[80px] text-sm"
              data-testid="input-warn-message"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={onClose} data-testid="button-cancel-warn">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={!warnMessage.trim() || saving}
              onClick={async () => {
                setSaving(true);
                await onWarnSubmit(action.userId, warnMessage.trim());
                setSaving(false);
              }}
              data-testid="button-send-warning"
            >
              {saving ? "Sending..." : "Send Warning"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (action.type === "reply-only") {
    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[280px] p-0 gap-0" data-testid="dialog-reply-actions">
          <div className="px-4 py-3 border-b">
            <p className="text-sm font-medium truncate">{action.username}</p>
          </div>
          <div className="py-1">
            <button
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
              onClick={() => { onReply(action.username); onClose(); }}
              data-testid="button-reply"
            >
              <Reply className="w-4 h-4 text-muted-foreground" />
              Reply
            </button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[280px] p-0 gap-0" data-testid="dialog-admin-actions">
        <div className="px-4 py-3 border-b">
          <p className="text-sm font-medium truncate">{action.username}</p>
        </div>
        <div className="py-1">
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
            onClick={() => { onReply(action.username); onClose(); }}
            data-testid="button-reply"
          >
            <Reply className="w-4 h-4 text-muted-foreground" />
            Reply
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
            onClick={() => onClose("review")}
            data-testid="button-review-customer"
          >
            <UserSearch className="w-4 h-4 text-muted-foreground" />
            Review Customer
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
            onClick={() => { onDelete(action.messageId); onClose(); }}
            data-testid="button-admin-delete-msg"
          >
            <Trash2 className="w-4 h-4 text-muted-foreground" />
            Delete Message
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-muted transition-colors"
            onClick={() => onClose("warn")}
            data-testid="button-admin-warn-user"
          >
            <AlertTriangle className="w-4 h-4 text-yellow-500" />
            Warn User
          </button>
          <button
            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-destructive hover:bg-muted transition-colors"
            onClick={() => { onBan(action.userId); onClose(); }}
            data-testid="button-admin-ban-user"
          >
            <Ban className="w-4 h-4" />
            Ban from Chat
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

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

interface CommunityRowProps {
  msg: CommunityMessage;
  isMe: boolean;
  msgIsAdmin: boolean;
  isFirstInRun: boolean;
  isLastInRun: boolean;
  tailClass: string;
  isNewSinceMount: boolean;
  showSeparator: boolean;
  dateSepLabel: string;
  rowGap: string;
  rowExtra: string;
  msgDate: Date;
  isAdminUser: boolean;
  isActiveEmojiPicker: boolean;
  currentUserId: string;
  onProfileClick: (userId: string) => void;
  onAdminMenu: (a: { type: "menu"; messageId: string; userId: string; username: string }) => void;
  onToggleEmojiPicker: (id: string) => void;
  onCloseEmojiPicker: () => void;
  onReact: (messageId: string, emoji: string) => void;
  onPollDeleted: () => void;
}

const CommunityMessageRow = memo(function CommunityMessageRow(props: CommunityRowProps) {
  const {
    msg, isMe, msgIsAdmin, isFirstInRun, isLastInRun: _ignored, tailClass,
    isNewSinceMount, showSeparator, dateSepLabel, rowGap, rowExtra, msgDate,
    isAdminUser, isActiveEmojiPicker, currentUserId,
    onProfileClick, onAdminMenu, onToggleEmojiPicker, onCloseEmojiPicker,
    onReact, onPollDeleted,
  } = props;
  const animClass = isNewSinceMount ? " chat-msg-enter" : "";
  return (
    <div data-testid={`community-message-${msg.id}`} className={`${animClass}`.trim() || undefined}>
      {showSeparator && (
        <div className="flex items-center justify-center my-3">
          <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{dateSepLabel}</span>
        </div>
      )}
      <div className={`flex ${isMe ? "justify-end" : "justify-start"} ${rowGap}${rowExtra} gap-2`}>
        {!isMe && (
          isFirstInRun ? (
            <button
              type="button"
              onClick={() => onProfileClick(msg.userId)}
              className="flex-shrink-0 self-end mb-1 rounded-full hover:opacity-80 transition-opacity"
              data-testid={`button-avatar-${msg.id}`}
            >
              <Avatar className="w-7 h-7">
                {msg.avatarUrl && <AvatarImage src={msg.avatarUrl} alt={msg.chatUsername} />}
                <AvatarFallback className="text-[10px]">{msg.chatUsername?.[0]?.toUpperCase() || "?"}</AvatarFallback>
              </Avatar>
            </button>
          ) : (
            <div className="w-7 flex-shrink-0" aria-hidden="true" />
          )
        )}
        <div className="relative max-w-[85%] sm:max-w-[70%] min-w-0">
          <div className={`rounded-2xl px-3 py-2${tailClass} ${isMe ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
            {isFirstInRun && (
              <p className={`text-[10px] font-medium mb-0.5 flex items-center gap-1 ${isMe ? "text-primary-foreground/70" : msgIsAdmin ? "text-primary" : "opacity-70"}`}>
                {!isMe ? (
                  <button
                    className="truncate underline decoration-dotted underline-offset-2 hover:opacity-80 transition-opacity"
                    onClick={() => {
                      if (isAdminUser && !msgIsAdmin) {
                        onAdminMenu({ type: "menu", messageId: msg.id, userId: msg.userId, username: msg.chatUsername });
                      } else {
                        onProfileClick(msg.userId);
                      }
                    }}
                    data-testid={`button-username-${msg.id}`}
                  >
                    {msg.chatUsername}
                  </button>
                ) : (
                  <span className="truncate">{msg.chatUsername}</span>
                )}
                {msgIsAdmin && <Shield className="w-2.5 h-2.5 flex-shrink-0" />}
              </p>
            )}
            {msg.pollId ? (
              <div className="my-1 -mx-1">
                <Poll pollId={msg.pollId} onDeleted={onPollDeleted} />
              </div>
            ) : (
              <>
                {msg.imageUrl && (
                  <div className="my-1 -mx-1 max-w-[280px]" data-testid={`img-community-msg-${msg.id}`}>
                    <ClickableImage
                      src={msg.imageUrl}
                      alt="Attached image"
                      className="max-h-[280px] w-auto rounded-md object-contain"
                    />
                  </div>
                )}
                {msg.content && (
                  <p className="text-sm whitespace-pre-wrap break-words overflow-hidden" data-testid={`text-community-msg-${msg.id}`}>{msg.content}</p>
                )}
                {msg.kbArticle && (
                  <Link href={`/knowledge/${msg.kbArticle.slug}`}>
                    <div
                      className={`mt-1.5 -mx-0.5 rounded-md border p-2 cursor-pointer hover-elevate tap-interactive ${isMe ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/60"}`}
                      data-testid={`card-kb-article-msg-${msg.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <BookOpen className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isMe ? "text-primary-foreground/80" : "text-primary"}`} />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${isMe ? "text-primary-foreground" : ""}`}>{msg.kbArticle.title}</p>
                          {msg.kbArticle.categoryName && (
                            <p className={`text-[10px] mt-0.5 ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{msg.kbArticle.categoryName}</p>
                          )}
                          {msg.kbArticle.summary && (
                            <p className={`text-xs mt-1 line-clamp-2 ${isMe ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{msg.kbArticle.summary}</p>
                          )}
                        </div>
                        <ChevronRight className={`w-3.5 h-3.5 flex-shrink-0 mt-1 ${isMe ? "text-primary-foreground/70" : "text-muted-foreground"}`} />
                      </div>
                    </div>
                  </Link>
                )}
              </>
            )}
            <div className={`flex items-center gap-1.5 mt-0.5 ${isMe ? "justify-end" : "justify-start"}`}>
              <p className={`text-[10px] flex-shrink-0 ${isMe ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                {format(msgDate, "h:mm a")}
              </p>
              <div className="relative flex-shrink-0">
                <button
                  onClick={() => onToggleEmojiPicker(msg.id)}
                  className={`w-5 h-5 flex items-center justify-center rounded-full transition-colors ${isMe ? "text-primary-foreground/50 hover:text-primary-foreground/80" : "text-muted-foreground/50 hover:text-muted-foreground"}`}
                  data-testid={`button-react-${msg.id}`}
                >
                  <Smile className="w-3 h-3" />
                </button>
                {isActiveEmojiPicker && (
                  <EmojiPicker onSelect={(emoji) => onReact(msg.id, emoji)} onClose={onCloseEmojiPicker} alignRight={isMe} />
                )}
              </div>
            </div>
          </div>
          <ReactionBadges reactions={msg.reactions} userId={currentUserId} onToggle={(emoji) => onReact(msg.id, emoji)} />
        </div>
      </div>
    </div>
  );
});

export default function CommunityChatPage() {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [showUsernameDialog, setShowUsernameDialog] = useState(false);
  const [chatUsername, setChatUsername] = useState<string | null>(null);
  const [chatNotifPref, setChatNotifPref] = useState("mentions");
  const [typingUsers, setTypingUsers] = useState<Map<string, string>>(new Map());
  const [showNewMessagesPill, setShowNewMessagesPill] = useState(false);
  // Tracks message IDs present on first load so only newly-arrived messages
  // get the fade-in animation (initial history paints instantly).
  const initialMessageIdsRef = useRef<Set<string> | null>(null);
  const [activeEmojiPicker, setActiveEmojiPicker] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [adminAction, setAdminAction] = useState<AdminAction>(null);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingImage, setPendingImage] = useState<File | null>(null);
  // We mirror pendingImage into a ref so handleSend (a memoised callback)
  // can read the freshest file value without us having to take the file
  // as a dep — pulling pendingImage into handleSend's deps would also pull
  // every other consumer of handleSend's identity into a rerender storm.
  const pendingImageRef = useRef<File | null>(null);
  const imagePreviewUrl = useMemo(() => {
    if (!pendingImage) return null;
    return URL.createObjectURL(pendingImage);
  }, [pendingImage]);
  useEffect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  }, [imagePreviewUrl]);
  const imageFileInputRef = useRef<HTMLInputElement>(null);
  const [pendingKbArticle, setPendingKbArticle] = useState<KbArticleRef | null>(null);
  // Same ref-mirror trick as pendingImage — handleSend reads it without
  // needing to take pendingKbArticle as a dep.
  const pendingKbArticleRef = useRef<KbArticleRef | null>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
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

  const currentUserIdRef = useRef<string | null>(null);
  currentUserIdRef.current = user?.id ?? null;

  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    wsRef,
    deps: [user?.id],
    onMessage: (event) => {
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
        if (data.type === "poll_vote" || data.type === "poll_deleted") {
          if (data.pollId) queryClient.invalidateQueries({ queryKey: ["/api/polls", data.pollId] });
          if (data.type === "poll_deleted" && data.parentType === "community") {
            queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
          }
        }
        if (data.type === "community_typing" && data.userId !== currentUserIdRef.current) {
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
    },
  });

  useEffect(() => {
    const timeouts = typingTimeoutsRef.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
    };
  }, []);

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
    const file = pendingImageRef.current;
    const kbArticle = pendingKbArticleRef.current;
    if (!content && !file && !kbArticle) return;
    setMessage("");
    setPendingImage(null);
    pendingImageRef.current = null;
    setPendingKbArticle(null);
    pendingKbArticleRef.current = null;
    setMentionQuery(null);
    mentionStartRef.current = null;
    try {
      const formData = new FormData();
      formData.append("content", content);
      if (file) formData.append("image", file);
      if (kbArticle) formData.append("kbArticleSlug", kbArticle.slug);
      const res = await fetch("/api/community-chat/messages", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ title: "Failed to send", description: data.error, variant: "destructive" });
        setMessage(content);
        if (file) {
          setPendingImage(file);
          pendingImageRef.current = file;
        }
        if (kbArticle) {
          setPendingKbArticle(kbArticle);
          pendingKbArticleRef.current = kbArticle;
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
      if (isNearBottomRef.current) setTimeout(() => scrollToBottom(), 50);
    } catch {
      toast({ title: "Failed to send message", variant: "destructive" });
      setMessage(content);
      if (file) {
        setPendingImage(file);
        pendingImageRef.current = file;
      }
      if (kbArticle) {
        setPendingKbArticle(kbArticle);
        pendingKbArticleRef.current = kbArticle;
      }
    }
    setTimeout(() => {
      const el = messageInputRef.current;
      if (el) { el.style.height = "auto"; el.focus(); }
    }, 0);
  }, [message, scrollToBottom, toast]);

  const handleProfileClick = useCallback((userId: string) => {
    setProfileUserId(userId);
  }, []);
  const handleToggleEmojiPicker = useCallback((id: string) => {
    setActiveEmojiPicker((curr) => (curr === id ? null : id));
  }, []);
  const handleCloseEmojiPicker = useCallback(() => {
    setActiveEmojiPicker(null);
  }, []);
  const handlePollDeleted = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["/api/community-chat/messages"] });
  }, []);

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

  const handleWarnUser = useCallback(async (userId: string, warnMsg: string) => {
    try {
      const res = await fetch("/api/community-chat/warn-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, message: warnMsg }),
        credentials: "include",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Warning sent to user" });
      setAdminAction(null);
    } catch {
      toast({ title: "Failed to send warning", variant: "destructive" });
    }
  }, [toast]);

  const handleBanUser = useCallback(async (userId: string) => {
    try {
      const res = await fetch("/api/community-chat/ban-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json();
        toast({ title: data.error || "Failed to ban", variant: "destructive" });
        return;
      }
      toast({ title: "User banned from community chat" });
      setAdminAction(null);
    } catch {
      toast({ title: "Failed to ban user", variant: "destructive" });
    }
  }, [toast]);

  const handleReply = useCallback((username: string) => {
    const el = messageInputRef.current;
    const mention = `@${username} `;
    if (el) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      const before = message.slice(0, start);
      const after = message.slice(end);
      const newMsg = before + mention + after;
      setMessage(newMsg);
      setTimeout(() => {
        const pos = start + mention.length;
        el.setSelectionRange(pos, pos);
        el.focus();
      }, 0);
    } else {
      setMessage((prev) => prev + mention);
    }
  }, [message]);

  const handleAdminClose = useCallback((next?: string) => {
    if (next === "warn" && adminAction && "userId" in adminAction) {
      setAdminAction({ type: "warn", userId: adminAction.userId, username: adminAction.username });
    } else if (next === "review" && adminAction && "userId" in adminAction) {
      setAdminAction({ type: "review", userId: adminAction.userId, username: adminAction.username });
    } else {
      setAdminAction(null);
    }
  }, [adminAction]);

  const typingNames = useMemo(() => Array.from(typingUsers.values()), [typingUsers]);

  const isAdminUser = user?.role === "admin" || user?.role === "master_admin";
  const isBanned = user?.chatBanned === true;

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

      <LiveConnectionBanner status={wsStatus} className="mx-2 sm:mx-3 mt-2" />

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
            {(() => {
              // Only snapshot once we actually have the loaded list; if we
              // snapshot during isLoading (empty array) the real history
              // would animate when it arrives.
              if (initialMessageIdsRef.current === null && !isLoading && messages) {
                initialMessageIdsRef.current = new Set(messages.map((m) => m.id));
              }
              return null;
            })()}
            {messages.map((msg, idx) => {
              const isMe = msg.userId === user?.id;
              const msgDate = new Date(msg.createdAt);
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const prevDate = prevMsg ? new Date(prevMsg.createdAt) : null;
              const showSeparator = !prevDate || formatDateSeparator(msgDate) !== formatDateSeparator(prevDate);
              const msgIsAdmin = msg.isAdmin || false;

              // Consecutive bubbles from same user within 2min collapse: hide
              // avatar + name on continuation rows, tighter spacing.
              const sameRunAsPrev = !!prevMsg
                && !showSeparator
                && prevMsg.userId === msg.userId
                && (msgDate.getTime() - (prevDate?.getTime() ?? 0)) < 2 * 60 * 1000;
              const isFirstInRun = !sameRunAsPrev;

              const nextMsg = idx + 1 < messages.length ? messages[idx + 1] : null;
              const nextDate = nextMsg ? new Date(nextMsg.createdAt) : null;
              const nextDateSep = !!nextDate && formatDateSeparator(nextDate) !== formatDateSeparator(msgDate);
              const sameRunAsNext = !!nextMsg
                && !nextDateSep
                && nextMsg.userId === msg.userId
                && ((nextDate?.getTime() ?? 0) - msgDate.getTime()) < 2 * 60 * 1000;
              const isLastInRun = !sameRunAsNext;

              // Tail rounding: shrink the corner on the sender side that
              // touches the adjacent bubble in the run.
              const tailClass = isMe
                ? `${!isFirstInRun ? " rounded-tr-md" : ""}${!isLastInRun ? " rounded-br-md" : ""}`
                : `${!isFirstInRun ? " rounded-tl-md" : ""}${!isLastInRun ? " rounded-bl-md" : ""}`;

              const isNewSinceMount = initialMessageIdsRef.current
                ? !initialMessageIdsRef.current.has(msg.id)
                : false;

              const rowGap = isFirstInRun ? "mb-1" : "mb-0";
              const rowExtra = !isFirstInRun ? " -mt-0.5" : "";

              return (
                <CommunityMessageRow
                  key={msg.id}
                  msg={msg}
                  isMe={isMe}
                  msgIsAdmin={msgIsAdmin}
                  isFirstInRun={isFirstInRun}
                  isLastInRun={isLastInRun}
                  tailClass={tailClass}
                  isNewSinceMount={isNewSinceMount}
                  showSeparator={showSeparator}
                  dateSepLabel={formatDateSeparator(msgDate)}
                  rowGap={rowGap}
                  rowExtra={rowExtra}
                  msgDate={msgDate}
                  isAdminUser={isAdminUser}
                  isActiveEmojiPicker={activeEmojiPicker === msg.id}
                  currentUserId={user?.id || ""}
                  onProfileClick={handleProfileClick}
                  onAdminMenu={setAdminAction}
                  onToggleEmojiPicker={handleToggleEmojiPicker}
                  onCloseEmojiPicker={handleCloseEmojiPicker}
                  onReact={handleReaction}
                  onPollDeleted={handlePollDeleted}
                />
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

      {isBanned ? (
        <div className="border-t p-3 flex-shrink-0 text-center" data-testid="text-chat-banned">
          <div className="flex items-center justify-center gap-2 text-destructive">
            <Ban className="w-4 h-4" />
            <p className="text-sm font-medium">You have been banned from community chat</p>
          </div>
        </div>
      ) : (
        <div className="border-t p-2 sm:p-3 flex-shrink-0 ios-input-fix">
          {typingNames.length > 0 && (
            <div className="flex items-center gap-1.5 mb-1.5 px-1" data-testid="text-typing-indicator">
              <span className="text-xs text-muted-foreground italic">
                {typingNames.length === 1
                  ? `${typingNames[0]} is typing`
                  : typingNames.length === 2
                  ? `${typingNames[0]} and ${typingNames[1]} are typing`
                  : `${typingNames.length} people are typing`}
              </span>
              <BouncingDots />
            </div>
          )}
          {pendingImage && imagePreviewUrl && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-muted/40 p-1.5 pr-2" data-testid="container-pending-image">
              <img
                src={imagePreviewUrl}
                alt="Pending attachment"
                className="h-12 w-12 rounded object-cover"
              />
              <span className="text-xs text-muted-foreground max-w-[140px] truncate">{pendingImage.name}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => {
                  setPendingImage(null);
                  pendingImageRef.current = null;
                }}
                data-testid="button-remove-pending-image"
                title="Remove image"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
          {pendingKbArticle && (
            <div className="mb-2 inline-flex items-center gap-2 rounded-md border bg-muted/40 p-1.5 pr-2 max-w-full" data-testid="container-pending-kb-article">
              <BookOpen className="w-4 h-4 text-primary flex-shrink-0 ml-1" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate">{pendingKbArticle.title}</p>
                {pendingKbArticle.categoryName && (
                  <p className="text-[10px] text-muted-foreground truncate">{pendingKbArticle.categoryName}</p>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => {
                  setPendingKbArticle(null);
                  pendingKbArticleRef.current = null;
                }}
                data-testid="button-remove-pending-kb-article"
                title="Remove article link"
              >
                <X className="w-3 h-3" />
              </Button>
            </div>
          )}
          <input
            ref={imageFileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            data-testid="input-community-image-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (!file.type.startsWith("image/")) {
                toast({ title: "Only images can be attached", variant: "destructive" });
                return;
              }
              if (file.size > 25 * 1024 * 1024) {
                toast({ title: "Image is too large (max 25 MB)", variant: "destructive" });
                return;
              }
              setPendingImage(file);
              pendingImageRef.current = file;
            }}
          />
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
              variant="outline"
              className="flex-shrink-0 h-9 w-9"
              onClick={() => imageFileInputRef.current?.click()}
              data-testid="button-attach-community-image"
              title="Attach an image"
            >
              <ImagePlus className="w-4 h-4" />
            </Button>
            {isAdminUser && (
              <>
                <Button
                  size="icon"
                  variant="outline"
                  className="flex-shrink-0 h-9 w-9"
                  onClick={() => setKbPickerOpen(true)}
                  data-testid="button-attach-kb-article"
                  title="Link a knowledge base article"
                >
                  <BookOpen className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  className="flex-shrink-0 h-9 w-9"
                  onClick={() => setPollDialogOpen(true)}
                  data-testid="button-open-poll-composer"
                  title="Post a poll"
                >
                  <BarChart3 className="w-4 h-4" />
                </Button>
              </>
            )}
            <Button
              size="icon"
              className="flex-shrink-0 h-9 w-9"
              onClick={handleSend}
              disabled={!message.trim() && !pendingImage && !pendingKbArticle}
              data-testid="button-send-community-message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      <PollComposerDialog open={pollDialogOpen} onOpenChange={setPollDialogOpen} parentType="community" />
      <KbArticlePickerDialog
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onSelect={(article) => {
          setPendingKbArticle(article);
          pendingKbArticleRef.current = article;
          setKbPickerOpen(false);
        }}
      />
      <UsernameSetupDialog open={showUsernameDialog} onComplete={handleUsernameComplete} />
      <UserProfileDialog
        userId={profileUserId}
        open={!!profileUserId}
        onOpenChange={(o) => { if (!o) setProfileUserId(null); }}
      />
      <MessageActionPopup
        action={adminAction}
        onClose={handleAdminClose}
        onDelete={handleDeleteMessage}
        onWarnSubmit={handleWarnUser}
        onBan={handleBanUser}
        onReply={handleReply}
      />
    </div>
  );
}
