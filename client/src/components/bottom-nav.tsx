import { useState, useEffect, Fragment } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, MessageSquare, AlertTriangle, Newspaper, Menu, RefreshCw, Mail, FileText, Settings, Shield, LogOut } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/lib/auth";
import { hapticLight } from "@/lib/haptics";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";

export function BottomNav() {
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location]);

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

  const contentCounts = contentNotifData ?? {};
  const unreadMessageCount = messageData?.count ?? 0;
  const unreadReportCount = reportNotifData?.count ?? 0;
  const adminBadgeCount = (contentCounts["admin-reports"] ?? 0) + (contentCounts["admin-users"] ?? 0);

  const overflowBadgeCount =
    unreadMessageCount +
    unreadReportCount +
    (contentCounts["service-updates"] ?? 0) +
    (isAdmin ? adminBadgeCount : 0);

  if (!isMobile) return null;

  const tabs = [
    { label: "Services", icon: Activity, path: "/services" },
    { label: "Tickets", icon: MessageSquare, path: "/tickets", badge: unreadTicketCount },
    { label: "Alerts", icon: AlertTriangle, path: "/alerts" },
    { label: "News", icon: Newspaper, path: "/news" },
    { label: "More", icon: Menu, path: null, badge: overflowBadgeCount },
  ];

  const overflowRoutes = ["/service-updates", "/messages", "/report-request", "/settings", "/admin"];

  const isActive = (path: string | null) => {
    if (path === null) return overflowRoutes.some((r) => location === r || location.startsWith(r + "/"));
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  const overflowItems = [
    { title: "Service Updates", url: "/service-updates", icon: RefreshCw, badge: contentCounts["service-updates"] ?? 0 },
    { title: "Messages", url: "/messages", icon: Mail, badge: unreadMessageCount },
    { title: "Report/Request", url: "/report-request", icon: FileText, badge: unreadReportCount },
    { title: "Settings", url: "/settings", icon: Settings, badge: 0 },
  ];

  const adminItems = isAdmin
    ? [{ title: "Admin Portal", url: "/admin", icon: Shield, badge: adminBadgeCount }]
    : [];

  const handleSheetNav = (url: string) => {
    setMoreOpen(false);
    navigate(url);
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 bg-muted border-t"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        data-testid="nav-bottom"
      >
        <div className="flex items-center justify-around h-14">
          {tabs.map((tab, index) => {
            const active = isActive(tab.path);
            const Icon = tab.icon;
            const separator = index < tabs.length - 1 ? (
              <div className="w-px h-[60%] bg-foreground/10 self-center flex-shrink-0" />
            ) : null;

            if (tab.path === null) {
              const moreHighlighted = isActive(null) || moreOpen;
              return (
                <Fragment key={tab.label}>
                  <button
                    onClick={() => {
                      hapticLight();
                      setMoreOpen(true);
                    }}
                    className="flex flex-col items-center justify-center flex-1 h-full relative tap-interactive"
                    data-testid="button-bottom-nav-more"
                  >
                    <div className="relative">
                      <Icon className={`w-5 h-5 ${moreHighlighted ? "text-primary" : "text-muted-foreground"}`} />
                      {(tab.badge ?? 0) > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 w-2.5 h-2.5 bg-destructive rounded-full" data-testid="badge-bottom-nav-more" />
                      )}
                    </div>
                    <span className={`text-[10px] mt-0.5 ${moreHighlighted ? "text-primary font-medium" : "text-muted-foreground"}`}>{tab.label}</span>
                  </button>
                  {separator}
                </Fragment>
              );
            }

            return (
              <Fragment key={tab.label}>
                <Link
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
                {separator}
              </Fragment>
            );
          })}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl px-4 pt-3 pb-4" overlayStyle={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }} style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}>
          <VisuallyHidden>
            <SheetTitle>More Options</SheetTitle>
          </VisuallyHidden>

          <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-4" />

          <div className="space-y-1">
            {[...overflowItems, ...adminItems].map((item) => {
              const Icon = item.icon;
              const active = location === item.url || location.startsWith(item.url);
              return (
                <button
                  key={item.title}
                  onClick={() => handleSheetNav(item.url)}
                  className={`flex items-center gap-3 w-full px-3 py-3 rounded-lg tap-interactive transition-colors ${active ? "bg-primary/10 text-primary" : "hover:bg-muted"}`}
                  data-testid={`sheet-nav-${item.title.toLowerCase().replace(/[\s/]+/g, "-")}`}
                >
                  <Icon className="w-5 h-5 flex-shrink-0" />
                  <span className="flex-1 text-left text-sm font-medium">{item.title}</span>
                  {item.badge > 0 && (
                    <Badge variant="destructive" className="text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid={`badge-sheet-${item.title.toLowerCase().replace(/[\s/]+/g, "-")}`}>
                      {item.badge}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <div className="border-t mt-4 pt-4">
            <div className="flex items-center gap-3 px-3">
              <Avatar className="w-9 h-9">
                <AvatarFallback className="text-xs">{user?.fullName?.[0] || "U"}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user?.fullName}</p>
                <p className="text-xs text-muted-foreground capitalize">{user?.role?.replace("_", " ")}</p>
              </div>
              <button
                onClick={() => { setMoreOpen(false); logout(); }}
                className="p-2 rounded-md hover:bg-muted tap-interactive"
                data-testid="button-sheet-logout"
              >
                <LogOut className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground/60 text-center mt-3" data-testid="text-sheet-version">Version 1.1.0</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
