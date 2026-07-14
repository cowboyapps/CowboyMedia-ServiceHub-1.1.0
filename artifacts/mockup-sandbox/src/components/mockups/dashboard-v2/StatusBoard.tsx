import {
  Activity,
  AlertTriangle,
  LifeBuoy,
  Bell,
  ChevronRight,
  ArrowUpRight,
  MessageSquare,
  Clock,
  Newspaper,
} from "lucide-react";
import {
  services,
  activeAlerts,
  tickets,
  news,
  counts,
  userName,
  type ServiceStatus,
} from "./_data";

const statusMeta: Record<
  ServiceStatus,
  { label: string; dot: string; tint: string; text: string }
> = {
  operational: {
    label: "Operational",
    dot: "bg-status-online",
    tint: "",
    text: "text-muted-foreground",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-status-away",
    tint: "bg-status-away/10",
    text: "text-foreground",
  },
  outage: {
    label: "Outage",
    dot: "bg-status-busy",
    tint: "bg-status-busy/10",
    text: "text-foreground",
  },
  maintenance: {
    label: "Maintenance",
    dot: "bg-status-offline",
    tint: "bg-status-offline/10",
    text: "text-foreground",
  },
};

const kpis = [
  { label: "Services", value: counts.services, icon: Activity, accent: "text-foreground" },
  { label: "Active alerts", value: counts.activeAlerts, icon: AlertTriangle, accent: "text-status-away" },
  { label: "Open tickets", value: counts.openTickets, icon: LifeBuoy, accent: "text-foreground" },
  { label: "Unread updates", value: counts.newServiceUpdates, icon: Bell, accent: "text-foreground" },
];

const alertByService = new Map<string, (typeof activeAlerts)[number]>();
for (const a of activeAlerts) {
  for (const name of a.serviceNames) {
    if (!alertByService.has(name)) alertByService.set(name, a);
  }
}

export function StatusBoard() {
  return (
    <div className="dark min-h-screen w-full bg-background text-foreground font-sans antialiased p-6">
      <div className="mx-auto w-full max-w-[1280px] space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold leading-tight">Status Board</h1>
            <p className="text-sm text-muted-foreground">
              Welcome back, {userName} — here's everything at a glance.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="inline-block h-2 w-2 rounded-full bg-status-online" />
            Live · updated just now
          </div>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-4 gap-3">
          {kpis.map((k) => {
            const Icon = k.icon;
            return (
              <button
                key={k.label}
                className="hover-elevate active-elevate-2 flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-left"
              >
                <div className="flex flex-col">
                  <span className={`text-2xl font-semibold leading-none ${k.accent}`}>
                    {k.value}
                  </span>
                  <span className="mt-1.5 text-xs text-muted-foreground">{k.label}</span>
                </div>
                <Icon className="h-5 w-5 text-muted-foreground" />
              </button>
            );
          })}
        </div>

        {/* Service board */}
        <div className="overflow-hidden rounded-md border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-semibold">Service health</h2>
            <span className="text-xs text-muted-foreground">30-day uptime</span>
          </div>

          {/* Column header row */}
          <div className="grid grid-cols-[1.6fr_1fr_1fr] items-center gap-4 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <span>Service</span>
            <span>Status</span>
            <span className="text-right">Uptime</span>
          </div>

          <div className="divide-y divide-border">
            {services.map((s) => {
              const meta = statusMeta[s.status];
              const alert = alertByService.get(s.name);
              return (
                <div
                  key={s.id}
                  className={`grid grid-cols-[1.6fr_1fr_1fr] items-center gap-4 px-4 py-3 ${meta.tint}`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`h-2.5 w-2.5 flex-shrink-0 rounded-full ${meta.dot}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{s.name}</span>
                        {!s.subscribed && (
                          <span className="rounded-sm border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            Not subscribed
                          </span>
                        )}
                      </div>
                      {alert && (
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <AlertTriangle className="h-3 w-3 flex-shrink-0 text-status-away" />
                          <span className="truncate">{alert.latestUpdate}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${meta.text}`}>{meta.label}</span>
                  </div>
                  <div className="text-right text-sm font-medium tabular-nums">
                    {s.uptime30d}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer zone */}
        <div className="grid grid-cols-2 gap-4">
          {/* Needs your attention */}
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-semibold">Needs your attention</h2>
              <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                {tickets.length + activeAlerts.length}
              </span>
            </div>
            <div className="divide-y divide-border">
              {tickets.map((t) => (
                <button
                  key={t.id}
                  className="hover-elevate flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  <MessageSquare className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{t.subject}</div>
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      {t.lastActivity}
                      <span>·</span>
                      {t.lastMessageFrom === "support" ? "Support replied" : "Awaiting support"}
                    </div>
                  </div>
                  {t.lastMessageFrom === "support" && (
                    <span className="rounded-sm bg-status-away/15 px-1.5 py-0.5 text-[10px] font-medium text-status-away">
                      Reply
                    </span>
                  )}
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}
              {activeAlerts.map((a) => (
                <button
                  key={a.id}
                  className="hover-elevate flex w-full items-center gap-3 px-4 py-2.5 text-left"
                >
                  <AlertTriangle
                    className={`h-4 w-4 flex-shrink-0 ${
                      a.severity === "warning" ? "text-status-away" : "text-muted-foreground"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{a.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.serviceNames.join(", ")} · {a.startedAgo}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              ))}
            </div>
          </div>

          {/* Latest news */}
          <div className="overflow-hidden rounded-md border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                Latest news
              </h2>
              <button className="hover-elevate flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground">
                View all
                <ArrowUpRight className="h-3 w-3" />
              </button>
            </div>
            <div className="divide-y divide-border">
              {news.map((n) => (
                <button
                  key={n.id}
                  className="hover-elevate flex w-full items-start gap-3 px-4 py-2.5 text-left"
                >
                  <span className="mt-0.5 w-10 flex-shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
                    {n.date}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{n.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{n.excerpt}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
