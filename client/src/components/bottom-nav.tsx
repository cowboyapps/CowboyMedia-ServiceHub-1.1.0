import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Activity, MessageSquare, AlertTriangle, Newspaper, Menu, RefreshCw, Mail, FileText, Settings, Shield, LogOut, Download, Users, BookOpen, CreditCard, Server, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useAuth } from "@/lib/auth";
import { hapticLight } from "@/lib/haptics";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { APP_VERSION } from "@shared/version";

export function BottomNav() {
  const isMobile = useIsMobile();
  const [location, navigate] = useLocation();
  const { user, logout, isAdmin } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  // Hide the nav while the on-screen keyboard is open: on iOS the fixed bar
  // would otherwise float mid-screen above the keyboard.
  const keyboardInset = useKeyboardInset();

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
    queryKey: ["/api/message-threads/unread-count"],
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

  if (!isMobile || keyboardInset > 0) return null;

  const tabs = [
    { label: "Services", icon: Activity, path: "/services" },
    { label: "Tickets", icon: MessageSquare, path: "/tickets", badge: unreadTicketCount },
    { label: "Alerts", icon: AlertTriangle, path: "/alerts" },
    { label: "News", icon: Newspaper, path: "/news" },
    { label: "More", icon: Menu, path: null, badge: overflowBadgeCount },
  ];

  const overflowRoutes = ["/service-updates", "/messages", "/community", "/report-request", "/downloads", "/knowledge", "/my-services", "/billing", "/settings", "/admin"];

  const isActive = (path: string | null) => {
    if (path === null) return overflowRoutes.some((r) => location === r || location.startsWith(r + "/"));
    if (path === "/") return location === "/";
    return location.startsWith(path);
  };

  // iOS-Settings-style grouped menu: each group renders as an inset rounded
  // card of rows (colored icon tile · label · badge · chevron), separated by
  // hairline dividers, under a small uppercase section header.
  const menuGroups: { label: string; items: { title: string; url: string; icon: typeof Mail; badge: number; tileBg: string; tileFg: string }[] }[] = [
    {
      label: "Stay informed",
      items: [
        { title: "Service Updates", url: "/service-updates", icon: RefreshCw, badge: contentCounts["service-updates"] ?? 0, tileBg: "bg-sky-500/15 dark:bg-sky-400/15", tileFg: "text-sky-600 dark:text-sky-400" },
        { title: "Messages", url: "/messages", icon: Mail, badge: unreadMessageCount, tileBg: "bg-blue-500/15 dark:bg-blue-400/15", tileFg: "text-blue-600 dark:text-blue-400" },
        { title: "Community Chat", url: "/community", icon: Users, badge: 0, tileBg: "bg-indigo-500/15 dark:bg-indigo-400/15", tileFg: "text-indigo-600 dark:text-indigo-400" },
      ],
    },
    {
      label: "Help & support",
      items: [
        { title: "Report/Request", url: "/report-request", icon: FileText, badge: unreadReportCount, tileBg: "bg-amber-500/15 dark:bg-amber-400/15", tileFg: "text-amber-600 dark:text-amber-400" },
        { title: "Knowledge Base", url: "/knowledge", icon: BookOpen, badge: 0, tileBg: "bg-teal-500/15 dark:bg-teal-400/15", tileFg: "text-teal-600 dark:text-teal-400" },
        { title: "Downloads", url: "/downloads", icon: Download, badge: 0, tileBg: "bg-emerald-500/15 dark:bg-emerald-400/15", tileFg: "text-emerald-600 dark:text-emerald-400" },
      ],
    },
    {
      label: "Account",
      items: [
        { title: "My Services", url: "/my-services", icon: Server, badge: 0, tileBg: "bg-violet-500/15 dark:bg-violet-400/15", tileFg: "text-violet-600 dark:text-violet-400" },
        { title: "Billing", url: "/billing", icon: CreditCard, badge: 0, tileBg: "bg-rose-500/15 dark:bg-rose-400/15", tileFg: "text-rose-600 dark:text-rose-400" },
        { title: "Settings", url: "/settings", icon: Settings, badge: 0, tileBg: "bg-slate-500/15 dark:bg-slate-400/15", tileFg: "text-slate-600 dark:text-slate-400" },
      ],
    },
    ...(isAdmin
      ? [{
          label: "Admin",
          items: [
            { title: "Admin Portal", url: "/admin", icon: Shield, badge: adminBadgeCount, tileBg: "bg-orange-500/15 dark:bg-orange-400/15", tileFg: "text-orange-600 dark:text-orange-400" },
          ],
        }]
      : []),
  ];

  const handleSheetNav = (url: string) => {
    setMoreOpen(false);
    navigate(url);
  };

  return (
    <>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-border/60 bg-background/80 backdrop-blur-xl supports-[not(backdrop-filter:blur(0px))]:bg-background"
        style={{ paddingBottom: "var(--sab, env(safe-area-inset-bottom, 0px))" }}
        data-testid="nav-bottom"
      >
        <div className="flex items-center justify-around h-14">
          {tabs.map((tab) => {
            const active = isActive(tab.path);
            const Icon = tab.icon;
            if (tab.path === null) {
              const moreHighlighted = isActive(null) || moreOpen;
              return (
                <button
                  key={tab.label}
                  onClick={() => {
                    hapticLight();
                    setMoreOpen(true);
                  }}
                  className="group flex flex-col items-center justify-center flex-1 h-full relative tap-interactive"
                  data-testid="button-bottom-nav-more"
                >
                  <div className={`relative flex items-center justify-center rounded-full px-4 py-1 transition-all duration-200 ease-out group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100 ${moreHighlighted ? "bg-primary/10 dark:bg-primary/20" : "bg-transparent"}`}>
                    <Icon className={`w-[22px] h-[22px] ${moreHighlighted ? "text-primary" : "text-muted-foreground"}`} strokeWidth={moreHighlighted ? 2.4 : 2} />
                    {(tab.badge ?? 0) > 0 && (
                      <span className="absolute -top-1 right-2 w-2.5 h-2.5 bg-destructive rounded-full" data-testid="badge-bottom-nav-more" />
                    )}
                  </div>
                  <span className={`text-[10px] mt-0.5 ${moreHighlighted ? "text-primary font-semibold" : "text-muted-foreground"}`}>{tab.label}</span>
                </button>
              );
            }

            return (
              <Link
                key={tab.label}
                href={tab.path}
                onClick={() => hapticLight()}
                className="group flex flex-col items-center justify-center flex-1 h-full relative tap-interactive no-underline"
                data-testid={`link-bottom-nav-${tab.label.toLowerCase()}`}
              >
                <div className={`relative flex items-center justify-center rounded-full px-4 py-1 transition-all duration-200 ease-out group-active:scale-90 motion-reduce:transition-none motion-reduce:group-active:scale-100 ${active ? "bg-primary/10 dark:bg-primary/20" : "bg-transparent"}`}>
                  <Icon className={`w-[22px] h-[22px] ${active ? "text-primary" : "text-muted-foreground"}`} strokeWidth={active ? 2.4 : 2} />
                  {(tab.badge ?? 0) > 0 && (
                    <span className="absolute -top-1 -right-0.5 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1" data-testid={`badge-bottom-nav-${tab.label.toLowerCase()}`}>
                      {tab.badge}
                    </span>
                  )}
                </div>
                <span className={`text-[10px] mt-0.5 ${active ? "text-primary font-semibold" : "text-muted-foreground"}`}>{tab.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl bg-muted/60 dark:bg-background px-4 pt-3 pb-4 max-h-[80dvh] overflow-y-auto" overlayStyle={{ bottom: "calc(3.5rem + var(--sab, env(safe-area-inset-bottom, 0px)))" }} style={{ bottom: "calc(3.5rem + var(--sab, env(safe-area-inset-bottom, 0px)))" }}>
          <VisuallyHidden>
            <SheetTitle>More Options</SheetTitle>
          </VisuallyHidden>

          <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mx-auto mb-4" />

          {/* Profile header — iOS Settings style */}
          <div className="rounded-xl border border-card-border bg-card shadow-sm px-3 py-3 flex items-center gap-3 mb-4" data-testid="sheet-profile-header">
            <Avatar className="w-11 h-11">
              <AvatarFallback className="text-sm font-semibold">{user?.fullName?.[0] || "U"}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold truncate" data-testid="text-sheet-profile-name">{user?.fullName}</p>
              <p className="text-xs text-muted-foreground truncate" data-testid="text-sheet-profile-email">{user?.email || user?.role?.replace("_", " ")}</p>
            </div>
          </div>

          <div className="space-y-4">
            {menuGroups.map((group) => (
              <div key={group.label} data-testid={`sheet-group-${group.label.toLowerCase().replace(/[\s&/]+/g, "-")}`}>
                <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 px-2">
                  {group.label}
                </h3>
                <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden divide-y divide-border/60">
                  {group.items.map((item) => {
                    const Icon = item.icon;
                    const active = location === item.url || location.startsWith(item.url + "/");
                    return (
                      <button
                        key={item.title}
                        onClick={() => handleSheetNav(item.url)}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none active:bg-accent/70 ${active ? "bg-primary/5" : "hover:bg-accent/50"}`}
                        data-testid={`sheet-nav-${item.title.toLowerCase().replace(/[\s/]+/g, "-")}`}
                      >
                        <div className={`rounded-lg p-2 shrink-0 ${item.tileBg}`}>
                          <Icon className={`w-[18px] h-[18px] ${item.tileFg}`} />
                        </div>
                        <span className={`flex-1 min-w-0 text-sm font-medium truncate ${active ? "text-primary" : ""}`}>{item.title}</span>
                        {item.badge > 0 && (
                          <Badge variant="destructive" className="shrink-0 text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid={`badge-sheet-${item.title.toLowerCase().replace(/[\s/]+/g, "-")}`}>
                            {item.badge}
                          </Badge>
                        )}
                        <ChevronRight aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground/40" />
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}

            {/* Sign out — its own red row, iOS style */}
            <div className="rounded-xl border border-card-border bg-card shadow-sm overflow-hidden">
              <button
                onClick={() => { setMoreOpen(false); logout(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors motion-reduce:transition-none hover:bg-destructive/5 active:bg-destructive/10"
                data-testid="button-sheet-logout"
              >
                <div className="rounded-lg p-2 shrink-0 bg-red-500/15 dark:bg-red-400/15">
                  <LogOut className="w-[18px] h-[18px] text-red-600 dark:text-red-400" />
                </div>
                <span className="flex-1 text-sm font-medium text-red-600 dark:text-red-400">Sign Out</span>
              </button>
            </div>
          </div>

          <p className="text-[10px] text-muted-foreground/60 text-center mt-4" data-testid="text-sheet-version">Version {APP_VERSION}</p>
        </SheetContent>
      </Sheet>
    </>
  );
}
