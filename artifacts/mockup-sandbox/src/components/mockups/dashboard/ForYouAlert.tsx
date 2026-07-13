import React from "react";
import "./_group.css";
import { AppChrome } from "./_shared/AppChrome";
import { AlertTriangle, Ticket as TicketIcon, Bell, ChevronRight, Newspaper, ArrowRight, Clock } from "lucide-react";

const services = [
  { name: "Web Hosting", uptime: "99.98%", status: "good" },
  { name: "Email", uptime: "99.62%", status: "degraded" },
  { name: "API Gateway", uptime: "99.95%", status: "good" },
  { name: "DNS", uptime: "100%", status: "good" },
  { name: "Cloud Backup", uptime: "99.99%", status: "good" },
  { name: "VPN", uptime: "99.97%", status: "good" },
];

export function ForYouAlert() {
  return (
    <AppChrome>
      <div className="flex flex-col gap-6 pb-12 bg-background min-h-full font-sans">

        {/* Hero Banner — problem state */}
        <div className="bg-amber-500/10 border-b border-amber-500/25 px-6 py-8 flex flex-col items-center justify-center text-center">
          <div className="h-14 w-14 rounded-full bg-amber-500/20 flex items-center justify-center mb-4">
            <AlertTriangle className="text-amber-600 h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2 tracking-tight">Email is having trouble</h1>
          <p className="text-sm text-muted-foreground max-w-[260px] mb-4">
            Some email deliveries are delayed. We're on it — everything else is running normally.
          </p>
          <button className="inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm active:scale-[0.98] transition-transform">
            See what's happening
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {/* Compact Services List */}
        <div className="px-4">
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden divide-y divide-border">
            {services.map((s, i) => (
              <div
                key={i}
                className={`p-3 flex items-center justify-between transition-colors cursor-pointer ${
                  s.status === "degraded" ? "bg-amber-500/10" : "hover:bg-muted/30"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full shrink-0 ${s.status === "degraded" ? "bg-amber-500" : "bg-green-500"}`}></div>
                  <span className="font-medium text-foreground text-sm">{s.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  {s.status === "degraded" ? (
                    <span className="text-amber-600 text-xs font-semibold uppercase tracking-wider inline-flex items-center gap-1">
                      Having trouble
                      <ChevronRight className="h-3.5 w-3.5" />
                    </span>
                  ) : (
                    <>
                      <span className="text-green-600 text-xs font-semibold uppercase tracking-wider">Good</span>
                      <span className="text-muted-foreground text-xs font-medium w-12 text-right">{s.uptime}</span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 px-1">
            Tap any service for its full history, including past resolved alerts.
          </p>
        </div>

        {/* The "For You" Zone */}
        <div className="px-4 flex flex-col gap-8 mt-2">

          {/* Active alert card */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                Current issue
              </h2>
            </div>
            <div className="bg-card border border-amber-500/40 p-4 rounded-xl shadow-sm relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer">
              <div className="absolute top-0 left-0 w-1 h-full bg-amber-500"></div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-500/15 px-2 py-1 rounded-md">
                  Investigating
                </span>
                <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> Started 25 min ago
                </span>
              </div>
              <h3 className="font-semibold text-foreground text-sm mb-1 pr-4">Email delivery delays</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Some messages are taking longer than usual to arrive. No email will be lost.
              </p>
              <div className="border-t border-border pt-3 flex flex-col gap-2">
                <div className="flex gap-2 items-start">
                  <div className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"></div>
                  <p className="text-xs text-foreground leading-snug">
                    <span className="font-semibold">10:32 AM</span> — We've found the cause and are applying a fix.
                  </p>
                </div>
                <div className="flex gap-2 items-start">
                  <div className="mt-1 h-1.5 w-1.5 rounded-full bg-border shrink-0"></div>
                  <p className="text-xs text-muted-foreground leading-snug">
                    <span className="font-semibold">10:07 AM</span> — We're investigating delayed email deliveries.
                  </p>
                </div>
              </div>
              <p className="text-xs font-semibold text-amber-700 mt-3 inline-flex items-center gap-1">
                Follow live updates <ChevronRight className="h-3.5 w-3.5" />
              </p>
            </div>
          </section>

          {/* Your support tickets (empty state) */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <TicketIcon className="h-5 w-5 text-[#f97316]" />
                Your support tickets
              </h2>
            </div>
            <div className="bg-card border border-border p-5 rounded-xl shadow-sm flex flex-col items-center text-center">
              <p className="font-semibold text-foreground text-sm mb-1">No open support tickets</p>
              <p className="text-xs text-muted-foreground mb-4 max-w-[240px]">
                Need a hand with something? We're happy to help.
              </p>
              <button className="inline-flex items-center gap-2 rounded-lg bg-[#f97316] px-4 py-2 text-sm font-semibold text-white shadow-sm active:scale-[0.98] transition-transform">
                Open a ticket
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </section>

          {/* Service updates — one unread, one read */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <Bell className="h-5 w-5 text-[#f97316]" />
                Service updates
                <span className="text-[10px] font-bold text-white bg-[#f97316] rounded-full px-1.5 py-0.5 leading-none">1 new</span>
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex gap-3 items-start active:scale-[0.98] transition-transform cursor-pointer">
                <div className="mt-1 h-2 w-2 rounded-full bg-[#f97316] shrink-0"></div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm mb-1 leading-snug">Maintenance completed on Email service</h3>
                  <p className="text-xs text-muted-foreground line-clamp-1">All scheduled upgrades have been applied successfully.</p>
                </div>
              </div>
              <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex gap-3 items-start active:scale-[0.98] transition-transform cursor-pointer opacity-70">
                <div className="mt-1 h-2 w-2 rounded-full bg-transparent border border-border shrink-0"></div>
                <div>
                  <h3 className="font-medium text-foreground text-sm mb-1 leading-snug">New spam filtering enabled</h3>
                  <p className="text-xs text-muted-foreground line-clamp-1">Already read — shown without the new dot.</p>
                </div>
              </div>
            </div>
          </section>

          {/* Latest news */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <Newspaper className="h-5 w-5 text-[#f97316]" />
                Latest stories
              </h2>
            </div>
            <div className="flex flex-col gap-0 bg-card border border-border rounded-xl shadow-sm overflow-hidden divide-y divide-border">
              <div className="p-4 flex items-center justify-between group active:bg-muted/30 cursor-pointer">
                <div>
                  <h3 className="font-medium text-foreground text-sm mb-1">ServiceHub v2.0 is rolling out</h3>
                  <p className="text-xs text-muted-foreground">Oct 12</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
              <div className="p-4 flex items-center justify-between group active:bg-muted/30 cursor-pointer">
                <div>
                  <h3 className="font-medium text-foreground text-sm mb-1">Tips for better password security</h3>
                  <p className="text-xs text-muted-foreground">Oct 8</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </div>
            </div>
          </section>

        </div>
      </div>
    </AppChrome>
  );
}
