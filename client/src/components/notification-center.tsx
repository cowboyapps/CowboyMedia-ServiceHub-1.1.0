import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell, X, Mail, MessageSquare, AlertTriangle, Newspaper, Activity, FileText, RefreshCw, CheckCheck } from "lucide-react";
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
};

function getIcon(type: string) {
  return typeIcons[type] || Bell;
}

function invalidateRelatedBadges(type: string) {
  const keys: string[] = ["/api/notifications/unread-count"];
  if (type === "ticket_update") keys.push("/api/ticket-notifications/unread-count");
  if (type === "message") keys.push("/api/message-threads/unread-count");
  if (type === "report_update") keys.push("/api/report-notifications/unread-count");
  if (["alert", "news", "service_status", "service_update"].includes(type)) keys.push("/api/content-notifications/counts");
  for (const key of keys) {
    queryClient.invalidateQueries({ queryKey: [key] });
  }
}

function NotificationList({ onNavigate }: { onNavigate: (url: string) => void }) {
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

  const handleTap = (notif: UserNotification) => {
    hapticLight();
    if (!notif.readAt) {
      markReadMutation.mutate(notif.id);
      invalidateRelatedBadges(notif.type);
    }
    if (notif.url) {
      onNavigate(notif.url);
    }
  };

  const handleDismiss = (e: React.MouseEvent, notif: UserNotification) => {
    e.stopPropagation();
    hapticLight();
    dismissMutation.mutate(notif.id);
    invalidateRelatedBadges(notif.type);
  };

  const handleMarkAllRead = () => {
    hapticMedium();
    markAllReadMutation.mutate();
  };

  const unreadCount = notifications.filter(n => !n.readAt).length;

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

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b">
        <h3 className="text-sm font-semibold" data-testid="text-notifications-title">Notifications</h3>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs h-7 gap-1"
            onClick={handleMarkAllRead}
            disabled={markAllReadMutation.isPending}
            data-testid="button-mark-all-read"
          >
            <CheckCheck className="w-3.5 h-3.5" />
            Mark all read
          </Button>
        )}
      </div>
      <ScrollArea className="max-h-[60vh] md:max-h-[400px]">
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-4 text-muted-foreground">
            <Bell className="w-10 h-10 mb-2 opacity-40" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="divide-y">
            {notifications.map(notif => {
              const Icon = getIcon(notif.type);
              const isUnread = !notif.readAt;
              return (
                <div
                  key={notif.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => handleTap(notif)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTap(notif); } }}
                  className={`flex items-start gap-3 w-full px-4 py-3 text-left transition-colors tap-interactive hover:bg-muted/50 cursor-pointer ${isUnread ? "bg-primary/5" : ""}`}
                  data-testid={`notification-item-${notif.id}`}
                >
                  <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center mt-0.5 ${isUnread ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-tight ${isUnread ? "font-medium" : "text-muted-foreground"}`}>{notif.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{notif.body}</p>
                    <p className="text-[10px] text-muted-foreground/60 mt-1">
                      {formatDistanceToNow(new Date(notif.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <button
                    onClick={(e) => handleDismiss(e, notif)}
                    className="flex-shrink-0 p-1 rounded-md hover:bg-muted tap-interactive mt-0.5"
                    data-testid={`button-dismiss-${notif.id}`}
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

  const isCustomer = user?.role === "customer";

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
    refetchInterval: 15000,
    enabled: !!user && isCustomer,
  });
  const unreadCount = unreadData?.count ?? 0;

  if (!isCustomer) return null;

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
