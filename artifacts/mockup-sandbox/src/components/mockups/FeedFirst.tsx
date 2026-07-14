import { AppChrome } from "./_shared/AppChrome";
import "./_group.css";
import {
  AlertTriangle,
  MessageSquare,
  Newspaper,
  Zap,
  CheckCircle2,
  ChevronRight,
} from "lucide-react";

const services = [
  { id: "s1", name: "Web Hosting", status: "operational" },
  { id: "s2", name: "Game Servers", status: "operational" },
  { id: "s3", name: "VPS Hosting", status: "degraded" },
  { id: "s4", name: "Discord Bot", status: "operational" },
];

const feedGroups = [
  {
    date: "Today",
    items: [
      {
        id: "f1",
        type: "alert",
        title: "VPS node maintenance window",
        subtitle: "Active Alert • VPS Hosting",
        time: "9:00 AM",
        icon: AlertTriangle,
        iconColor: "text-amber-500",
        iconBg: "bg-amber-500/10",
        isUnread: true,
      },
      {
        id: "f4",
        type: "alert",
        title: "Intermittent latency on EU game servers",
        subtitle: "Active Alert • Game Servers",
        time: "6:42 AM",
        icon: AlertTriangle,
        iconColor: "text-amber-500",
        iconBg: "bg-amber-500/10",
        isUnread: true,
      },
      {
        id: "f2",
        type: "ticket",
        title: "Support replied to your ticket",
        subtitle: "Ticket #4992 • Awaiting your reply",
        time: "11:30 AM",
        icon: MessageSquare,
        iconColor: "text-primary",
        iconBg: "bg-primary/10",
        isUnread: true,
      },
      {
        id: "f3",
        type: "update",
        title: "Game server fleet upgraded to NVMe",
        subtitle: "Service Update • Performance",
        time: "2:15 PM",
        icon: Zap,
        iconColor: "text-orange-300",
        iconBg: "bg-orange-300/10",
      },
    ],
  },
  {
    date: "Yesterday",
    items: [
      {
        id: "f5",
        type: "update",
        title: "Introducing per-service email follows",
        subtitle: "Service Update • Features",
        time: "1:00 PM",
        icon: Zap,
        iconColor: "text-orange-300",
        iconBg: "bg-orange-300/10",
      },
      {
        id: "f6",
        type: "update",
        title: "Node.js 20 now available on all plans",
        subtitle: "Service Update • Environments",
        time: "10:15 AM",
        icon: Zap,
        iconColor: "text-orange-300",
        iconBg: "bg-orange-300/10",
      },
    ],
  },
  {
    date: "Earlier This Week",
    items: [
      {
        id: "f7",
        type: "news",
        title: "New customer dashboard is coming",
        subtitle: "Company News • Sneak Peek",
        time: "Jul 11",
        icon: Newspaper,
        iconColor: "text-muted-foreground",
        iconBg: "bg-muted",
      },
    ],
  },
];

export function FeedFirst() {
  const degradedCount = services.filter((s) => s.status !== "operational").length;

  return (
    <AppChrome>
      <div className="relative min-h-full pb-6">
        {/* Always-visible slim status strip */}
        <div className="sticky top-0 z-20 -mx-3 -mt-3 mb-6 flex items-center justify-between border-b border-border/50 bg-background/95 px-4 py-3 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-1">
              {services.map((service) => (
                <div
                  key={service.id}
                  className={`h-2.5 w-2.5 rounded-full ring-2 ring-background ${
                    service.status === "operational"
                      ? "bg-emerald-500"
                      : "bg-amber-500 animate-status-pulse"
                  }`}
                />
              ))}
            </div>
            <div className="text-sm font-medium">
              {degradedCount === 0 ? (
                <span className="text-emerald-500">All systems operational</span>
              ) : (
                <span className="text-amber-500">1 service degraded</span>
              )}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-50" />
        </div>

        {/* Welcome Text */}
        <div className="mb-6 px-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Feed
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Hi Jake, here's what's happening.
          </p>
        </div>

        {/* Unified Chronological Feed */}
        <div className="space-y-8 px-1">
          {feedGroups.map((group, groupIndex) => (
            <div key={group.date} className="stagger-item">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                {group.date}
              </h2>
              <div className="relative space-y-4">
                {/* Timeline line */}
                <div className="absolute bottom-2 left-[19px] top-2 w-[2px] bg-border/40" />

                {group.items.map((item, itemIndex) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.id}
                      className="group relative flex items-start gap-4 tap-interactive cursor-pointer"
                    >
                      {/* Icon container */}
                      <div className="relative z-10 flex flex-col items-center">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-full ring-4 ring-background ${item.iconBg}`}
                        >
                          <Icon className={`h-4 w-4 ${item.iconColor}`} />
                        </div>
                      </div>

                      {/* Content Card */}
                      <div className="flex-1 rounded-xl border border-border/50 bg-card p-3 shadow-sm transition-colors group-hover:bg-accent/30 group-active:bg-accent/50">
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-1">
                            <p
                              className={`text-sm font-semibold leading-tight ${
                                item.isUnread ? "text-foreground" : "text-foreground/90"
                              }`}
                            >
                              {item.title}
                            </p>
                            <p className="text-xs font-medium text-muted-foreground">
                              {item.subtitle}
                            </p>
                          </div>
                          {item.isUnread && (
                            <div className="h-2 w-2 flex-shrink-0 rounded-full bg-primary mt-1" />
                          )}
                        </div>
                        <div className="mt-2 text-[11px] font-medium text-muted-foreground/60">
                          {item.time}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppChrome>
  );
}
