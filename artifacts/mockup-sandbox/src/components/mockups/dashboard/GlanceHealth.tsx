import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bell,
  ChevronRight,
  Clock,
  MessageSquare,
  Newspaper,
  TerminalSquare,
  Ticket,
} from "lucide-react";
import { AppChrome } from "./_shared/AppChrome";
import "./_group.css";
import "./GlanceHealth.css";

const services = [
  { id: "s3", name: "VPS Hosting", status: "degraded", uptime: [100, 100, 100, 100, 100, 100, 100, 100, 100, 60, 60, 60, 60, 60] },
  { id: "s1", name: "Web Hosting", status: "operational", uptime: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: "s2", name: "Game Servers", status: "operational", uptime: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
  { id: "s4", name: "Discord Bot", status: "operational", uptime: [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100] },
];

const attentionItems = [
  {
    id: "a1",
    type: "alert",
    title: "VPS node maintenance window",
    meta: "VPS Hosting",
    time: "Jul 13, 9:00 AM",
    icon: AlertTriangle,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
  },
  {
    id: "t1",
    type: "ticket",
    title: "High CPU usage on Node 04",
    meta: "Open Ticket #49281",
    time: "2 hours ago",
    icon: Ticket,
    color: "text-primary",
    bg: "bg-primary/10",
  },
  {
    id: "a2",
    type: "alert",
    title: "Intermittent latency on EU game servers",
    meta: "Game Servers",
    time: "Jul 12, 6:42 PM",
    icon: Activity,
    color: "text-muted-foreground",
    bg: "bg-muted",
  },
];

const links = [
  {
    id: "l1",
    title: "New customer dashboard is coming",
    icon: Newspaper,
    meta: "Jul 11, 2026",
  },
  {
    id: "l2",
    title: "Game server fleet upgraded to NVMe",
    icon: Bell,
    meta: "Jul 8, 2026",
  },
  {
    id: "l3",
    title: "Introducing per-service email follows",
    icon: Bell,
    meta: "Jul 2, 2026",
  },
];

function UptimeSparkline({ data }: { data: number[] }) {
  return (
    <div className="uptime-bar">
      {data.map((val, i) => (
        <div
          key={i}
          className={`uptime-segment ${val < 100 ? (val < 50 ? "outage" : "degraded") : ""}`}
          style={{ height: `${Math.max(20, val)}%` }}
        />
      ))}
    </div>
  );
}

export function GlanceHealth() {
  return (
    <AppChrome>
      <div className="space-y-6 pt-2 pb-6">
        
        {/* Cockpit Hero */}
        <div className="px-4 stagger-item">
          <div className="flex flex-col items-center justify-center rounded-2xl bg-card border border-amber-500/20 px-6 py-8 text-center shadow-lg shadow-amber-500/5 relative overflow-hidden">
            {/* Subtle background glow */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[200%] h-[100px] bg-amber-500/10 blur-[50px] pointer-events-none" />
            
            <div className="glance-hero-indicator mb-5">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-500 text-amber-950 shadow-[0_0_20px_rgba(245,158,11,0.4)] z-10">
                <AlertTriangle className="h-6 w-6" strokeWidth={2.5} />
              </div>
            </div>
            
            <h1 className="text-2xl font-bold tracking-tight text-amber-500 mb-1">1 Issue Detected</h1>
            <p className="text-sm text-muted-foreground max-w-[240px]">
              VPS Hosting is experiencing degraded performance. Other services are operational.
            </p>
          </div>
        </div>

        {/* Per-Service Strip */}
        <div className="stagger-item">
          <div className="px-4 mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Service Health</h2>
          </div>
          <div className="flex overflow-x-auto hide-scrollbar px-4 gap-3 pb-2 snap-x">
            {services.map((service) => (
              <div 
                key={service.id} 
                className="flex-shrink-0 w-[140px] snap-start rounded-xl border border-border bg-card p-3 tap-interactive cursor-pointer hover-elevate"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        service.status === "operational" ? "bg-status-online" : "bg-status-away animate-status-pulse"
                      }`}
                    />
                    <span className="text-sm font-medium leading-none truncate max-w-[90px]">{service.name}</span>
                  </div>
                </div>
                <UptimeSparkline data={service.uptime} />
              </div>
            ))}
          </div>
        </div>

        {/* Needs Attention Zone */}
        <div className="px-4 stagger-item">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Needs Attention</h2>
          <div className="space-y-2">
            {attentionItems.map((item) => {
              const Icon = item.icon;
              return (
                <div 
                  key={item.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-card p-3 tap-interactive cursor-pointer hover-elevate"
                >
                  <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
                    <Icon className={`h-4 w-4 ${item.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium leading-tight text-foreground mb-1">{item.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{item.meta}</span>
                      <span className="h-1 w-1 rounded-full bg-border" />
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {item.time}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50 self-center" />
                </div>
              )
            })}
          </div>
        </div>

        {/* Demoted Links */}
        <div className="px-4 stagger-item pb-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Updates & News</h2>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            {links.map((link, i) => {
              const Icon = link.icon;
              return (
                <div 
                  key={link.id}
                  className={`flex items-center gap-3 p-3 tap-interactive cursor-pointer hover:bg-muted/50 transition-colors ${
                    i !== links.length - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 flex-1 truncate text-sm text-foreground">{link.title}</p>
                  <span className="shrink-0 text-xs text-muted-foreground">{link.meta}</span>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </AppChrome>
  );
}
