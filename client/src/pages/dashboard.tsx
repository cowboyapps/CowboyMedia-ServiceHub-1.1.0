import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Activity, AlertTriangle, ArrowRight, Bell, Check, ChevronRight, Clock3, Gift, LifeBuoy, MessageSquare, Newspaper, RefreshCw, Ticket, X } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import type { Service, ServiceAlertWithServices, NewsStory, Ticket as TicketType, ServiceUpdate, Promotion, AlertUpdate } from "@shared/schema";
import { useAuth } from "@/lib/auth";
import { liveQueryOptions } from "@/lib/queryClient";
import { dashboardHealth, dashboardDate } from "@/lib/dashboard-health";
import { stripHtml } from "@/lib/rich-text";
import { serviceStatusMeta, ticketStatusPill } from "@/lib/status-meta";
import { QueryErrorState } from "@/components/query-error-state";

const PROMO_DISMISS_KEY = "promo-banner-dismissed-ids";
const STATUS_MAX_AGE = 5 * 60_000;
type UptimeSummary = Record<string, { uptime30d: number | null; dailyBuckets: { date: string; status: string }[] }>;

function relative(value: Date | string | number | undefined | null) {
  const date = dashboardDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : "Time unavailable";
}
function NewBadge() {
  return <span className="rounded-full bg-status-busy px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white shrink-0">New</span>;
}
function Section({ title, icon: Icon, href, action = "View all", children, testId }: {
  title: string; icon: typeof Bell; href: string; action?: string; children: ReactNode; testId?: string;
}) {
  return <section className="af-card">
    <div className="af-section-head"><h2 className="af-section-heading"><Icon size={15} aria-hidden="true" />{title}</h2><Link className="af-small-link" href={href} data-testid={testId}>{action}</Link></div>
    {children}
  </section>;
}
function RowsLoading() {
  return <div className="af-loading" aria-label="Loading"><div className="af-skeleton" /><div className="af-skeleton" /></div>;
}
function PromoOffers({ promotions }: { promotions: Promotion[] }) {
  const [dismissed, setDismissed] = useState<string[]>(() => {
    try { const ids: unknown = JSON.parse(localStorage.getItem(PROMO_DISMISS_KEY) || "[]"); return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : []; } catch { return []; }
  });
  const available = promotions.filter(p => !dismissed.includes(p.id));
  return <Section title="Customer offers" icon={Gift} href="/promotions" action="See offers">
    {available.length ? <div className="flex items-center">
      <Link href="/promotions" className="af-row" data-testid="banner-promotion"><Gift size={16} className="text-primary shrink-0" /><span className="af-row-title">{available[0].title}<span className="af-row-meta">{available.length > 1 ? `${available.length} offers available · Terms apply` : "Customer offer · Terms apply"}</span></span><ChevronRight size={15} /></Link>
      <button aria-label="Dismiss promotion banner" data-testid="button-dismiss-promo-banner" className="af-dismiss" onClick={() => {
        const next = Array.from(new Set([...dismissed, ...promotions.map(p => p.id)])).filter(id => promotions.some(p => p.id === id));
        setDismissed(next);
        try { localStorage.setItem(PROMO_DISMISS_KEY, JSON.stringify(next)); } catch { /* Session dismissal still works without storage. */ }
      }}><X size={16} /></button>
    </div> : <Link href="/promotions" className="af-row"><span className="af-row-title">Browse customer offers<span className="af-row-meta">See available offers and their terms.</span></span><ChevronRight size={15} /></Link>}
  </Section>;
}

export default function Dashboard() {
  const { user } = useAuth();
  // Finite freshness and a single, foreground-only backup poll for health.
  // Existing live-sync invalidations still provide immediate updates.
  const servicesQuery = useQuery<Service[]>({ queryKey: ["/api/services"], ...liveQueryOptions, refetchInterval: 60_000 });
  const alertsQuery = useQuery<ServiceAlertWithServices[]>({ queryKey: ["/api/alerts"], ...liveQueryOptions, refetchInterval: 60_000 });
  const uptimeQuery = useQuery<UptimeSummary>({ queryKey: ["/api/services-uptime-summary"] });
  const newsQuery = useQuery<NewsStory[]>({ queryKey: ["/api/news"] });
  const ticketsQuery = useQuery<TicketType[]>({ queryKey: ["/api/tickets"] });
  const updatesQuery = useQuery<ServiceUpdate[]>({ queryKey: ["/api/service-updates"], enabled: !!user });
  const promosQuery = useQuery<Promotion[]>({ queryKey: ["/api/promotions"], enabled: !!user, ...liveQueryOptions });
  const { data: unreadUpdateIds } = useQuery<string[]>({
    queryKey: ["/api/content-notifications/unread-references", "service-updates"],
    queryFn: async () => { const res = await fetch("/api/content-notifications/unread-references/service-updates", { credentials: "include" }); if (!res.ok) return []; return res.json(); },
    enabled: !!user, refetchInterval: 15000,
  });
  const { data: unreadNewsIds } = useQuery<string[]>({
    queryKey: ["/api/content-notifications/unread-references", "news"],
    queryFn: async () => { const res = await fetch("/api/content-notifications/unread-references/news", { credentials: "include" }); if (!res.ok) return []; return res.json(); },
    enabled: !!user, refetchInterval: 15000,
  });
  const [, tick] = useState(0);
  useEffect(() => { const timer = setInterval(() => tick(n => n + 1), 60_000); return () => clearInterval(timer); }, []);
  const services = servicesQuery.data ?? [];
  const subscribed = services.filter(service => user?.subscribedServices?.includes(service.id));
  // Preserve the existing service/subscription fallback and global alerts scope.
  const displayServices = subscribed.length ? subscribed : services;
  const health = dashboardHealth(displayServices, alertsQuery.data ?? []);
  const primary = health.primary;
  const alertUpdates = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", primary?.id, "updates"],
    enabled: !!primary, ...liveQueryOptions, refetchInterval: 60_000,
  });
  const latestUpdate = alertUpdates.data?.slice().sort((a, b) => (dashboardDate(b.createdAt)?.getTime() ?? 0) - (dashboardDate(a.createdAt)?.getTime() ?? 0))[0];
  const checkedAt = Math.min(servicesQuery.dataUpdatedAt, alertsQuery.dataUpdatedAt);
  const failed = servicesQuery.isError || alertsQuery.isError;
  const loading = servicesQuery.isLoading || alertsQuery.isLoading;
  const stale = !loading && !failed && checkedAt > 0 && Date.now() - checkedAt > STATUS_MAX_AGE;
  const uncertain = loading || failed || stale;
  const issue = health.mode === "issue" || health.mode === "outage";
  const serviceMap = new Map(services.map(service => [service.id, service.name]));
  const affectedNames = primary?.serviceIds.map(id => serviceMap.get(id) ?? "Affected service") ?? displayServices.filter(s => s.status !== "operational").map(s => s.name);
  const href = health.mode === "monitoring" && health.monitoring.length > 1 ? "/alerts" : primary ? `/alerts/${primary.id}` : issue ? "/alerts" : "/services";
  const canViewLatest = !!primary && !!latestUpdate && !alertUpdates.isError && !alertUpdates.isLoading;
  const actionHref = primary ? `/alerts/${primary.id}${canViewLatest ? "?latest=1" : ""}` : href;
  const openTickets = (ticketsQuery.data ?? []).filter(ticket => ticket.status === "open");
  const unreadUpdates = new Set(unreadUpdateIds ?? []);
  const unreadNews = new Set(unreadNewsIds ?? []);
  const firstName = user?.fullName?.trim().split(/\s+/)[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const retryStatus = () => { void servicesQuery.refetch(); void alertsQuery.refetch(); };

  return <div className="af-page" data-testid="dashboard-alert-first">
    <div className="af-greeting"><div><div className="af-kicker">Your ServiceHub</div><h1 data-testid="text-dashboard-title">{greeting}{firstName ? `, ${firstName}` : ""}</h1><p>A quick look at your services</p></div></div>

    {loading ? <section className="af-incident af-uncertain" data-testid="skeleton-hero" aria-label="Checking service status"><div className="af-incident-head"><RefreshCw size={16} /><span className="af-state-title">Checking status</span></div><RowsLoading /><p className="af-content">Checking the latest service information.</p></section>
      : failed || stale ? <section className="af-incident af-uncertain" data-testid="hero-status-error">
        <div className="af-incident-head"><AlertTriangle size={16} /><span className="af-state-title">{stale ? "Status out of date" : "Status unavailable"}</span></div>
        <h2>We can’t confirm current service health</h2><p className="af-subtitle">{checkedAt > 0 ? `Last confirmed ${relative(checkedAt)}. ` : ""}This is not an all-clear.</p>
        {failed ? <QueryErrorState error={alertsQuery.isError ? alertsQuery.error : servicesQuery.error} onRetry={retryStatus} isRetrying={servicesQuery.isFetching || alertsQuery.isFetching} resourceName="service status" className="py-4" /> : <div className="af-actions"><button className="af-button" onClick={retryStatus} disabled={servicesQuery.isFetching || alertsQuery.isFetching}><RefreshCw size={15} />Refresh status</button></div>}
      </section>
      : <section className={`af-incident ${health.mode === "healthy" ? "af-calm" : health.mode === "monitoring" ? "af-watch" : health.mode === "outage" ? "af-critical" : health.mode === "empty" ? "af-uncertain" : ""}`} aria-label="Service health">
        <div className="af-incident-head"><span className="af-state-icon">{issue ? <AlertTriangle size={16} /> : health.mode === "healthy" ? <Check size={17} /> : <Activity size={16} />}</span><span className="af-state-title">{health.mode === "healthy" ? "Service health" : health.mode === "monitoring" ? "Monitoring after a fix" : health.mode === "outage" ? "Service outage" : health.mode === "empty" ? "No services available" : "Active service issue"}</span></div>
        <Link href={href} className="af-hero-title" data-testid="hero-status"><h2>{issue ? primary?.title ?? "One or more services is affected" : health.mode === "monitoring" ? "Services are back; we’re keeping watch" : health.mode === "empty" ? "No services to display" : "Your services are running normally"}</h2></Link>
        <p className="af-subtitle" data-testid={health.mode === "monitoring" ? "text-monitoring-note" : undefined}>{issue ? primary ? `${primary.status.replace(/_/g, " ")} · Reported ${relative(primary.createdAt)}` : "Check service details for current availability." : health.mode === "monitoring" ? `We’re monitoring: ${primary?.title}${health.monitoring.length > 1 ? ` (+${health.monitoring.length - 1} more)` : ""}` : health.mode === "empty" ? "Your available services will appear here." : `Checked ${relative(checkedAt)}`}</p>
        {issue && affectedNames.length > 0 && <div className="af-affected"><span className="af-affected-label">Affected {affectedNames.length === 1 ? "service" : "services"}</span>{affectedNames.map((name, i) => <span className="af-chip" key={`${name}-${i}`}>{name}</span>)}</div>}
        {issue && primary && <div className="af-update" data-testid="dashboard-latest-alert-update">
          <div className="af-update-top"><strong>{alertUpdates.isError ? "Latest update unavailable" : alertUpdates.isLoading ? "Loading latest update…" : latestUpdate ? "Latest update" : "Original report"}</strong><time dateTime={dashboardDate(latestUpdate?.createdAt ?? primary.createdAt)?.toISOString()}>{relative(latestUpdate?.createdAt ?? primary.createdAt)}</time></div>
          <p>{alertUpdates.isError ? "Open the alert for the full report and updates." : alertUpdates.isLoading ? "Checking for a newer update to this alert." : stripHtml(latestUpdate?.message ?? primary.description ?? "").slice(0, 240) || "Open the alert for details."}{!alertUpdates.isError && !alertUpdates.isLoading && stripHtml(latestUpdate?.message ?? primary.description ?? "").length > 240 ? "…" : ""}</p>
        </div>}
        {primary && <p className="af-content" data-testid="text-dashboard-alert-guidance">We’re aware of this issue. Please check the latest update before opening a ticket about it.</p>}
        <div className="af-actions"><Link href={actionHref} className="af-button" data-testid="link-dashboard-status-details">{canViewLatest ? "View latest update" : primary ? "View alert" : issue ? "View alerts" : "View service details"}<ArrowRight size={15} /></Link></div>
        <span className="af-health-count" data-testid="text-active-alerts-count">{health.mode === "monitoring" ? "Monitoring" : `${health.problems.length} active ${health.problems.length === 1 ? "alert" : "alerts"}`}</span>
      </section>}
    {!uncertain && health.active.length > 1 && <Link href="/alerts" className="af-row" data-testid="link-view-all-alerts"><span className="af-row-title">View all {health.active.length} active alerts<span className="af-row-meta">Includes service issues and alerts being monitored</span></span><ChevronRight size={16} /></Link>}

    <Section title="Your services" icon={Activity} href="/services" action="See all">
      {servicesQuery.isLoading ? <RowsLoading /> : servicesQuery.isError ? <QueryErrorState error={servicesQuery.error} onRetry={() => void servicesQuery.refetch()} isRetrying={servicesQuery.isFetching} resourceName="services" data-testid="error-dashboard-services" className="py-4" /> : !displayServices.length ? <div className="af-content">No services to display. <Link href="/settings" className="af-small-link" data-testid="link-follow-services">Follow services</Link></div> : displayServices.map(service => {
        const monitoring = !uncertain && health.monitoring.some(alert => alert.serviceIds.includes(service.id)) && service.status === "operational";
        const meta = serviceStatusMeta[service.status];
        const label = uncertain ? "Unknown" : monitoring ? "Monitoring" : meta?.label ?? "Unknown";
        const tone = uncertain || !meta ? "neutral" : monitoring ? "watch" : service.status === "operational" ? "ok" : service.status === "outage" ? "danger" : service.status === "maintenance" ? "neutral" : "warn";
        const uptime = uptimeQuery.data?.[service.id];
        return <Link href={`/services/${service.id}`} className="af-row" key={service.id} data-testid={`service-row-${service.id}`}><span className={`af-dot ${tone}`} /><span className="af-row-title">{service.name}</span>
          {!uncertain && uptime?.dailyBuckets?.length ? <span className="hidden sm:flex gap-px shrink-0" data-testid={`sparkline-service-${service.id}`} aria-label="30-day service history">{uptime.dailyBuckets.map((bucket, i) => <span key={i} title={`${bucket.date}: ${bucket.status}`} className={`w-[3px] h-3 rounded-sm ${bucket.status === "up" ? "bg-status-online" : bucket.status === "down" ? "bg-status-busy" : bucket.status === "partial" ? "bg-status-away" : "bg-muted"}`} />)}</span> : null}
          <span className={`af-pill ${tone}`}>{label}</span><ChevronRight size={15} /></Link>;
      })}
      {!user?.subscribedServices?.length && displayServices.length > 0 && <div className="af-content"><Link href="/settings" className="af-small-link" data-testid="link-follow-services">Follow your services for personalized updates</Link></div>}
    </Section>

    <Section title="Support" icon={LifeBuoy} href="/tickets" action="Get help">
      {ticketsQuery.isLoading ? <RowsLoading /> : ticketsQuery.isError ? <QueryErrorState error={ticketsQuery.error} onRetry={() => void ticketsQuery.refetch()} isRetrying={ticketsQuery.isFetching} resourceName="tickets" data-testid="error-dashboard-tickets" className="py-4" /> : <>
        {openTickets.length > 0 ? openTickets.slice(0, 4).map(ticket => <Link href={`/tickets/${ticket.id}`} className="af-row" key={ticket.id} data-testid={`ticket-row-${ticket.id}`}><span className="af-support-icon"><MessageSquare size={16} /></span><span className="af-support-copy">{ticket.subject}<small>Updated {relative(ticket.lastCommunicationAt ?? ticket.createdAt)}</small></span><span className={`af-pill ${ticketStatusPill[ticket.status] ?? "neutral"}`}>{ticket.status}</span><ChevronRight size={15} /></Link>) : <p className="af-content">You don’t have any open tickets.</p>}
        {openTickets.length > 0 && <p className="af-content" data-testid="text-open-tickets-count">{openTickets.length} open {openTickets.length === 1 ? "ticket" : "tickets"}</p>}
        <div className="af-support"><span className="af-support-icon"><Ticket size={16} /></span><span className="af-support-copy">Need a hand?<small>Browse help or start a support request.</small></span><Link href="/tickets" className="af-small-link" data-testid="button-open-ticket">Contact</Link></div>
      </>}
    </Section>

    <Section title="Recent service updates" icon={Bell} href="/service-updates" testId="link-view-all-service-updates">
      {updatesQuery.isLoading ? <RowsLoading /> : updatesQuery.isError ? <QueryErrorState error={updatesQuery.error} onRetry={() => void updatesQuery.refetch()} isRetrying={updatesQuery.isFetching} resourceName="service updates" data-testid="error-dashboard-service-updates" className="py-4" /> : !updatesQuery.data?.length ? <p className="af-content">No service updates yet</p> : updatesQuery.data.slice(0, 3).map(update => <Link href={`/service-updates?highlight=${update.id}`} className="af-row" key={update.id} data-testid={`update-row-${update.id}`}><span className="af-dot info" /><span className="af-row-title">{update.title} {unreadUpdates.has(update.id) && <NewBadge />}<span className="af-row-meta">{serviceMap.get(update.serviceId) ?? "Service"} · {relative(update.createdAt)}</span><span className="af-update-excerpt line-clamp-2">{stripHtml(update.description ?? "")}</span></span><ChevronRight size={15} /></Link>)}
    </Section>
    <Section title="News" icon={Newspaper} href="/news" testId="link-view-all-news">
      {newsQuery.isLoading ? <RowsLoading /> : newsQuery.isError ? <QueryErrorState error={newsQuery.error} onRetry={() => void newsQuery.refetch()} isRetrying={newsQuery.isFetching} resourceName="news" data-testid="error-dashboard-news" className="py-4" /> : !newsQuery.data?.length ? <p className="af-content">No news stories yet</p> : newsQuery.data.slice(0, 3).map(story => <Link href={`/news/${story.id}`} className="af-row" key={story.id} data-testid={`news-row-${story.id}`}><span className="af-row-title">{story.title} {unreadNews.has(story.id) && <NewBadge />}<span className="af-row-meta">{dashboardDate(story.createdAt) ? format(new Date(story.createdAt), "MMM d") : "Date unavailable"}</span><span className="af-update-excerpt line-clamp-2">{stripHtml(story.content)}</span></span><ChevronRight size={15} /></Link>)}
    </Section>
    {promosQuery.isError ? <Section title="Customer offers" icon={Gift} href="/promotions" action="See offers"><QueryErrorState error={promosQuery.error} onRetry={() => void promosQuery.refetch()} isRetrying={promosQuery.isFetching} resourceName="offers" className="py-4" /></Section> : promosQuery.isLoading ? <Section title="Customer offers" icon={Gift} href="/promotions" action="See offers"><RowsLoading /></Section> : <PromoOffers promotions={promosQuery.data ?? []} />}
    {!uncertain && checkedAt > 0 && <div className="af-footer"><Clock3 size={10} aria-hidden="true" />Status checked {relative(checkedAt)}</div>}
  </div>;
}
