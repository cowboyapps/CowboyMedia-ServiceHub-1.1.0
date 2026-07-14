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

const statusMeta: Record<
  ServiceStatus,
  { label: string; dot: string; pill: string }
> = {
  operational: {
    label: "Operational",
    dot: "bg-status-online",
    pill: "bg-status-online/15 text-status-online",
  },
  degraded: {
    label: "Degraded",
    dot: "bg-status-away",
    pill: "bg-status-away/15 text-status-away",
  },
  outage: {
    label: "Outage",
    dot: "bg-status-busy",
    pill: "bg-status-busy/15 text-status-busy",
  },
  maintenance: {
    label: "Maintenance",
    dot: "bg-status-offline",
    pill: "bg-status-offline/20 text-muted-foreground",
  },
};

const ticketStatusPill: Record<string, string> = {
  open: "bg-status-online/15 text-status-online",
  waiting: "bg-status-away/15 text-status-away",
  resolved: "bg-muted text-muted-foreground",
};

const serviceUpdates = [
  { id: "u1", title: "Delayed outbound email delivery", service: "Email Platform", when: "42 min ago", isNew: true, tone: "bg-status-away" },
  { id: "u2", title: "Scheduled maintenance: VPN Gateway upgrade", service: "VPN Gateway", when: "2 hr ago", isNew: true, tone: "bg-status-offline" },
  { id: "u3", title: "Resolved: brief DNS lookup slowness", service: "DNS & Domains", when: "Yesterday", isNew: false, tone: "bg-status-online" },
];

const newsWithFlags = news.map((n, i) => ({ ...n, isNew: i === 0 }));

function SectionIcon({ icon: Icon, tone }: { icon: typeof Bell; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

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
          <h1 className="text-2xl font-bold" data-testid="text-dashboard-title">Welcome, {userName}</h1>
          <p className="text-muted-foreground text-sm mt-1">Here's an overview of your services and recent activity</p>
        </div>

        {/* Hero */}
        {allClear ? (
          <div
            className="rounded-xl border border-status-online/40 ring-1 ring-inset ring-status-online/20 bg-gradient-to-br from-status-online/20 via-status-online/10 to-transparent p-6 flex items-center gap-4 shadow-sm"
            data-testid="hero-status"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-status-online/15 ring-1 ring-status-online/30">
              <CheckCircle2 className="h-6 w-6 text-status-online" />
            </span>
            <div>
              <p className="text-lg font-semibold text-status-online">All services are running smoothly</p>
              <p className="text-sm text-muted-foreground">
                Every service you're subscribed to is operational. Nothing needs your attention.
              </p>
            </div>
          </div>
        ) : (
          <button
            className="w-full rounded-xl border border-status-away/40 ring-1 ring-inset ring-status-away/20 bg-gradient-to-br from-status-away/20 via-status-away/10 to-transparent p-6 flex items-center gap-4 text-left shadow-sm hover:ring-status-away/40 transition"
            data-testid="hero-status"
          >
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-status-away/15 ring-1 ring-status-away/30">
              <AlertTriangle className="h-6 w-6 text-status-away animate-status-pulse" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-status-away">We're currently experiencing an issue</p>
              <p className="text-sm text-muted-foreground">
                {firstAlert.title} — {firstAlert.serviceNames.join(", ")} · started {firstAlert.startedAgo} · tap to view the alert
              </p>
            </div>
            <ChevronRight className="h-5 w-5 shrink-0 text-status-away" />
          </button>
        )}

        {/* Services */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={CheckCircle2} tone="bg-status-online/15 text-status-online" />
              Your services
            </h2>
            <span className="text-xs text-muted-foreground">Click a service for alerts &amp; history</span>
          </div>
          <ul className="divide-y divide-border">
            {displayServices.map((s) => {
              const meta = statusMeta[s.status];
              return (
                <li key={s.id}>
                  <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-accent/60 transition-colors">
                    <span className={`h-2.5 w-2.5 rounded-full ${meta.dot} shrink-0 ${s.status !== "operational" ? "animate-status-pulse" : ""}`} />
                    <span className="flex-1 min-w-0 truncate text-sm font-medium">{s.name}</span>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.pill}`}>
                      {meta.label}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* Tickets */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={MessageSquare} tone="bg-primary/10 text-primary" />
              Your support tickets
            </h2>
            {openTickets.length > 0 && (
              <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-medium text-primary">
                {openTickets.length} open
              </span>
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
                  <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-accent/60 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium">{t.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        {t.lastActivity} · {t.lastMessageFrom === "support" ? "Support replied" : "Awaiting support"}
                      </p>
                    </div>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${ticketStatusPill[t.status]}`}>
                      {t.status}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Service updates */}
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={Bell} tone="bg-status-away/10 text-status-away" />
              Recent service updates
            </h2>
            <button className="text-xs font-medium text-primary hover:underline">View all</button>
          </div>
          <ul className="divide-y divide-border">
            {(allClear ? serviceUpdates.map((u) => ({ ...u, isNew: false })) : serviceUpdates).map((u) => (
              <li key={u.id}>
                <button className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-accent/60 transition-colors">
                  <span className={`h-2 w-2 rounded-full ${u.tone} shrink-0`} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      {u.title}
                      {u.isNew && (
                        <span className="rounded-full bg-status-busy px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background">
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
        <section className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={Newspaper} tone="bg-status-online/15 text-status-online" />
              Latest news
            </h2>
            <button className="text-xs font-medium text-primary hover:underline">View all</button>
          </div>
          <ul className="divide-y divide-border">
            {newsWithFlags.map((n) => (
              <li key={n.id}>
                <button className="w-full flex items-start gap-3 px-5 py-3.5 text-left hover:bg-accent/60 transition-colors">
                  <span className="mt-0.5 shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                    {n.date}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-medium flex items-center gap-2">
                      {n.title}
                      {n.isNew && (
                        <span className="rounded-full bg-status-busy px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background">
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
