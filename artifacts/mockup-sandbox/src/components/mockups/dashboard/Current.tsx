import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity,
  AlertTriangle,
  Bell,
  Clock,
  Newspaper,
  Ticket,
} from "lucide-react";
import { AppChrome } from "./_shared/AppChrome";
import "./_group.css";

/* Faithful extraction of client/src/pages/dashboard.tsx (mobile viewport),
   with static demo data in place of the live queries. */

const services = [
  { id: "s1", name: "Web Hosting", status: "operational" },
  { id: "s2", name: "Game Servers", status: "operational" },
  { id: "s3", name: "VPS Hosting", status: "degraded" },
  { id: "s4", name: "Discord Bot", status: "operational" },
];

const alerts = [
  {
    id: "a1",
    title: "VPS node maintenance window",
    services: ["VPS Hosting"],
    time: "Jul 13, 9:00 AM",
    severity: "warning",
  },
  {
    id: "a2",
    title: "Intermittent latency on EU game servers",
    services: ["Game Servers"],
    time: "Jul 12, 6:42 PM",
    severity: "info",
  },
];

const news = [
  {
    id: "n1",
    title: "New customer dashboard is coming",
    excerpt: "A refreshed home screen with live status at a glance...",
    date: "Jul 11, 2026",
  },
  {
    id: "n2",
    title: "Game server fleet upgraded to NVMe",
    excerpt: "All game server nodes now run on NVMe storage for faster...",
    date: "Jul 8, 2026",
  },
  {
    id: "n3",
    title: "Introducing per-service email follows",
    excerpt: "Follow any service from the public status page and get...",
    date: "Jul 2, 2026",
  },
];

function StatusIndicator({ status }: { status: string }) {
  const colors: Record<string, string> = {
    operational: "bg-status-online",
    degraded: "bg-status-away",
    outage: "bg-status-busy",
    maintenance: "bg-status-offline",
  };
  const isActive = status !== "operational";
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${colors[status] || "bg-status-offline"} ${isActive ? "animate-status-pulse" : ""}`}
    />
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    critical: "destructive",
    warning: "default",
    info: "secondary",
  };
  return (
    <Badge variant={variants[severity] || "secondary"} className="text-xs">
      {severity}
    </Badge>
  );
}

const stats = [
  { label: "Services", value: 4, icon: Activity, chip: "bg-primary/10", iconColor: "text-primary" },
  { label: "Active Alerts", value: 2, icon: AlertTriangle, chip: "bg-destructive/10", iconColor: "text-destructive" },
  { label: "Open Tickets", value: 1, icon: Ticket, chip: "bg-chart-5/10", iconColor: "text-chart-5" },
  { label: "News Stories", value: 12, icon: Newspaper, chip: "bg-chart-2/10", iconColor: "text-chart-2" },
  { label: "New Service Updates", value: 3, icon: Bell, chip: "bg-chart-4/15", iconColor: "text-chart-4" },
];

export function Current() {
  return (
    <AppChrome>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Welcome, Jake Colton</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Here's an overview of your services and recent activity
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {stats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="stagger-item block">
                <Card className="border hover-elevate tap-interactive cursor-pointer transition-shadow">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-md ${stat.chip}`}>
                      <Icon className={`h-5 w-5 ${stat.iconColor}`} />
                    </div>
                    <div>
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">{stat.label}</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            );
          })}
        </div>

        <Card className="border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Service Status</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {services.map((service) => (
              <div key={service.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="flex items-center gap-2.5">
                  <StatusIndicator status={service.status} />
                  <span className="text-sm font-medium">{service.name}</span>
                </div>
                <Badge variant="secondary" className="text-xs capitalize">
                  {service.status}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Active Alerts</CardTitle>
            <Button variant="ghost" size="sm">
              View All
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                className="hover-elevate tap-interactive -mx-2 flex cursor-pointer items-start justify-between gap-2 rounded-md px-2 py-1.5"
              >
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <div className="flex flex-wrap items-center gap-1">
                    {alert.services.map((s) => (
                      <Badge key={s} variant="secondary" className="text-[10px]">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {alert.time}
                  </p>
                </div>
                <SeverityBadge severity={alert.severity} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="border">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
            <CardTitle className="text-base">Latest News</CardTitle>
            <Button variant="ghost" size="sm">
              View All
            </Button>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {news.map((story) => (
                <div
                  key={story.id}
                  className="hover-elevate tap-interactive -mx-2 flex cursor-pointer items-start gap-3 rounded-md px-2 py-2"
                >
                  <div className="h-12 w-16 flex-shrink-0 rounded-md bg-muted" />
                  <div className="min-w-0 space-y-0.5">
                    <p className="truncate text-sm font-medium">{story.title}</p>
                    <p className="line-clamp-1 text-xs text-muted-foreground">{story.excerpt}</p>
                    <p className="text-xs text-muted-foreground">{story.date}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AppChrome>
  );
}
