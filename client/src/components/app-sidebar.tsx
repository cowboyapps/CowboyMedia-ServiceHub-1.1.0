import { useAuth } from "@/lib/auth";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LayoutDashboard, Activity, AlertTriangle, Newspaper, MessageSquare, Settings as SettingsIcon, Shield, LogOut, Mail, FileText, RefreshCw, Download, Users, BookOpen, Globe, ExternalLink, CreditCard, Server, BadgePercent } from "lucide-react";
import { BrandLogo } from "@/components/brand-logo";
import { APP_VERSION } from "@shared/version";

const categoryMap: Record<string, string> = {
  "Services": "services",
  "Alerts": "alerts",
  "News": "news",
  "Service Updates": "service-updates",
  "Admin Portal": "admin-reports",
};

export function AppSidebar() {
  const { user, logout, isAdmin, hasPermission } = useAuth();
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/message-threads/unread-count"],
    refetchInterval: 30000,
    enabled: !!user,
  });
  const unreadCount = unreadData?.count ?? 0;

  const { data: ticketNotifData } = useQuery<{ count: number }>({
    queryKey: ["/api/ticket-notifications/unread-count"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const unreadTicketCount = ticketNotifData?.count ?? 0;

  const { data: reportNotifData } = useQuery<{ count: number }>({
    queryKey: ["/api/report-notifications/unread-count"],
    refetchInterval: 30000,
    enabled: !!user && user.role !== "admin" && user.role !== "master_admin",
  });
  const unreadReportCount = reportNotifData?.count ?? 0;

  const { data: contentNotifData } = useQuery<Record<string, number>>({
    queryKey: ["/api/content-notifications/counts"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const contentCounts = contentNotifData ?? {};

  const { data: errorLogData } = useQuery<{ count: number }>({
    queryKey: ["/api/admin/error-logs/unresolved-count"],
    refetchInterval: 60000,
    enabled: !!user && isAdmin && hasPermission("error_log.view"),
  });
  const unresolvedErrorCount = errorLogData?.count ?? 0;

  const { data: awayStatus } = useQuery<{ isActive: boolean }>({
    queryKey: ["/api/support-away/status"],
    refetchInterval: 60000,
    enabled: !!user && isAdmin,
  });
  const awayActive = !!awayStatus?.isActive;

  const handleNavClick = () => {
    if (isMobile) {
      requestAnimationFrame(() => {
        setOpenMobile(false);
      });
    }
  };

  const getBadgeCount = (title: string): number => {
    if (title === "Tickets") return unreadTicketCount;
    if (title === "Messages") return unreadCount;
    if (title === "Report/Request") return unreadReportCount;
    if (title === "Admin Portal") return (contentCounts["admin-reports"] ?? 0) + (contentCounts["admin-users"] ?? 0) + unresolvedErrorCount;
    const cat = categoryMap[title];
    if (cat) return contentCounts[cat] ?? 0;
    return 0;
  };

  const customerItems = [
    { title: "Dashboard", url: "/", icon: LayoutDashboard },
    { title: "Services", url: "/services", icon: Activity },
    { title: "Alerts", url: "/alerts", icon: AlertTriangle },
    { title: "News", url: "/news", icon: Newspaper },
    { title: "Promotions", url: "/promotions", icon: BadgePercent },
    { title: "Service Updates", url: "/service-updates", icon: RefreshCw },
    { title: "Tickets", url: "/tickets", icon: MessageSquare },
    { title: "Messages", url: "/messages", icon: Mail },
    { title: "Community Chat", url: "/community", icon: Users },
    { title: "Report/Request", url: "/report-request", icon: FileText },
    { title: "Downloads", url: "/downloads", icon: Download },
    { title: "Knowledge Base", url: "/knowledge", icon: BookOpen },
    { title: "My Services", url: "/my-services", icon: Server },
    { title: "Billing", url: "/billing", icon: CreditCard },
    { title: "Settings", url: "/settings", icon: SettingsIcon },
  ];

  const adminItems = [
    { title: "Admin Portal", url: "/admin", icon: Shield },
    { title: "Public Status Page", url: "/status", icon: Globe, external: true },
  ];

  return (
    <Sidebar>
      <SidebarHeader className="p-4">
        <div className="flex items-center gap-2.5">
          <BrandLogo className="h-28 flex-shrink-0" />
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {customerItems.map((item) => {
                const badge = getBadgeCount(item.title);
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild isActive={location === item.url || (item.url !== "/" && location.startsWith(item.url))}>
                      <Link href={item.url} onClick={handleNavClick} data-testid={`nav-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                        <item.icon className="w-4 h-4" />
                        <span className="flex-1">{item.title}</span>
                        {badge > 0 && (
                          <Badge variant="destructive" className="ml-auto text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid={`badge-unread-${item.title.toLowerCase().replace(/\//g, "-")}`}>
                            {badge}
                          </Badge>
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => {
                  const badge = getBadgeCount(item.title);
                  const testId = `nav-${item.title.toLowerCase().replace(/\s/g, "-")}`;
                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={!item.external && (location === item.url || location.startsWith(item.url))}>
                        {item.external ? (
                          <a href={item.url} target="_blank" rel="noopener noreferrer" onClick={handleNavClick} data-testid={testId}>
                            <item.icon className="w-4 h-4" />
                            <span className="flex-1">{item.title}</span>
                            <ExternalLink className="w-3 h-3 opacity-60" />
                          </a>
                        ) : (
                          <Link href={item.url} onClick={handleNavClick} data-testid={testId}>
                            <item.icon className="w-4 h-4" />
                            <span className="flex-1">{item.title}</span>
                            {item.title === "Admin Portal" && awayActive && (
                              <Badge
                                className="ml-auto text-[10px] h-5 px-1.5 bg-orange-500 hover:bg-orange-500 text-white"
                                data-testid="badge-sidebar-away-active"
                              >
                                Away
                              </Badge>
                            )}
                            {badge > 0 && (
                              <Badge variant="destructive" className="ml-auto text-[10px] h-5 min-w-5 flex items-center justify-center px-1" data-testid="badge-unread-admin-reports">
                                {badge}
                              </Badge>
                            )}
                          </Link>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className="p-4 space-y-2">
        <div className="flex items-center gap-2.5">
          <Avatar className="w-8 h-8">
            <AvatarFallback className="text-xs">{user?.fullName?.[0] || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user?.fullName}</p>
            <p className="text-xs text-muted-foreground capitalize">{user?.role}</p>
          </div>
          <Button size="icon" variant="ghost" onClick={logout} data-testid="button-logout">
            <LogOut className="w-4 h-4" />
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground/60 text-center" data-testid="text-sidebar-version">Version {APP_VERSION}</p>
      </SidebarFooter>
    </Sidebar>
  );
}
