import {
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  ArrowRight,
  MessageSquare,
  Plus,
  Newspaper,
  Bell,
} from "lucide-react";
import {
  services,
  activeAlerts,
  tickets,
  news,
  userName,
  type ServiceStatus,
} from "./_data";

const statusMeta: Record<ServiceStatus, { label: string; dot: string; text: string }> = {
  operational: { label: "Operational", dot: "bg-status-online", text: "text-muted-foreground" },
  degraded: { label: "Degraded", dot: "bg-status-away", text: "text-status-away" },
  outage: { label: "Outage", dot: "bg-status-busy", text: "text-status-busy" },
  maintenance: { label: "Maintenance", dot: "bg-status-offline", text: "text-muted-foreground" },
};

const serviceUpdates = [
  { id: "u1", title: "Delayed outbound email delivery", service: "Email Platform", when: "42 min ago", isNew: true },
  { id: "u2", title: "Scheduled maintenance: VPN Gateway upgrade", service: "VPN Gateway", when: "2 hr ago", isNew: true },
  { id: "u3", title: "Resolved: brief DNS lookup slowness", service: "DNS & Domains", when: "Yesterday", isNew: false },
];

const newsWithFlags = news.map((n, i) => ({ ...n, isNew: i === 0 }));

export function HeroStackPage({ allClear }: { allClear: boolean }) {
  const shownServices = services.filter((s) => s.subscribed);
  const displayServices = allClear
    ? shownServices.map((s) => ({ ...s, status: "operational" as ServiceStatus }))
    : shownServices;
  const openTickets = allClear ? [] : tickets;
  const firstAlert = activeAlerts[0];

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground font-sans antialiased p-6">
      <div className="mx-auto w-full max-w-[860px] space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-xl font-semibold leading-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Welcome back, {userName}</p>
        </div>

        {/* Hero */}
        {allClear ? (
          <div
            className="rounded-xl border border-status-online/40 bg-status-online/10 p-6 flex items-center gap-4"
            data-testid="hero-status"
          >
            <CheckCircle2 className="h-10 w-10 text-status-online shrink-0" />
            <div>
              <p className="text-lg font-semibold text-status-online">All services are running smoothly</p>
              <p className="text-sm text-muted-foreground">
                Every service you're subscribed to is operational. Nothing needs your attention.
              </p>
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border border-status-away/40 bg-status-away/10 p-6"
            data-testid="hero-status"
          >
            <div className="flex items-start gap-4">
              <AlertTriangle className="h-10 w-10 text-status-away shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-lg font-semibold text-status-away">
                  We're currently experiencing an issue
                </p>
                <p className="text-sm text-muted-foreground">
                  {firstAlert.title} — {firstAlert.serviceNames.join(", ")} · started {firstAlert.startedAgo}
                </p>
              </div>
              <button className="shrink-0 inline-flex items-center gap-1.5 rounded-md bg-status-away/20 px-3 py-2 text-sm font-medium text-status-away hover:bg-status-away/30">
                View alert <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Services */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold">Your services</h2>
            <span className="text-xs text-muted-foreground">Click a service for alerts &amp; history</span>
          </div>
          <ul className="divide-y divide-border">
            {displayServices.map((s) => {
              const meta = statusMeta[s.status];
              return (
                <li key={s.id}>
                  <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/50">
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} shrink-0`} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{s.name}</span>
                    <span className={`text-xs font-medium ${meta.text}`}>{meta.label}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Tickets */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-muted-foreground" /> Your support tickets
            </h2>
            {openTickets.length > 0 && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">{openTickets.length} open</span>
            )}
          </div>
          {openTickets.length === 0 ? (
            <div className="px-5 py-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">You don't have any open tickets.</p>
              <button className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                <Plus className="h-4 w-4" /> Open a ticket
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {openTickets.map((t) => (
                <li key={t.id}>
                  <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{t.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.lastActivity} · {t.lastMessageFrom === "support" ? "Support replied" : "Awaiting support"}
                      </p>
                    </div>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">{t.status}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Service updates */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" /> Recent service updates
            </h2>
            <button className="text-xs font-medium text-primary hover:underline">View all</button>
          </div>
          <ul className="divide-y divide-border">
            {(allClear ? serviceUpdates.map((u) => ({ ...u, isNew: false })) : serviceUpdates).map((u) => (
              <li key={u.id}>
                <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      {u.title}
                      {u.isNew && (
                        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                          New
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{u.service} · {u.when}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              </li>
            ))}
          </ul>
        </section>

        {/* News */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Newspaper className="h-4 w-4 text-muted-foreground" /> Latest news
            </h2>
            <button className="text-xs font-medium text-primary hover:underline">View all</button>
          </div>
          <ul className="divide-y divide-border">
            {newsWithFlags.map((n) => (
              <li key={n.id}>
                <button className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-muted/50">
                  <span className="mt-0.5 shrink-0 text-xs text-muted-foreground w-10">{n.date}</span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      {n.title}
                      {n.isNew && (
                        <span className="rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground">
                          New
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{n.excerpt}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export function HeroStack() {
  return <HeroStackPage allClear={false} />;
}
