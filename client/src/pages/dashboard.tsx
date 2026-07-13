import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle,
  ChevronRight,
  Clock,
  Newspaper,
  Ticket,
  XCircle,
} from "lucide-react";
import type {
  Service,
  ServiceAlertWithServices,
  AlertUpdate,
  ServiceUpdate,
  NewsStory,
  Ticket as TicketType,
} from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { QueryErrorState } from "@/components/query-error-state";
import { stripHtml } from "@/components/rich-text-editor";

interface UptimeData {
  uptime30d: number | null;
  dailyBuckets: { date: string; status: string; downtimeSeconds: number }[];
  hasMonitor: boolean;
}

/* ---------- Hero banner ---------- */

function HealthHero({
  services,
  loading,
  isError,
  heroHref,
}: {
  services: Service[];
  loading: boolean;
  isError: boolean;
  heroHref: string;
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
  let headline = "All systems running smoothly";
  let subline = "Every service is working as it should.";

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
    headline = issues.length === 1 ? `${issueNames[0]} is down` : "Some services are down";
    subline =
      issues.length === 1
        ? "We're working on it right now. Everything else is running normally."
        : `${issueNames.join(", ")} are affected. We're working on it right now.`;
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
    headline = issues.length === 1 ? `${issueNames[0]} is having trouble` : "Some services are having trouble";
    subline =
      issues.length === 1
        ? "We're on it — everything else is running normally."
        : `${issueNames.join(", ")} are affected. We're on it — everything else is running normally.`;
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
        {issues.length > 0 && (
          <Link href={heroHref}>
            <Button
              size="sm"
              className={`z-10 mt-4 ${hasOutage ? "bg-red-600 hover:bg-red-600" : "bg-amber-600 hover:bg-amber-600"} text-white`}
              data-testid="button-hero-see-whats-happening"
            >
              See what's happening
              <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ---------- Service list row ---------- */

function ServiceRow({ service }: { service: Service }) {
  const { data } = useQuery<UptimeData>({
    queryKey: ["/api/services", service.id, "uptime"],
  });

  const isOutage = service.status === "outage";
  const isDegraded = service.status !== "operational" && !isOutage;
  const hasIssue = isOutage || isDegraded;

  return (
    <Link href={`/services/${service.id}`} data-testid={`card-service-health-${service.id}`}>
      <div
        className={`tap-interactive flex cursor-pointer items-center justify-between p-3 transition-colors ${
          isOutage ? "bg-red-500/10" : isDegraded ? "bg-amber-500/10" : "hover:bg-muted/50"
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`inline-block h-2 w-2 flex-shrink-0 rounded-full ${
              isOutage
                ? "bg-status-busy animate-status-pulse"
                : isDegraded
                  ? "bg-status-away animate-status-pulse"
                  : "bg-status-online"
            }`}
          />
          <span className="truncate text-sm font-medium">{service.name}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          {hasIssue ? (
            <span
              className={`inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider ${
                isOutage ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400"
              }`}
            >
              {isOutage ? "Down" : "Having trouble"}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          ) : (
            <>
              <span className="text-xs font-semibold uppercase tracking-wider text-status-online">Good</span>
              {data?.hasMonitor && data.uptime30d != null && (
                <span className="w-14 text-right text-xs font-medium text-muted-foreground">
                  {data.uptime30d.toFixed(2)}%
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

/* ---------- Current issue card ---------- */

function CurrentIssueCard({
  alert,
  serviceMap,
}: {
  alert: ServiceAlertWithServices;
  serviceMap: Map<string, string>;
}) {
  const { data: updates } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", alert.id, "updates"],
  });

  const isCritical = alert.severity === "critical";
  const recentUpdates = (updates ?? [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 2);
  const affected = (alert.serviceIds || [])
    .map((sid) => serviceMap.get(sid))
    .filter(Boolean)
    .join(", ");

  return (
    <Link href={`/alerts/${alert.id}`}>
      <div
        className={`hover-elevate tap-interactive relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 ${
          isCritical ? "border-red-500/40" : "border-amber-500/40"
        }`}
        data-testid={`current-issue-${alert.id}`}
      >
        <div className={`absolute top-0 left-0 h-full w-1 ${isCritical ? "bg-red-500" : "bg-amber-500"}`} />
        <div className="mb-2 flex items-start justify-between gap-2">
          <span
            className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
              isCritical
                ? "bg-red-500/15 text-red-700 dark:text-red-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }`}
          >
            {alert.status === "monitoring" ? "Monitoring" : "Investigating"}
          </span>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            Started {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
          </span>
        </div>
        <h3 className="mb-1 pr-4 text-sm font-semibold">{alert.title}</h3>
        {affected && <p className="mb-1 text-xs text-muted-foreground">Affects: {affected}</p>}
        <p className="line-clamp-2 text-xs text-muted-foreground">{stripHtml(alert.description)}</p>
        {recentUpdates.length > 0 && (
          <div className="mt-3 flex flex-col gap-2 border-t pt-3">
            {recentUpdates.map((u, i) => (
              <div key={u.id} className="flex items-start gap-2">
                <div
                  className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                    i === 0 ? (isCritical ? "bg-red-500" : "bg-amber-500") : "bg-border"
                  }`}
                />
                <p className={`text-xs leading-snug ${i === 0 ? "text-foreground" : "text-muted-foreground"}`}>
                  <span className="font-semibold">{format(new Date(u.createdAt), "h:mm a")}</span> —{" "}
                  {stripHtml(u.message)}
                </p>
              </div>
            ))}
          </div>
        )}
        <p
          className={`mt-3 inline-flex items-center gap-1 text-xs font-semibold ${
            isCritical ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"
          }`}
        >
          Follow live updates <ChevronRight className="h-3.5 w-3.5" />
        </p>
      </div>
    </Link>
  );
}

/* ---------- Section header ---------- */

function SectionHeader({
  icon: Icon,
  title,
  badge,
  viewAllHref,
  viewAllTestId,
  iconClass = "text-primary",
}: {
  icon: typeof Bell;
  title: string;
  badge?: string;
  viewAllHref?: string;
  viewAllTestId?: string;
  iconClass?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight">
        <Icon className={`h-5 w-5 ${iconClass}`} />
        {title}
        {badge && (
          <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-bold leading-none text-primary-foreground">
            {badge}
          </span>
        )}
      </h2>
      {viewAllHref && (
        <Link href={viewAllHref}>
          <Button variant="ghost" size="sm" data-testid={viewAllTestId}>
            View All
          </Button>
        </Link>
      )}
    </div>
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

  const { data: tickets, isLoading: ticketsLoading, isError: ticketsError, error: ticketsErrorObj, refetch: refetchTickets, isFetching: ticketsFetching } = useQuery<TicketType[]>({
    queryKey: ["/api/tickets"],
  });

  const { data: serviceUpdates, isLoading: updatesLoading, isError: updatesError, error: updatesErrorObj, refetch: refetchUpdates, isFetching: updatesFetching } = useQuery<ServiceUpdate[]>({
    queryKey: ["/api/service-updates"],
  });

  const { data: contentNotifData } = useQuery<Record<string, number>>({
    queryKey: ["/api/content-notifications/counts"],
    refetchInterval: 15000,
    enabled: !!user,
  });
  const newServiceUpdatesCount = contentNotifData?.["service-updates"] ?? 0;

  const activeAlerts = (alerts?.filter((a) => a.status !== "resolved") || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const subscribedServices = services?.filter((s) =>
    user?.subscribedServices?.includes(s.id)
  ) || [];
  const displayServices = subscribedServices.length > 0 ? subscribedServices : services || [];
  const myTickets = (tickets?.filter((t) => t.status === "open") || [])
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const heroHref =
    activeAlerts.length === 1 ? `/alerts/${activeAlerts[0].id}` : activeAlerts.length > 1 ? "/alerts" : "/services";

  const displayUpdates = (serviceUpdates || []).slice(0, 3);

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground" data-testid="text-dashboard-welcome">
        Welcome back, {user?.fullName}
      </p>

      <HealthHero services={displayServices} loading={servicesLoading} isError={servicesError} heroHref={heroHref} />

      {/* Service health list */}
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
          <div className="space-y-px overflow-hidden rounded-xl border">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-11 rounded-none" />
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
          <>
            <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
              {displayServices.map((service) => (
                <ServiceRow key={service.id} service={service} />
              ))}
            </div>
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              Tap any service for its full history, including past resolved alerts.
            </p>
          </>
        )}
      </div>

      {/* Current issues */}
      {!alertsLoading && !alertsError && activeAlerts.length > 0 && (
        <div className="stagger-item">
          <SectionHeader
            icon={AlertTriangle}
            title={activeAlerts.length === 1 ? "Current issue" : "Current issues"}
            iconClass="text-amber-600 dark:text-amber-500"
            viewAllHref="/alerts"
            viewAllTestId="link-view-all-alerts"
          />
          <div className="flex flex-col gap-3">
            {activeAlerts.slice(0, 3).map((alert) => (
              <CurrentIssueCard key={alert.id} alert={alert} serviceMap={serviceMap} />
            ))}
          </div>
        </div>
      )}
      {alertsError && (
        <div className="stagger-item">
          <SectionHeader
            icon={AlertTriangle}
            title="Current issues"
            iconClass="text-amber-600 dark:text-amber-500"
          />
          <QueryErrorState
            error={alertsErrorObj}
            onRetry={() => refetchAlerts()}
            isRetrying={alertsFetching}
            resourceName="alerts"
            className="py-6"
            data-testid="error-dashboard-alerts"
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Your support tickets */}
        <div className="stagger-item">
          <SectionHeader
            icon={Ticket}
            title="Your support tickets"
            viewAllHref="/tickets"
            viewAllTestId="link-view-all-tickets"
          />
          {ticketsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
          ) : ticketsError ? (
            <QueryErrorState
              error={ticketsErrorObj}
              onRetry={() => refetchTickets()}
              isRetrying={ticketsFetching}
              resourceName="tickets"
              className="py-6"
              data-testid="error-dashboard-tickets"
            />
          ) : myTickets.length === 0 ? (
            <div className="flex flex-col items-center rounded-xl border bg-card p-5 text-center shadow-sm">
              <p className="mb-1 text-sm font-semibold" data-testid="text-no-open-tickets">
                No open support tickets
              </p>
              <p className="mb-4 max-w-[240px] text-xs text-muted-foreground">
                Need a hand with something? We're happy to help.
              </p>
              <Link href="/tickets">
                <Button size="sm" data-testid="button-open-ticket">
                  Open a ticket
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Button>
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {myTickets.slice(0, 3).map((ticket) => (
                <Link key={ticket.id} href={`/tickets/${ticket.id}`}>
                  <div
                    className="hover-elevate tap-interactive relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 shadow-sm"
                    data-testid={`ticket-row-${ticket.id}`}
                  >
                    <div className={`absolute top-0 left-0 h-full w-1 ${ticket.claimedBy ? "bg-primary" : "bg-border"}`} />
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <span
                        className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          ticket.claimedBy ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {ticket.claimedBy ? "We're on it" : "Open"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                    <h3 className="pr-4 text-sm font-semibold">{ticket.subject}</h3>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Service updates */}
        <div className="stagger-item">
          <SectionHeader
            icon={Bell}
            title="Service updates"
            badge={newServiceUpdatesCount > 0 ? `${newServiceUpdatesCount} new` : undefined}
            viewAllHref="/service-updates"
            viewAllTestId="link-view-all-service-updates"
          />
          {updatesLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-xl" />
              ))}
            </div>
          ) : updatesError ? (
            <QueryErrorState
              error={updatesErrorObj}
              onRetry={() => refetchUpdates()}
              isRetrying={updatesFetching}
              resourceName="service updates"
              className="py-6"
              data-testid="error-dashboard-service-updates"
            />
          ) : displayUpdates.length === 0 ? (
            <div className="rounded-xl border bg-card py-6 text-center shadow-sm">
              <p className="text-sm text-muted-foreground">No service updates yet</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {displayUpdates.map((update, i) => {
                const isNew = i < newServiceUpdatesCount;
                return (
                  <Link key={update.id} href="/service-updates">
                    <div
                      className={`hover-elevate tap-interactive flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 shadow-sm ${
                        isNew ? "" : "opacity-70"
                      }`}
                      data-testid={`service-update-row-${update.id}`}
                    >
                      <div
                        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                          isNew ? "bg-primary" : "border border-border bg-transparent"
                        }`}
                      />
                      <div className="min-w-0">
                        <h3 className={`mb-1 text-sm leading-snug ${isNew ? "font-semibold" : "font-medium"}`}>
                          {update.title}
                        </h3>
                        <p className="line-clamp-1 text-xs text-muted-foreground">{stripHtml(update.description)}</p>
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Latest stories */}
      <div className="stagger-item">
        <SectionHeader
          icon={Newspaper}
          title="Latest stories"
          viewAllHref="/news"
          viewAllTestId="link-view-all-news"
        />
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
        ) : !news || news.length === 0 ? (
          <div className="rounded-xl border bg-card py-6 text-center shadow-sm">
            <p className="text-sm text-muted-foreground">No news stories yet</p>
          </div>
        ) : (
          <div className="divide-y overflow-hidden rounded-xl border bg-card shadow-sm">
            {news.slice(0, 4).map((story) => (
              <Link key={story.id} href={`/news/${story.id}`}>
                <div
                  className="tap-interactive group flex cursor-pointer items-center justify-between gap-3 p-4 transition-colors hover:bg-muted/50"
                  data-testid={`news-row-${story.id}`}
                >
                  <div className="min-w-0">
                    <h3 className="mb-1 truncate text-sm font-medium">{story.title}</h3>
                    <p className="text-xs text-muted-foreground">{format(new Date(story.createdAt), "MMM d")}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-colors group-hover:text-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
