import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, MessageSquare, AlertTriangle, Newspaper, Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { hapticLight } from "@/lib/haptics";

export function BottomNav() {
  const isMobile = useIsMobile();
  const [location] = useLocation();
  const { setOpenMobile } = useSidebar();
  const { user } = useAuth();

  const { data: ticketNotifData } = useQuery<{ count: number }>({
    queryKey: ["/api/ticket-notifications/unread-count"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const unreadTicketCount = ticketNotifData?.count ?? 0;

  const { data: messageData } = useQuery<{ count: number }>({
    queryKey: ["/api/private-messages/unread-count"],
    refetchInterval: 15000,
    enabled: !!user,
  });

  const { data: reportNotifData } = useQuery<{ count: number }>({
    queryKey: ["/api/report-notifications/unread-count"],
    refetchInterval: 15000,
    enabled: !!user,
  });

  const { data: contentNotifData } = useQuery<Record<string, number>>({
    queryKey: ["/api/content-notifications/counts"],
    refetchInterval: 15000,
    enabled: !!user,
  });

  const moreBadgeCount =
    (messageData?.count ?? 0) +
    (reportNotifData?.count ?? 0) +
    Object.values(contentNotifData ?? {}).reduce((sum, c) => sum + c, 0);

  if (!isMobile) return null;

  const tabs = [
    { label: "Services", icon: Activity, path: "/services" },
    { label: "Tickets", icon: MessageSquare, path: "/tickets", badge: unreadTicketCount },
    { label: "Alerts", icon: AlertTriangle, path: "/alerts" },
    { label: "News", icon: Newspaper, path: "/news" },
    { label: "More", icon: Menu, path: null, badge: moreBadgeCount },
  ];

  const isActive = (path: string | null) => {
    if (!path) return false;
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      data-testid="nav-bottom"
    >
      <div className="flex items-center justify-around h-14">
        {tabs.map((tab) => {
          const active = isActive(tab.path);
          const Icon = tab.icon;

          if (tab.path === null) {
            return (
              <button
                key={tab.label}
                onClick={() => {
                  hapticLight();
                  setOpenMobile(true);
                }}
                className="flex flex-col items-center justify-center flex-1 h-full relative tap-interactive"
                data-testid="button-bottom-nav-more"
              >
                <div className="relative">
                  <Icon className={`w-5 h-5 text-muted-foreground`} />
                  {(tab.badge ?? 0) > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-destructive rounded-full" data-testid="badge-bottom-nav-more" />
                  )}
                </div>
                <span className="text-[10px] mt-0.5 text-muted-foreground">{tab.label}</span>
              </button>
            );
          }

          return (
            <Link
              key={tab.label}
              href={tab.path}
              onClick={() => hapticLight()}
              className="flex flex-col items-center justify-center flex-1 h-full relative tap-interactive no-underline"
              data-testid={`link-bottom-nav-${tab.label.toLowerCase()}`}
            >
              <div className="relative">
                <Icon className={`w-5 h-5 ${active ? "text-primary" : "text-muted-foreground"}`} />
                {(tab.badge ?? 0) > 0 && (
                  <span className="absolute -top-1.5 -right-2 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1" data-testid={`badge-bottom-nav-${tab.label.toLowerCase()}`}>
                    {tab.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] mt-0.5 ${active ? "text-primary font-medium" : "text-muted-foreground"}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
