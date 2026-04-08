import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, X, Mail, MessageSquare, AlertTriangle, Newspaper, Activity, FileText, RefreshCw, CheckCheck, UserPlus, MonitorX, MonitorCheck } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";

interface UserNotification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  referenceType: string | null;
  referenceId: string | null;
  url: string | null;
  readAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
}

const typeIcons: Record<string, typeof Bell> = {
  message: Mail,
  ticket_update: MessageSquare,
  alert: AlertTriangle,
  news: Newspaper,
  service_status: Activity,
  service_update: RefreshCw,
  report_update: FileText,
  new_signup: UserPlus,
  new_ticket: MessageSquare,
  new_report: FileText,
  monitor_down: MonitorX,
  monitor_up: MonitorCheck,
};

function getIcon(type: string) {
  return typeIcons[type] || Bell;
}

function invalidateRelatedBadges(type: string) {
  const keys: string[] = ["/api/notifications/unread-count"];
  if (type === "ticket_update" || type === "new_ticket") keys.push("/api/ticket-notifications/unread-count");
  if (type === "message") keys.push("/api/message-threads/unread-count");
  if (type === "report_update" || type === "new_report") keys.push("/api/report-notifications/unread-count");
  if (["alert", "news", "service_status", "service_update", "new_signup"].includes(type)) keys.push("/api/content-notifications/counts");
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function NotificationList({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [hasSyncedBadges, setHasSyncedBadges] = useState(false);
  const { data: notifications = [], isLoading } = useQuery<UserNotification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/notifications/${id}/dismiss`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ticket-notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/report-notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
    },
  });

  const handleMarkAllRead = () => {
    hapticMedium();
    markAllReadMutation.mutate();
  };

  useEffect(() => {
    if (!isLoading && notifications.length === 0 && !hasSyncedBadges) {
      setHasSyncedBadges(true);
      apiRequest("POST", "/api/notifications/mark-all-read")
        .then(() => {
          queryClient.invalidateQueries({ queryKey: ["/api/ticket-notifications/unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["/api/report-notifications/unread-count"] });
          queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
          queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        })
        .catch(() => {});
    }
  }, [isLoading, notifications.length, hasSyncedBadges]);

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {[1, 2, 3].map(i => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="w-8 h-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-3 bg-muted rounded w-3/4" />
              <div className="h-3 bg-muted rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  type GroupedNotification = {
    key: string;
    notifications: UserNotification[];
    latest: UserNotification;
    count: number;
  };

  const groupedNotifications: GroupedNotification[] = (() => {
    const groups: GroupedNotification[] = [];
    const messageGroups = new Map<string, UserNotification[]>();

    for (const notif of notifications) {
      if (notif.type === "message" && notif.referenceId) {
        const key = `message-${notif.referenceId}`;
        if (!messageGroups.has(key)) messageGroups.set(key, []);
        messageGroups.get(key)!.push(notif);
      } else {
        groups.push({ key: notif.id, notifications: [notif], latest: notif, count: 1 });
      }
    }

    for (const [key, notifs] of messageGroups) {
      const sorted = notifs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      groups.push({ key, notifications: sorted, latest: sorted[0], count: sorted.length });
    }

    groups.sort((a, b) => new Date(b.latest.createdAt).getTime() - new Date(a.latest.createdAt).getTime());
    return groups;
  })();

  const handleDismissGroup = (e: React.MouseEvent, group: GroupedNotification) => {
    e.stopPropagation();
    hapticLight();
    for (const notif of group.notifications) {
      dismissMutation.mutate(notif.id);
    }
    invalidateRelatedBadges(group.latest.type);
  };

  const handleTapGroup = (group: GroupedNotification) => {
    hapticLight();
    for (const notif of group.notifications) {
      dismissMutation.mutate(notif.id);
    }
    invalidateRelatedBadges(group.latest.type);
    if (group.latest.url) {
      onNavigate(group.latest.url);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <h3 className="text-sm font-semibold" data-testid="text-notifications-title">Notifications</h3>
        {notifications.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={handleMarkAllRead}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Clear all
          </Button>
        )}
      </div>
      <ScrollArea className="max-h-[60vh] md:max-h-[400px]">
        {groupedNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
            <Bell className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="divide-y">
            {groupedNotifications.map(group => {
              const notif = group.latest;
              const Icon = getIcon(notif.type);
              const isUnread = group.notifications.some(n => !n.readAt);
              return (
                <div
                  key={group.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTapGroup(group)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTapGroup(group); } }}
                  className={`flex items-start gap-3 w-full px-4 py-3 text-left transition-colors tap-interactive hover:bg-muted/50 cursor-pointer ${isUnread ? "bg-primary/5" : ""}`}
                  data-testid={`notification-item-${notif.id}`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${isUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className={`text-sm leading-tight ${isUnread ? "font-medium" : "text-muted-foreground"}`}>{notif.title}</p>
                      {group.count > 1 && (
                        <span className="flex-shrink-0 text-[10px] font-medium bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                          {group.count}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {group.count > 1 ? `${group.count} new messages` : notif.body}
                    </p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDismissGroup(e, group)}
                    className="flex-shrink-0 p-1 rounded-md hover:bg-muted tap-interactive mt-0.5"
                    data-testid={`button-dismiss-${group.key}`}
                  >
                    <X className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

export function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const [, navigate] = useLocation();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const unreadCount = unreadData?.count ?? 0;

  const handleNavigate = (url: string) => {
    setOpen(false);
    navigate(url);
  };

  const bellButton = (
    <button
      onClick={() => { hapticLight(); setOpen(true); }}
      className="relative p-2 rounded-md hover:bg-muted/80 tap-interactive transition-colors"
      data-testid="button-notification-bell"
    >
      <Bell className="w-5 h-5 text-foreground" />
      {unreadCount > 0 && (
        <span
          className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1"
          data-testid="badge-notification-count"
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </button>
  );

  if (isMobile) {
    return (
      <>
        {bellButton}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="rounded-t-2xl px-0 pt-3 pb-4 max-h-[80vh]">
            <VisuallyHidden>
              <SheetTitle>Notifications</SheetTitle>
            </VisuallyHidden>
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-2" />
            <NotificationList onNavigate={handleNavigate} />
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {bellButton}
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" sideOffset={8}>
        <NotificationList onNavigate={handleNavigate} />
      </PopoverContent>
    </Popover>
  );
}
