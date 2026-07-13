import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle,
  ChevronRight,
  Clock,
  Newspaper,
  Ticket,
  XCircle,
} from "lucide-react";
import type { Service, ServiceAlertWithServices, NewsStory, Ticket as TicketType } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { QueryErrorState } from "@/components/query-error-state";

type DailyStatus = "up" | "partial" | "down" | "unknown";
interface UptimeData {
  uptime30d: number | null;
  dailyBuckets: { date: string; status: DailyStatus; downtimeSeconds: number }[];
  hasMonitor: boolean;
}

/* ---------- Cockpit hero ---------- */

function HealthHero({
  services,
  loading,
  isError,
}: {
  services: Service[];
  loading: boolean;
  isError: boolean;
}) {
  if (loading) {
    return (
      <div className="stagger-item">
        <div className="flex flex-col items-center justify-center rounded-2xl border bg-card px-6 py-8">
          <Skeleton className="h-12 w-12 rounded-full mb-5" />
          <Skeleton className="h-7 w-44 mb-2" />
          <Skeleton className="h-4 w-56" />
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="stagger-item">
        <div
          className="relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border bg-card px-6 py-8 text-center"
          data-testid="hero-health-banner"
        >
          <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Activity className="h-6 w-6" strokeWidth={2.5} />
          </div>
          <h1 className="mb-1 text-2xl font-bold tracking-tight text-muted-foreground" data-testid="text-dashboard-title">
            Status Unavailable
          </h1>
          <p className="max-w-[280px] text-sm text-muted-foreground sm:max-w-md" data-testid="text-health-summary">
            We couldn't load your service status. Check the Service Health section below to retry.
          </p>
        </div>
      </div>
    );
  }

  const issues = services.filter((s) => s.status !== "operational");
  const hasOutage = issues.some((s) => s.status === "outage");
  const issueNames = issues.map((s) => s.name);

  let tone: { text: string; iconBg: string; iconFg: string; border: string; glow: string; shadow: string };
  let Icon = CheckCircle;
  let headline = "All Systems Go";
  let subline = "Every service is operational. Nothing needs your attention.";

  if (issues.length === 0) {
    tone = {
      text: "text-status-online",
      iconBg: "bg-status-online",
      iconFg: "text-white",
      border: "border-green-500/20",
      glow: "bg-green-500/10",
      shadow: "shadow-green-500/5",
    };
  } else if (hasOutage) {
    Icon = XCircle;
    headline = issues.length === 1 ? "1 Service Down" : `${issues.length} Issues Detected`;
    subline = `${issueNames.join(", ")} ${issues.length === 1 ? "is" : "are"} currently affected. We're on it.`;
    tone = {
      text: "text-red-500",
      iconBg: "bg-red-500",
      iconFg: "text-red-950",
      border: "border-red-500/20",
      glow: "bg-red-500/10",
      shadow: "shadow-red-500/5",
    };
  } else {
    Icon = AlertTriangle;
    headline = issues.length === 1 ? "1 Issue Detected" : `${issues.length} Issues Detected`;
    subline = `${issueNames.join(", ")} ${issues.length === 1 ? "is" : "are"} experiencing degraded performance. Other services are operational.`;
    tone = {
      text: "text-amber-500",
      iconBg: "bg-amber-500",
      iconFg: "text-amber-950",
      border: "border-amber-500/20",
      glow: "bg-amber-500/10",
      shadow: "shadow-amber-500/5",
    };
  }

  return (
    <div className="stagger-item">
      <div
        className={`relative flex flex-col items-center justify-center overflow-hidden rounded-2xl border bg-card px-6 py-8 text-center shadow-lg ${tone.border} ${tone.shadow}`}
        data-testid="hero-health-banner"
      >
        <div
          className={`pointer-events-none absolute top-0 left-1/2 h-[100px] w-[200%] -translate-x-1/2 blur-[50px] ${tone.glow}`}
        />
        <div className={`hero-health-indicator mb-5 ${tone.text}`}>
          <div
            className={`z-10 flex h-12 w-12 items-center justify-center rounded-full ${tone.iconBg} ${tone.iconFg}`}
          >
            <Icon className="h-6 w-6" strokeWidth={2.5} />
          </div>
        </div>
        <h1 className={`mb-1 text-2xl font-bold tracking-tight ${tone.text}`} data-testid="text-dashboard-title">
          {headline}
        </h1>
        <p className="max-w-[280px] text-sm text-muted-foreground sm:max-w-md" data-testid="text-health-summary">
          {subline}
        </p>
      </div>
    </div>
  );
}

/* ---------- Service health strip ---------- */

function ServiceHealthCard({ service }: { service: Service }) {
  const { data } = useQuery<UptimeData>({
    queryKey: ["/api/services", service.id, "uptime"],
  });

  const buckets = data?.hasMonitor ? data.dailyBuckets.slice(-14) : [];

  return (
    <Link href={`/services/${service.id}`} data-testid={`card-service-health-${service.id}`}>
      <div className="hover-elevate tap-interactive h-full w-[150px] flex-shrink-0 cursor-pointer snap-start rounded-xl border bg-card p-3 lg:w-auto">
        <div className="mb-3 flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
              service.status === "operational"
                ? "bg-status-online"
                : service.status === "outage"
                  ? "bg-status-busy animate-status-pulse"
                  : "bg-status-away animate-status-pulse"
            }`}
          />
          <span className="truncate text-sm font-medium leading-none">{service.name}</span>
        </div>
        {buckets.length > 0 ? (
          <div className="space-y-1.5">
            <div className="uptime-bar">
              {buckets.map((b) => (
                <div
                  key={b.date}
                  className={`uptime-segment ${b.status !== "up" ? b.status : ""}`}
                  style={{ height: b.status === "up" ? "100%" : b.status === "partial" ? "60%" : b.status === "down" ? "35%" : "20%" }}
                />
              ))}
            </div>
            {data?.uptime30d != null && (
              <p className="text-[10px] text-muted-foreground">{data.uptime30d.toFixed(2)}% · 30d</p>
            )}
          </div>
        ) : (
          <p className="text-xs capitalize text-muted-foreground">{service.status}</p>
        )}
      </div>
    </Link>
  );
}

/* ---------- Page ---------- */

export default function Dashboard() {
  const { user } = useAuth();

  const { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj, refetch: refetchServices, isFetching: servicesFetching } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const { data: alerts, isLoading: alertsLoading, isError: alertsError, error: alertsErrorObj, refetch: refetchAlerts, isFetching: alertsFetching } = useQuery<ServiceAlertWithServices[]>({
    queryKey: ["/api/alerts"],
  });

  const { data: news, isLoading: newsLoading, isError: newsError, error: newsErrorObj, refetch: refetchNews, isFetching: newsFetching } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
  });

  const { data: tickets, isLoading: ticketsLoading } = useQuery<TicketType[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: contentNotifData } = useQuery<Record<string, number>>({
    queryKey: ["/api/content-notifications/counts"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const newServiceUpdatesCount = contentNotifData?.["service-updates"] ?? 0;

  const activeAlerts = alerts?.filter((a) => a.status !== "resolved") || [];
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const subscribedServices = services?.filter((s) =>
    user?.subscribedServices?.includes(s.id)
  ) || [];
  const displayServices = subscribedServices.length > 0 ? subscribedServices : services || [];
  const myTickets = tickets?.filter((t) => t.status === "open") || [];

  // Merge alerts + open tickets into one prioritized "Needs attention" list:
  // critical alerts → warning alerts → open tickets → info alerts.
  const severityRank: Record<string, number> = { critical: 0, warning: 1, info: 3 };
  type AttentionItem = {
    key: string;
    href: string;
    title: string;
    meta: string;
    time: Date;
    rank: number;
    icon: typeof AlertTriangle;
    iconColor: string;
    iconBg: string;
  };
  const attentionItems: AttentionItem[] = [
    ...activeAlerts.map((alert) => {
      const rank = severityRank[alert.severity] ?? 3;
      return {
        key: `alert-${alert.id}`,
        href: `/alerts/${alert.id}`,
        title: alert.title,
        meta: (alert.serviceIds || []).map((sid) => serviceMap.get(sid)).filter(Boolean).join(", ") || "Service alert",
        time: new Date(alert.createdAt),
        rank,
        icon: alert.severity === "critical" ? XCircle : alert.severity === "warning" ? AlertTriangle : Activity,
        iconColor: alert.severity === "critical" ? "text-destructive" : alert.severity === "warning" ? "text-amber-500" : "text-muted-foreground",
        iconBg: alert.severity === "critical" ? "bg-destructive/10" : alert.severity === "warning" ? "bg-amber-500/10" : "bg-muted",
      };
    }),
    ...myTickets.map((ticket) => ({
      key: `ticket-${ticket.id}`,
      href: `/tickets/${ticket.id}`,
      title: ticket.subject,
      meta: "Open ticket",
      time: new Date(ticket.createdAt),
      rank: 2,
      icon: Ticket,
      iconColor: "text-primary",
      iconBg: "bg-primary/10",
    })),
  ]
    .sort((a, b) => a.rank - b.rank || b.time.getTime() - a.time.getTime())
    .slice(0, 5);

  const attentionLoading = alertsLoading || ticketsLoading;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground" data-testid="text-dashboard-welcome">
        Welcome back, {user?.fullName}
      </p>

      <HealthHero services={displayServices} loading={servicesLoading} isError={servicesError} />

      {/* Service health strip */}
      <div className="stagger-item">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service Health</h2>
          <Link href="/services">
            <Button variant="ghost" size="sm" data-testid="link-view-all-services">
              View All
            </Button>
          </Link>
        </div>
        {servicesLoading ? (
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-20 w-[150px] flex-shrink-0 rounded-xl" />
            ))}
          </div>
        ) : servicesError ? (
          <QueryErrorState
            error={servicesErrorObj}
            onRetry={() => refetchServices()}
            isRetrying={servicesFetching}
            resourceName="services"
            className="py-6"
            data-testid="error-dashboard-services"
          />
        ) : displayServices.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No services to display</p>
        ) : (
          <div className="-mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 lg:grid lg:grid-cols-4 lg:overflow-visible xl:grid-cols-5">
            {displayServices.map((service) => (
              <ServiceHealthCard key={service.id} service={service} />
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Needs attention */}
        <div className="stagger-item">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Needs Attention</h2>
            <Link href="/alerts">
              <Button variant="ghost" size="sm" data-testid="link-view-all-alerts">
                View All
              </Button>
            </Link>
          </div>
          {attentionLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : alertsError ? (
            <QueryErrorState
              error={alertsErrorObj}
              onRetry={() => refetchAlerts()}
              isRetrying={alertsFetching}
              resourceName="alerts"
              className="py-6"
              data-testid="error-dashboard-alerts"
            />
          ) : attentionItems.length === 0 ? (
            <div className="rounded-xl border bg-card py-8 text-center">
              <CheckCircle className="mx-auto mb-2 h-8 w-8 text-status-online animate-status-glow" />
              <p className="text-sm text-muted-foreground">All clear — nothing needs your attention</p>
            </div>
          ) : (
            <div className="space-y-2">
              {attentionItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link key={item.key} href={item.href}>
                    <div
                      className="hover-elevate tap-interactive flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-3"
                      data-testid={`attention-row-${item.key}`}
                    >
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.iconBg}`}>
                        <Icon className={`h-4 w-4 ${item.iconColor}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="mb-1 text-sm font-medium leading-tight">{item.title}</p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{item.meta}</span>
                          <span className="h-1 w-1 shrink-0 rounded-full bg-border" />
                          <span className="flex shrink-0 items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(item.time, { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 self-center text-muted-foreground/50" />
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>

        {/* Updates & news */}
        <div className="stagger-item">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Updates &amp; News</h2>
            <Link href="/news">
              <Button variant="ghost" size="sm" data-testid="link-view-all-news">
                View All
              </Button>
            </Link>
          </div>
          {newsLoading ? (
            <Skeleton className="h-40 rounded-xl" />
          ) : newsError ? (
            <QueryErrorState
              error={newsErrorObj}
              onRetry={() => refetchNews()}
              isRetrying={newsFetching}
              resourceName="news"
              className="py-6"
              data-testid="error-dashboard-news"
            />
          ) : (
            <div className="overflow-hidden rounded-xl border bg-card">
              {newServiceUpdatesCount > 0 && (
                <Link href="/service-updates">
                  <div
                    className="tap-interactive flex cursor-pointer items-center gap-3 border-b p-3 transition-colors hover:bg-muted/50"
                    data-testid="row-service-updates"
                  >
                    <Bell className="h-4 w-4 shrink-0 text-primary" />
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">
                      {newServiceUpdatesCount} new service update{newServiceUpdatesCount === 1 ? "" : "s"}
                    </p>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  </div>
                </Link>
              )}
              {!news || news.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">No news stories yet</p>
              ) : (
                news.slice(0, 4).map((story, i, arr) => (
                  <Link key={story.id} href={`/news/${story.id}`}>
                    <div
                      className={`tap-interactive flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 ${
                        i !== arr.length - 1 ? "border-b" : ""
                      }`}
                      data-testid={`news-row-${story.id}`}
                    >
                      <Newspaper className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <p className="min-w-0 flex-1 truncate text-sm">{story.title}</p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(new Date(story.createdAt), "MMM d")}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
