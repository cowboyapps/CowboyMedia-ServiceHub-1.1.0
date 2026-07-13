import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, X, Mail, MessageSquare, AlertTriangle, Newspaper, Activity, FileText, RefreshCw, CheckCheck, UserPlus, MonitorX, MonitorCheck, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { navigateAcrossApps } from "@/lib/admin-nav";
import { useToast } from "@/hooks/use-toast";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { formatDistanceToNow } from "date-fns";
import { groupNotifications, type UserNotification, type GroupedNotification } from "@/lib/notification-grouping";

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

const RELATED_BADGE_KEYS = [
  "/api/notifications/unread-count",
  "/api/ticket-notifications/unread-count",
  "/api/message-threads/unread-count",
  "/api/report-notifications/unread-count",
  "/api/content-notifications/counts",
];

function badgeKeysForType(type: string): string[] {
  const keys: string[] = [];
  if (type === "ticket_update" || type === "new_ticket") keys.push("/api/ticket-notifications/unread-count");
  if (type === "message") keys.push("/api/message-threads/unread-count");
  if (type === "report_update" || type === "new_report") keys.push("/api/report-notifications/unread-count");
  if (["alert", "news", "service_status", "service_update", "new_signup"].includes(type)) keys.push("/api/content-notifications/counts");
  return keys;
}

// Invalidate the always-on notifications badge plus every category badge touched
// by any notification in the group — a collapsed row can span multiple types, so
// keying off only the latest one would leave sibling badges stale.
function invalidateBadgesForTypes(types: Iterable<string>) {
  const keys = new Set<string>(["/api/notifications/unread-count"]);
  for (const type of types) {
    for (const key of badgeKeysForType(type)) keys.add(key);
  }
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

export function NotificationList({ onNavigate }: { onNavigate: (url: string) => void }) {
  const [hasSyncedBadges, setHasSyncedBadges] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const { toast } = useToast();
  const { data: notifications = [], isLoading } = useQuery<UserNotification[]>({
    queryKey: ["/api/notifications"],
    refetchInterval: 30000,
  });

  const dismissMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(
        ids.map((id) => apiRequest("PATCH", `/api/notifications/${id}/dismiss`)),
      );
    },
    onMutate: async (ids: string[]) => {
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      await queryClient.cancelQueries({ queryKey: ["/api/notifications/unread-count"] });
      const prevList = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]);
      const prevCount = queryClient.getQueryData<{ count: number }>(["/api/notifications/unread-count"]);
      const idSet = new Set(ids);
      const removedUnread = (prevList ?? []).filter((n) => idSet.has(n.id) && !n.readAt).length;
      queryClient.setQueryData<UserNotification[]>(["/api/notifications"], (old) =>
        (old ?? []).filter((n) => !idSet.has(n.id)),
      );
      if (removedUnread > 0) {
        queryClient.setQueryData<{ count: number }>(["/api/notifications/unread-count"], (old) => ({
          count: Math.max(0, (old?.count ?? 0) - removedUnread),
        }));
      }
      return { prevList, prevCount };
    },
    onError: (_err, _ids, ctx) => {
      if (ctx?.prevList) queryClient.setQueryData(["/api/notifications"], ctx.prevList);
      if (ctx?.prevCount) queryClient.setQueryData(["/api/notifications/unread-count"], ctx.prevCount);
      toast({ title: "Couldn't dismiss notification", description: "We'll put it back. Try again in a moment.", variant: "destructive" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/notifications/mark-all-read");
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["/api/notifications"] });
      await queryClient.cancelQueries({ queryKey: ["/api/notifications/unread-count"] });
      const prevList = queryClient.getQueryData<UserNotification[]>(["/api/notifications"]);
      const prevCount = queryClient.getQueryData<{ count: number }>(["/api/notifications/unread-count"]);
      const now = new Date().toISOString();
      queryClient.setQueryData<UserNotification[]>(["/api/notifications"], (old) =>
        (old ?? []).map((n) => (n.readAt ? n : { ...n, readAt: now })),
      );
      queryClient.setQueryData<{ count: number }>(["/api/notifications/unread-count"], { count: 0 });
      return { prevList, prevCount };
    },
    onError: (_err, _v, ctx) => {
      if (ctx?.prevList) queryClient.setQueryData(["/api/notifications"], ctx.prevList);
      if (ctx?.prevCount) queryClient.setQueryData(["/api/notifications/unread-count"], ctx.prevCount);
      toast({ title: "Couldn't clear notifications", description: "Please try again.", variant: "destructive" });
    },
    onSettled: () => {
      for (const key of RELATED_BADGE_KEYS) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
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
          for (const key of RELATED_BADGE_KEYS) {
            queryClient.invalidateQueries({ queryKey: [key] });
          }
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

  const groupedNotifications: GroupedNotification[] = groupNotifications(notifications);

  const handleDismissGroup = (e: React.MouseEvent, group: GroupedNotification) => {
    e.stopPropagation();
    hapticLight();
    const ids = group.notifications.map((n) => n.id);
    dismissMutation.mutate(ids);
    invalidateBadgesForTypes(group.notifications.map((n) => n.type));
  };

  const openNotification = (notif: UserNotification) => {
    dismissMutation.mutate([notif.id]);
    invalidateBadgesForTypes([notif.type]);
    if (notif.url) {
      onNavigate(notif.url);
    }
  };

  const handleTapGroup = (group: GroupedNotification) => {
    hapticLight();
    if (group.count > 1) {
      setExpandedKeys((prev) => {
        const next = new Set(prev);
        if (next.has(group.key)) next.delete(group.key);
        else next.add(group.key);
        return next;
      });
      return;
    }
    openNotification(group.latest);
  };

  const handleOpenItem = (notif: UserNotification) => {
    hapticLight();
    openNotification(notif);
  };

  const handleDismissItem = (e: React.MouseEvent, notif: UserNotification) => {
    e.stopPropagation();
    hapticLight();
    dismissMutation.mutate([notif.id]);
    invalidateBadgesForTypes([notif.type]);
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
            <AnimatePresence initial={false}>
              {groupedNotifications.map(group => {
                const notif = group.latest;
                const Icon = getIcon(notif.type);
                const isUnread = group.notifications.some(n => !n.readAt);
                const isExpandable = group.count > 1;
                const isExpanded = isExpandable && expandedKeys.has(group.key);
                return (
                  <motion.div
                    key={group.key}
                    layout
                    initial={false}
                    exit={{ opacity: 0, x: 32, height: 0, marginTop: 0, marginBottom: 0, paddingTop: 0, paddingBottom: 0 }}
                    transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpandable ? isExpanded : undefined}
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
                          {group.count > 1
                            ? notif.type === "message"
                              ? `${group.count} new messages`
                              : `${group.count} updates`
                            : notif.body}
                        </p>
                        <p className="text-[10px] text-muted-foreground/60 mt-1">
                          {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                        </p>
                      </div>
                      {isExpandable && (
                        <ChevronDown
                          className={`flex-shrink-0 w-4 h-4 text-muted-foreground mt-1 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          data-testid={`chevron-group-${group.key}`}
                        />
                      )}
                      <button
                        onClick={(e) => handleDismissGroup(e, group)}
                        className="flex-shrink-0 p-1 rounded-md hover:bg-muted tap-interactive mt-0.5"
                        data-testid={`button-dismiss-${group.key}`}
                        aria-label="Dismiss all"
                      >
                        <X className="w-3.5 h-3.5 text-muted-foreground" />
                      </button>
                    </div>
                    <AnimatePresence initial={false}>
                      {isExpanded && (
                        <motion.div
                          key={`${group.key}-items`}
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                          style={{ overflow: "hidden" }}
                          className="bg-muted/20"
                        >
                          <div className="divide-y divide-border/50">
                            {group.notifications.map(item => {
                              const ItemIcon = getIcon(item.type);
                              const itemUnread = !item.readAt;
                              return (
                                <div
                                  key={item.id}
                                  role="button"
                                  tabIndex={0}
                                  onClick={() => handleOpenItem(item)}
                                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleOpenItem(item); } }}
                                  className={`flex items-start gap-3 w-full pl-10 pr-4 py-2.5 text-left transition-colors tap-interactive hover:bg-muted/50 cursor-pointer ${itemUnread ? "bg-primary/5" : ""}`}
                                  data-testid={`notification-subitem-${item.id}`}
                                >
                                  <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${itemUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                                    <ItemIcon className="w-3 h-3" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-xs leading-tight ${itemUnread ? "font-medium" : "text-muted-foreground"}`}>{item.title}</p>
                                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.body}</p>
                                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                                      {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
                                    </p>
                                  </div>
                                  <button
                                    onClick={(e) => handleDismissItem(e, item)}
                                    className="flex-shrink-0 p-1 rounded-md hover:bg-muted tap-interactive mt-0.5"
                                    data-testid={`button-dismiss-item-${item.id}`}
                                    aria-label="Dismiss notification"
                                  >
                                    <X className="w-3 h-3 text-muted-foreground" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
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
    navigateAcrossApps(url, navigate);
  };

  const bellButton = (
    <button
      onClick={() => { hapticLight(); setOpen(true); }}
      className="relative p-2 rounded-md hover:bg-sidebar-accent tap-interactive transition-colors"
      data-testid="button-notification-bell"
    >
      <Bell className="w-5 h-5 text-sidebar-foreground/80" />
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
          <SheetContent
            side="bottom"
            className="rounded-t-2xl px-0 pt-3 pb-4 max-h-[80vh] data-[state=open]:duration-200 data-[state=closed]:duration-150"
          >
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
