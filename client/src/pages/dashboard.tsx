import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  MessageSquare,
  Newspaper,
  Plus,
  Sparkles,
} from "lucide-react";
import type { Service, ServiceAlertWithServices, NewsStory, Ticket as TicketType, ServiceUpdate } from "@shared/schema";
import { format, formatDistanceToNow } from "date-fns";
import { stripHtml } from "@/components/rich-text-editor";
import { QueryErrorState } from "@/components/query-error-state";

import { serviceStatusMeta as statusMeta, ticketStatusPill } from "@/lib/status-meta";

function SectionIcon({ icon: Icon, tone }: { icon: typeof Bell; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function NewBadge() {
  return (
    <span className="rounded-full bg-status-busy px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background shrink-0">
      New
    </span>
  );
}

function RowSkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-48" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

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
    enabled: !!user,
  });

  const { data: unreadUpdateIds } = useQuery<string[]>({
    queryKey: ["/api/content-notifications/unread-references", "service-updates"],
    queryFn: async () => {
      const res = await fetch("/api/content-notifications/unread-references/service-updates", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  const { data: unreadNewsIds } = useQuery<string[]>({
    queryKey: ["/api/content-notifications/unread-references", "news"],
    queryFn: async () => {
      const res = await fetch("/api/content-notifications/unread-references/news", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
    refetchInterval: 15000,
  });

  const unreadUpdateSet = new Set(unreadUpdateIds || []);
  const unreadNewsSet = new Set(unreadNewsIds || []);

  const activeAlerts = alerts?.filter((a) => a.status !== "resolved") || [];
  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const subscribedServices = services?.filter((s) =>
    user?.subscribedServices?.includes(s.id)
  ) || [];
  const displayServices = subscribedServices.length > 0 ? subscribedServices : services || [];
  const openTickets = tickets?.filter((t) => t.status === "open") || [];

  // Alerts in "monitoring" status mean a fix is in place and the team is
  // watching for recurrence — they stay visible but no longer count as a
  // problem, so the hero shows a calm monitoring state instead of a warning.
  const problemAlerts = activeAlerts.filter((a) => a.status !== "monitoring");
  const monitoringAlerts = activeAlerts.filter((a) => a.status === "monitoring");
  const hasOutage = displayServices.some((s) => s.status === "outage") || problemAlerts.some((a) => a.severity === "critical");
  const hasIssue = problemAlerts.length > 0 || displayServices.some((s) => s.status !== "operational");
  const heroState: "clear" | "monitoring" | "issue" | "outage" = hasOutage ? "outage" : hasIssue ? "issue" : monitoringAlerts.length > 0 ? "monitoring" : "clear";
  const firstAlert = problemAlerts[0] ?? monitoringAlerts[0];

  const heroTitle = heroState === "outage" ? "We're currently experiencing an outage" : "We're currently experiencing an issue";
  const heroAlertServices = firstAlert?.serviceIds?.map((sid) => serviceMap.get(sid)).filter(Boolean).join(", ");
  const heroSubtitle = firstAlert
    ? `${firstAlert.title}${heroAlertServices ? ` — ${heroAlertServices}` : ""} · started ${formatDistanceToNow(new Date(firstAlert.createdAt), { addSuffix: true })} · tap to view the alert`
    : "One or more of your services isn't fully operational right now. Tap to see details.";
  const monitoringSubtitle = firstAlert
    ? `${firstAlert.title}${heroAlertServices ? ` — ${heroAlertServices}` : ""} · a fix is in place and we're watching closely · tap to view`
    : "A fix is in place and we're keeping an eye on things.";

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${user?.fullName ?? ""}`} subtitle="Here's an overview of your services and recent activity" testId="text-dashboard-title" />

      {/* Status hero */}
      {servicesLoading || alertsLoading ? (
        <Skeleton className="h-24 w-full rounded-xl" data-testid="skeleton-hero" />
      ) : servicesError || alertsError ? (
        <div className="rounded-xl border border-card-border bg-card p-6" data-testid="hero-status-error">
          <QueryErrorState
            error={alertsError ? alertsErrorObj : servicesErrorObj}
            onRetry={() => {
              if (servicesError) refetchServices();
              if (alertsError) refetchAlerts();
            }}
            isRetrying={servicesFetching || alertsFetching}
            resourceName="service status"
          />
        </div>
      ) : heroState === "clear" ? (
        <Link href="/alerts" className="block" data-testid="hero-status">
          <div className="rounded-xl border border-status-online/40 ring-1 ring-inset ring-status-online/20 bg-gradient-to-br from-status-online/20 via-status-online/10 to-transparent px-5 py-4 sm:px-6 sm:py-5 flex items-center gap-3.5 shadow-sm hover:ring-status-online/40 transition cursor-pointer animate-hero-breathe hero-glow-online">
            <span className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-status-online/15 ring-1 ring-status-online/30">
              <CheckCircle2 className="h-5 w-5 sm:h-[22px] sm:w-[22px] text-status-online" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base sm:text-lg font-semibold leading-snug text-status-online">All services are running smoothly</p>
              <p className="text-[13px] sm:text-sm leading-snug text-muted-foreground line-clamp-2 mt-0.5">
                Every service you're subscribed to is operational.{" "}
                <span data-testid="text-active-alerts-count">0 active alerts</span> · tap to view alert history
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-status-online" />
          </div>
        </Link>
      ) : heroState === "monitoring" ? (
        <Link href={firstAlert ? `/alerts/${firstAlert.id}` : "/alerts"} className="block" data-testid="hero-status">
          <div className="rounded-xl border border-primary/40 ring-1 ring-inset ring-primary/20 bg-gradient-to-br from-primary/15 via-primary/[0.07] to-transparent px-5 py-4 sm:px-6 sm:py-5 flex items-center gap-3.5 shadow-sm hover:ring-primary/40 transition cursor-pointer">
            <span className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
              <Activity className="h-5 w-5 sm:h-[22px] sm:w-[22px] text-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base sm:text-lg font-semibold leading-snug text-primary">All services are up — monitoring a recent fix</p>
              <p className="text-[13px] sm:text-sm leading-snug text-muted-foreground line-clamp-2 mt-0.5">{monitoringSubtitle}</p>
            </div>
            <span
              className="hidden sm:inline rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 bg-primary/10 text-primary"
              data-testid="text-active-alerts-count"
            >
              Monitoring
            </span>
            <ChevronRight className="h-5 w-5 shrink-0 text-primary" />
          </div>
        </Link>
      ) : (
        <Link href={firstAlert ? `/alerts/${firstAlert.id}` : "/alerts"} className="block" data-testid="hero-status">
          <div
            className={
              heroState === "outage"
                ? "w-full rounded-xl border border-status-busy/40 ring-1 ring-inset ring-status-busy/20 bg-gradient-to-br from-status-busy/20 via-status-busy/10 to-transparent px-5 py-4 sm:px-6 sm:py-5 flex items-center gap-3.5 text-left shadow-sm hover:ring-status-busy/40 transition cursor-pointer animate-hero-breathe hero-glow-busy"
                : "w-full rounded-xl border border-status-away/40 ring-1 ring-inset ring-status-away/20 bg-gradient-to-br from-status-away/20 via-status-away/10 to-transparent px-5 py-4 sm:px-6 sm:py-5 flex items-center gap-3.5 text-left shadow-sm hover:ring-status-away/40 transition cursor-pointer animate-hero-breathe hero-glow-away"
            }
          >
            <span
              className={
                heroState === "outage"
                  ? "flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-status-busy/15 ring-1 ring-status-busy/30"
                  : "flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-status-away/15 ring-1 ring-status-away/30"
              }
            >
              <AlertTriangle className={`h-5 w-5 sm:h-[22px] sm:w-[22px] animate-status-pulse ${heroState === "outage" ? "text-status-busy" : "text-status-away"}`} />
            </span>
            <div className="min-w-0 flex-1">
              <p className={`text-base sm:text-lg font-semibold leading-snug ${heroState === "outage" ? "text-status-busy" : "text-status-away"}`}>{heroTitle}</p>
              <p className="text-[13px] sm:text-sm leading-snug text-muted-foreground line-clamp-2 mt-0.5">{heroSubtitle}</p>
            </div>
            <span
              className={`hidden sm:inline rounded-full px-2.5 py-0.5 text-xs font-medium shrink-0 ${heroState === "outage" ? "bg-status-busy/15 text-status-busy" : "bg-status-away/15 text-status-away"}`}
              data-testid="text-active-alerts-count"
            >
              {problemAlerts.length} active {problemAlerts.length === 1 ? "alert" : "alerts"}
            </span>
            <ChevronRight className={`h-5 w-5 shrink-0 ${heroState === "outage" ? "text-status-busy" : "text-status-away"}`} />
          </div>
        </Link>
      )}
      {(heroState === "issue" || heroState === "outage") && activeAlerts.length > 1 && (
        <div className="-mt-3 text-right">
          <Link href="/alerts" className="text-xs font-medium text-muted-foreground hover:text-foreground" data-testid="link-view-all-alerts">
            View all {activeAlerts.length} active alerts →
          </Link>
        </div>
      )}

      {/* First-run: no followed services yet */}
      {!servicesLoading && !servicesError && (services?.length || 0) > 0 && subscribedServices.length === 0 && (
        <Link
          href="/settings#services"
          className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 hover-elevate tap-interactive"
          data-testid="card-first-run-follow-services"
        >
          <SectionIcon icon={Sparkles} tone="bg-primary/10 text-primary" />
          <span className="flex-1 min-w-0">
            <span className="block text-sm font-semibold">Follow the services you use</span>
            <span className="block text-xs text-muted-foreground mt-0.5">
              Pick your services to personalize this dashboard and get notified when something changes.
            </span>
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        </Link>
      )}

      {/* Services */}
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={CheckCircle2} tone="bg-status-online/10 text-status-online" />
            Your services
          </h2>
          <span className="text-xs text-muted-foreground hidden sm:inline">Click a service for alerts &amp; history</span>
        </div>
        {servicesLoading ? (
          <RowSkeletons />
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
          <EmptyState icon={Sparkles} title="No services to display" hint="Follow services in Settings to see their status here." />
        ) : (
          <ul className="divide-y divide-border">
            {displayServices.map((service) => {
              const meta = statusMeta[service.status] || statusMeta.maintenance;
              return (
                <li key={service.id}>
                  <Link
                    href={`/services/${service.id}`}
                    className="flex items-center gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                    data-testid={`service-row-${service.id}`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} shrink-0 ${service.status !== "operational" ? "animate-status-pulse" : ""}`} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{service.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.pill}`}>{meta.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Tickets */}
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />
            Your support tickets
          </h2>
          {openTickets.length > 0 && (
            <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary" data-testid="text-open-tickets-count">
              {openTickets.length} open
            </span>
          )}
        </div>
        {ticketsLoading ? (
          <RowSkeletons rows={2} />
        ) : ticketsError ? (
          <QueryErrorState
            error={ticketsErrorObj}
            onRetry={() => refetchTickets()}
            isRetrying={ticketsFetching}
            resourceName="tickets"
            className="py-6"
            data-testid="error-dashboard-tickets"
          />
        ) : openTickets.length === 0 ? (
          <div className="px-5 py-8 text-center space-y-3">
            <p className="text-sm text-muted-foreground">You don't have any open tickets.</p>
            <Link href="/tickets">
              <Button data-testid="button-open-ticket">
                <Plus className="h-4 w-4 mr-1.5" /> Open a ticket
              </Button>
            </Link>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {openTickets.slice(0, 4).map((ticket) => (
              <li key={ticket.id}>
                <Link
                  href={`/tickets/${ticket.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                  data-testid={`ticket-row-${ticket.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium">{ticket.subject}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(ticket.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ticketStatusPill[ticket.status] || "bg-muted text-muted-foreground"}`}>
                    {ticket.status}
                  </span>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent service updates */}
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={Bell} tone="bg-status-away/10 text-status-away" />
            Recent service updates
          </h2>
          <Link href="/service-updates">
            <Button variant="ghost" size="sm" data-testid="link-view-all-service-updates">View all</Button>
          </Link>
        </div>
        {updatesLoading ? (
          <RowSkeletons />
        ) : updatesError ? (
          <QueryErrorState
            error={updatesErrorObj}
            onRetry={() => refetchUpdates()}
            isRetrying={updatesFetching}
            resourceName="service updates"
            className="py-6"
            data-testid="error-dashboard-service-updates"
          />
        ) : !serviceUpdates || serviceUpdates.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No service updates yet</p>
        ) : (
          <ul className="divide-y divide-border">
            {serviceUpdates.slice(0, 3).map((update) => (
              <li key={update.id}>
                <Link
                  href={`/service-updates?highlight=${update.id}`}
                  className="flex items-center gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                  data-testid={`update-row-${update.id}`}
                >
                  <span className="h-2 w-2 rounded-full bg-status-away shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      <span className="truncate">{update.title}</span>
                      {unreadUpdateSet.has(update.id) && <NewBadge />}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {serviceMap.get(update.serviceId) || "Service"} · {formatDistanceToNow(new Date(update.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Latest news */}
      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={Newspaper} tone="bg-status-online/10 text-status-online" />
            Latest news
          </h2>
          <Link href="/news">
            <Button variant="ghost" size="sm" data-testid="link-view-all-news">View all</Button>
          </Link>
        </div>
        {newsLoading ? (
          <RowSkeletons />
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
          <EmptyState icon={Newspaper} title="No news stories yet" hint="Company news and updates will appear here." />
        ) : (
          <ul className="divide-y divide-border">
            {news.slice(0, 3).map((story) => (
              <li key={story.id}>
                <Link
                  href={`/news/${story.id}`}
                  className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                  data-testid={`news-row-${story.id}`}
                >
                  <span className="mt-0.5 shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {format(new Date(story.createdAt), "MMM d")}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      <span className="truncate">{story.title}</span>
                      {unreadNewsSet.has(story.id) && <NewBadge />}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{stripHtml(story.content)}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
