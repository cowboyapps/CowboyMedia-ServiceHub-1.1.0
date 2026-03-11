import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { Activity, AlertTriangle, Bell, CheckCircle, Clock, Newspaper, Ticket } from "lucide-react";
import type { Service, ServiceAlert, NewsStory, Ticket as TicketType, ServiceUpdate } from "@shared/schema";
import { format } from "date-fns";
import { LazyImage } from "@/components/lazy-image";

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    operational: "bg-status-online",
    degraded: "bg-status-away",
    outage: "bg-status-busy",
    maintenance: "bg-status-offline",
  };
  const isActive = status !== "operational";
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[status] || "bg-status-offline"} ${isActive ? "animate-status-pulse" : ""}`} />;
}

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    critical: "destructive",
    warning: "default",
    info: "secondary",
  };
  return <Badge variant={variants[severity] || "secondary"} className="text-xs">{severity}</Badge>;
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data: services, isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: alerts, isLoading: alertsLoading } = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
  });

  const { data: news, isLoading: newsLoading } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
  });

  const { data: tickets, isLoading: ticketsLoading } = useQuery<TicketType[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: serviceUpdates, isLoading: serviceUpdatesLoading } = useQuery<ServiceUpdate[]>({
    queryKey: ["/api/service-updates"],
  });

  const activeAlerts = alerts?.filter((a) => a.status !== "resolved") || [];
  const subscribedServices = services?.filter((s) =>
    user?.subscribedServices?.includes(s.id)
  ) || [];
  const displayServices = subscribedServices.length > 0 ? subscribedServices : services || [];
  const myTickets = tickets?.filter((t) => t.status === "open") || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">
          Welcome, {user?.fullName}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">Here's an overview of your services and recent activity</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <Link href="/services" data-testid="link-stat-services">
          <Card className="cursor-pointer hover-elevate tap-interactive transition-shadow">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center">
                <Activity className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-services-count">{servicesLoading ? "-" : displayServices.length}</p>
                <p className="text-xs text-muted-foreground">Services</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/alerts" data-testid="link-stat-alerts">
          <Card className="cursor-pointer hover-elevate tap-interactive transition-shadow">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-md bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-alerts-count">{alertsLoading ? "-" : activeAlerts.length}</p>
                <p className="text-xs text-muted-foreground">Active Alerts</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/tickets" data-testid="link-stat-tickets">
          <Card className="cursor-pointer hover-elevate tap-interactive transition-shadow">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-md bg-chart-5/10 flex items-center justify-center">
                <Ticket className="w-5 h-5 text-chart-5" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-tickets-count">{ticketsLoading ? "-" : myTickets.length}</p>
                <p className="text-xs text-muted-foreground">Open Tickets</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/news" data-testid="link-stat-news">
          <Card className="cursor-pointer hover-elevate tap-interactive transition-shadow">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-md bg-chart-2/10 flex items-center justify-center">
                <Newspaper className="w-5 h-5 text-chart-2" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-news-count">{newsLoading ? "-" : (news?.length || 0)}</p>
                <p className="text-xs text-muted-foreground">News Stories</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/service-updates" data-testid="link-stat-service-updates">
          <Card className="cursor-pointer hover-elevate tap-interactive transition-shadow">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="w-10 h-10 rounded-md bg-chart-3/10 flex items-center justify-center">
                <Bell className="w-5 h-5 text-chart-3" />
              </div>
              <div>
                <p className="text-2xl font-bold" data-testid="text-service-updates-count">{serviceUpdatesLoading ? "-" : (serviceUpdates?.length || 0)}</p>
                <p className="text-xs text-muted-foreground">Service Updates</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Service Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {servicesLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between gap-2 py-1.5">
                  <div className="flex items-center gap-2.5">
                    <Skeleton className="w-3 h-3 rounded-full" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))
            ) : displayServices.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No services to display</p>
            ) : (
              displayServices.map((service) => (
                <div key={service.id} className="flex items-center justify-between gap-2 py-1.5" data-testid={`service-row-${service.id}`}>
                  <div className="flex items-center gap-2.5">
                    <StatusIndicator status={service.status} />
                    <span className="text-sm font-medium">{service.name}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs capitalize">{service.status}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Active Alerts</CardTitle>
            <Link href="/alerts">
              <Button variant="ghost" size="sm" data-testid="link-view-all-alerts">View All</Button>
            </Link>
          </CardHeader>
          <CardContent className="space-y-3">
            {alertsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-start justify-between gap-2 py-1.5">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-36" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              ))
            ) : activeAlerts.length === 0 ? (
              <div className="text-center py-6">
                <CheckCircle className="w-8 h-8 text-status-online mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">All systems operational</p>
              </div>
            ) : (
              activeAlerts.slice(0, 4).map((alert) => (
                <Link key={alert.id} href={`/alerts/${alert.id}`}>
                  <div className="flex items-start justify-between gap-2 py-1.5 hover-elevate tap-interactive rounded-md px-2 -mx-2 cursor-pointer" data-testid={`alert-row-${alert.id}`}>
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium">{alert.title}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {format(new Date(alert.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                    <SeverityBadge severity={alert.severity} />
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
          <CardTitle className="text-base">Latest News</CardTitle>
          <Link href="/news">
            <Button variant="ghost" size="sm" data-testid="link-view-all-news">View All</Button>
          </Link>
        </CardHeader>
        <CardContent>
          {newsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 py-2">
                  <Skeleton className="w-16 h-12 rounded-md flex-shrink-0" />
                  <div className="space-y-1.5 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                </div>
              ))}
            </div>
          ) : !news || news.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No news stories yet</p>
          ) : (
            <div className="space-y-3">
              {news.slice(0, 3).map((story) => (
                <Link key={story.id} href={`/news/${story.id}`}>
                  <div className="flex items-start gap-3 py-2 hover-elevate tap-interactive rounded-md px-2 -mx-2 cursor-pointer" data-testid={`news-row-${story.id}`}>
                    {story.imageUrl && (
                      <LazyImage src={story.imageUrl} alt="" className="w-16 h-12 rounded-md object-cover flex-shrink-0" />
                    )}
                    <div className="space-y-0.5 min-w-0">
                      <p className="text-sm font-medium truncate">{story.title}</p>
                      <p className="text-xs text-muted-foreground line-clamp-1">{story.content}</p>
                      <p className="text-xs text-muted-foreground">{format(new Date(story.createdAt), "MMM d, yyyy")}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
