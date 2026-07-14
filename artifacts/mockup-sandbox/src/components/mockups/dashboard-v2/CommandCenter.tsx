import {
  Activity,
  AlertTriangle,
  Bell,
  ChevronRight,
  CircleDot,
  Info,
  LifeBuoy,
  Newspaper,
  ShieldCheck,
} from "lucide-react";
import {
  activeAlerts,
  counts,
  news,
  services,
  tickets,
  userName,
  type MockService,
  type ServiceStatus,
} from "./_data";

const statusDot: Record<ServiceStatus, string> = {
  operational: "bg-status-online",
  degraded: "bg-status-away",
  outage: "bg-status-busy",
  maintenance: "bg-status-offline",
};

const statusLabel: Record<ServiceStatus, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  maintenance: "Maintenance",
};

function ServiceTile({ service }: { service: MockService }) {
  return (
    <div className="flex flex-col justify-between gap-3 rounded-md border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot[service.status]}`} />
          <span className="truncate text-sm font-medium text-foreground">{service.name}</span>
        </div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-xs text-muted-foreground">{statusLabel[service.status]}</span>
        <div className="text-right leading-none">
          <div className="text-sm font-semibold tabular-nums text-foreground">{service.uptime30d}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">30d uptime</div>
        </div>
      </div>
    </div>
  );
}

const severityStyles: Record<
  string,
  { chip: string; icon: typeof AlertTriangle; label: string }
> = {
  critical: { chip: "bg-status-busy text-foreground", icon: AlertTriangle, label: "Critical" },
  warning: { chip: "bg-status-away text-background", icon: AlertTriangle, label: "Warning" },
  info: { chip: "bg-status-offline text-foreground", icon: Info, label: "Info" },
};

export function CommandCenter() {
  const issues = services.filter((s) => s.status === "degraded" || s.status === "outage").length;
  const maintenance = services.filter((s) => s.status === "maintenance").length;
  const operational = services.filter((s) => s.status === "operational").length;
  const allClear = issues === 0 && maintenance === 0;

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground font-sans antialiased p-6">
      <div className="mx-auto w-full max-w-[1280px] space-y-4">
        {/* Greeting + system health pill */}
        <header className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-foreground">Good afternoon, {userName}</h1>
            <p className="text-sm text-muted-foreground">
              Here's your service command center at a glance.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">{counts.unreadNotifications}</span>
              <span className="text-xs text-muted-foreground">unread</span>
            </div>
            <div className="flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2">
              {allClear ? (
                <ShieldCheck className="h-4 w-4 text-status-online" />
              ) : (
                <Activity className="h-4 w-4 text-status-away" />
              )}
              <span className="text-sm font-medium text-foreground">
                {allClear ? "All systems operational" : `${issues} issue${issues === 1 ? "" : "s"}, ${maintenance} maintenance`}
              </span>
              <span className="flex items-center gap-1 pl-1">
                <span className="h-2 w-2 rounded-full bg-status-online" />
                <span className="text-xs tabular-nums text-muted-foreground">{operational}</span>
              </span>
            </div>
          </div>
        </header>

        {/* Bento grid */}
        <div className="grid grid-cols-12 gap-4">
          {/* Service health matrix */}
          <section className="col-span-12 rounded-md border border-border bg-card p-5 lg:col-span-8">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CircleDot className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Service Health</h2>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-status-online" />
                  {operational} up
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-status-away" />
                  {issues} degraded
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-status-offline" />
                  {maintenance} maint.
                </span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {services.map((service) => (
                <ServiceTile key={service.id} service={service} />
              ))}
            </div>
          </section>

          {/* Active alerts rail */}
          <section className="col-span-12 rounded-md border border-border bg-card p-5 lg:col-span-4">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-status-away" />
                <h2 className="text-sm font-semibold text-foreground">Active Alerts</h2>
              </div>
              <span className="rounded-full bg-status-away px-2 py-0.5 text-xs font-semibold tabular-nums text-background">
                {counts.activeAlerts}
              </span>
            </div>
            <div className="space-y-3">
              {activeAlerts.map((alert) => {
                const sev = severityStyles[alert.severity];
                const SevIcon = sev.icon;
                return (
                  <div key={alert.id} className="rounded-md border border-border bg-background p-3">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sev.chip}`}>
                        <SevIcon className="h-3 w-3" />
                        {sev.label}
                      </span>
                      <span className="text-[11px] text-muted-foreground">{alert.startedAgo}</span>
                    </div>
                    <div className="text-sm font-medium leading-snug text-foreground">{alert.title}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">{alert.serviceNames.join(", ")}</div>
                    <p className="mt-1.5 text-xs leading-snug text-muted-foreground">{alert.latestUpdate}</p>
                  </div>
                );
              })}
            </div>
          </section>

          {/* Open tickets */}
          <section className="col-span-12 rounded-md border border-border bg-card p-5 lg:col-span-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Open Tickets</h2>
              </div>
              <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-semibold tabular-nums text-background">
                {counts.openTickets}
              </span>
            </div>
            <div className="space-y-2.5">
              {tickets.map((ticket) => (
                <div
                  key={ticket.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{ticket.subject}</div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <span className={`h-1.5 w-1.5 rounded-full ${ticket.status === "open" ? "bg-status-online" : "bg-status-away"}`} />
                      {ticket.lastMessageFrom === "support" ? "Support replied" : "You replied"}
                      <span className="text-muted-foreground/70">· {ticket.lastActivity}</span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </div>
              ))}
            </div>
          </section>

          {/* Latest news */}
          <section className="col-span-12 rounded-md border border-border bg-card p-5 lg:col-span-6">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-sm font-semibold text-foreground">Latest News</h2>
              </div>
              <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground">
                {counts.newsStories}
              </span>
            </div>
            <div className="divide-y divide-border">
              {news.map((item) => (
                <div key={item.id} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div className="mt-0.5 shrink-0 rounded-md border border-border bg-background px-2 py-1 text-center">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{item.date}</div>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{item.title}</div>
                    <p className="truncate text-xs text-muted-foreground">{item.excerpt}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <Activity className="h-3 w-3" />
          {counts.newServiceUpdates} new service updates this week
        </footer>
      </div>
    </div>
  );
}
