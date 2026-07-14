import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronRight,
  Clock,
  MessageSquare,
  Newspaper,
  Ticket,
  Wrench,
} from "lucide-react";
import { services, activeAlerts, tickets, news, counts, userName } from "./_data";
import type { ServiceStatus, MockService } from "./_data";

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

function alertForService(name: string) {
  return activeAlerts.find((a) => a.serviceNames.includes(name));
}

type FeedItem = {
  id: string;
  kind: "alert" | "ticket" | "news";
  title: string;
  meta: string;
  time: string;
};

const feed: FeedItem[] = [
  {
    id: tickets[0].id,
    kind: "ticket",
    title: tickets[0].subject,
    meta:
      tickets[0].lastMessageFrom === "support"
        ? "Support replied"
        : "You replied",
    time: tickets[0].lastActivity,
  },
  {
    id: activeAlerts[0].id,
    kind: "alert",
    title: activeAlerts[0].title,
    meta: activeAlerts[0].latestUpdate,
    time: activeAlerts[0].startedAgo,
  },
  {
    id: activeAlerts[1].id,
    kind: "alert",
    title: activeAlerts[1].title,
    meta: activeAlerts[1].latestUpdate,
    time: activeAlerts[1].startedAgo,
  },
  {
    id: tickets[1].id,
    kind: "ticket",
    title: tickets[1].subject,
    meta:
      tickets[1].lastMessageFrom === "support"
        ? "Support replied"
        : "Awaiting your reply",
    time: tickets[1].lastActivity,
  },
  {
    id: news[0].id,
    kind: "news",
    title: news[0].title,
    meta: news[0].excerpt,
    time: news[0].date,
  },
  {
    id: news[1].id,
    kind: "news",
    title: news[1].title,
    meta: news[1].excerpt,
    time: news[1].date,
  },
  {
    id: news[2].id,
    kind: "news",
    title: news[2].title,
    meta: news[2].excerpt,
    time: news[2].date,
  },
];

const feedIcon = {
  alert: AlertTriangle,
  ticket: MessageSquare,
  news: Newspaper,
} as const;

function ServiceRow({ svc }: { svc: MockService }) {
  const alert = alertForService(svc.name);
  const expanded = svc.status === "degraded" || svc.status === "outage";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${statusDot[svc.status]}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {svc.name}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground">{statusLabel[svc.status]}</span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
          {svc.uptime30d}
        </span>
      </div>
      {expanded && alert && (
        <div className="mt-2 flex items-start gap-2 rounded-md bg-background px-2.5 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-away" />
          <div className="min-w-0">
            <p className="text-xs font-medium leading-tight text-foreground">{alert.title}</p>
            <p className="mt-0.5 text-xs leading-tight text-muted-foreground">
              {alert.latestUpdate} · {alert.startedAgo}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

export function SplitPanels() {
  const issues = services.filter((s) => s.status === "degraded" || s.status === "outage");
  const maintenance = services.filter((s) => s.status === "maintenance");
  const operational = services.filter((s) => s.status === "operational");

  const groups = [
    { key: "issues", label: "Issues", icon: AlertTriangle, items: issues },
    { key: "maintenance", label: "Maintenance", icon: Wrench, items: maintenance },
    { key: "operational", label: "Operational", icon: CheckCircle2, items: operational },
  ].filter((g) => g.items.length > 0);

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground font-sans antialiased p-6">
      <div className="mx-auto max-w-[1280px]">
        {/* Page header */}
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Welcome back, {userName}</h1>
            <p className="text-sm text-muted-foreground">
              {counts.activeAlerts} active alert{counts.activeAlerts === 1 ? "" : "s"} across{" "}
              {counts.services} subscribed services.
            </p>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-online" /> Operational {operational.length}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-away" /> Issues {issues.length}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-status-offline" /> Maintenance {maintenance.length}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_2fr]">
          {/* LEFT: Your services (spatial) */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Your services</h2>
              <span className="text-xs text-muted-foreground">30-day uptime</span>
            </div>

            <div className="space-y-4">
              {groups.map((group) => {
                const GroupIcon = group.icon;
                return (
                  <div key={group.key}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <GroupIcon
                        className={`h-3.5 w-3.5 ${
                          group.key === "issues"
                            ? "text-status-away"
                            : group.key === "maintenance"
                              ? "text-status-offline"
                              : "text-status-online"
                        }`}
                      />
                      <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {group.label}
                      </span>
                      <span className="text-xs text-muted-foreground">· {group.items.length}</span>
                    </div>
                    <div className="space-y-1.5">
                      {group.items.map((svc) => (
                        <ServiceRow key={svc.id} svc={svc} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* RIGHT: Activity timeline (temporal) */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Activity</h2>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Ticket className="h-3.5 w-3.5" /> {counts.openTickets} open
                </span>
                <span className="flex items-center gap-1">
                  <Bell className="h-3.5 w-3.5" /> {counts.newServiceUpdates} unread
                </span>
              </div>
            </div>

            <div className="rounded-md border border-border bg-card">
              {feed.map((item, i) => {
                const Icon = feedIcon[item.kind];
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-3 py-2.5 ${
                      i !== feed.length - 1 ? "border-b border-border" : ""
                    }`}
                  >
                    <div
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                        item.kind === "alert"
                          ? "bg-status-away/15 text-status-away"
                          : item.kind === "ticket"
                            ? "bg-primary/15 text-primary"
                            : "bg-background text-muted-foreground"
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium leading-tight text-foreground">
                          {item.title}
                        </p>
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {item.time}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-xs leading-tight text-muted-foreground">
                        {item.meta}
                      </p>
                    </div>
                    <ChevronRight className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground/50" />
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
