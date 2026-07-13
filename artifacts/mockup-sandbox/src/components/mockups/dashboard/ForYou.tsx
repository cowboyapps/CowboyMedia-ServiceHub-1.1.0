import React from "react";
import "./_group.css";
import { AppChrome } from "./_shared/AppChrome";
import { CheckCircle2, Ticket as TicketIcon, Bell, ChevronRight, Newspaper, ArrowRight } from "lucide-react";

const services = [
  { name: "Web Hosting", uptime: "99.98%" },
  { name: "Email", uptime: "99.99%" },
  { name: "API Gateway", uptime: "99.95%" },
  { name: "DNS", uptime: "100%" },
  { name: "Cloud Backup", uptime: "99.99%" },
  { name: "VPN", uptime: "99.97%" },
];

export function ForYou() {
  return (
    <AppChrome>
      <div className="flex flex-col gap-6 pb-12 bg-background min-h-full font-sans">
        
        {/* Hero Banner */}
        <div className="bg-green-500/10 border-b border-green-500/20 px-6 py-8 flex flex-col items-center justify-center text-center">
          <div className="h-14 w-14 rounded-full bg-green-500/20 flex items-center justify-center mb-4">
            <CheckCircle2 className="text-green-600 h-7 w-7" />
          </div>
          <h1 className="text-2xl font-bold text-foreground mb-2 tracking-tight">You're all caught up!</h1>
          <p className="text-sm text-muted-foreground max-w-[250px]">All systems are running smoothly right now.</p>
        </div>

        {/* Compact Services List */}
        <div className="px-4">
          <div className="bg-card border border-border rounded-xl shadow-sm overflow-hidden divide-y divide-border">
            {services.map((s, i) => (
              <div key={i} className="p-3 flex items-center justify-between hover:bg-muted/30 transition-colors cursor-default">
                <div className="flex items-center gap-3">
                  <div className="h-2 w-2 rounded-full bg-green-500 shrink-0"></div>
                  <span className="font-medium text-foreground text-sm">{s.name}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-green-600 text-xs font-semibold uppercase tracking-wider">Good</span>
                  <span className="text-muted-foreground text-xs font-medium w-12 text-right">{s.uptime}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* The "For You" Zone */}
        <div className="px-4 flex flex-col gap-8 mt-2">
          
          {/* We're on it (Tickets) */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <TicketIcon className="h-5 w-5 text-[#f97316]" />
                We're on it
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              <div className="bg-card border border-border p-4 rounded-xl shadow-sm relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer">
                <div className="absolute top-0 left-0 w-1 h-full bg-[#f97316]"></div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-medium text-muted-foreground">#1042</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#f97316] bg-[#f97316]/10 px-2 py-1 rounded-md">
                    Awaiting Reply
                  </span>
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-1 pr-4">Email not syncing on iPhone</h3>
                <p className="text-xs text-muted-foreground">Updated today, 9:41 AM</p>
              </div>

              <div className="bg-card border border-border p-4 rounded-xl shadow-sm relative overflow-hidden active:scale-[0.98] transition-transform cursor-pointer">
                <div className="absolute top-0 left-0 w-1 h-full bg-border"></div>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-xs font-medium text-muted-foreground">#1038</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground bg-muted px-2 py-1 rounded-md">
                    In Progress
                  </span>
                </div>
                <h3 className="font-semibold text-foreground text-sm mb-1 pr-4">Website loading slowly</h3>
                <p className="text-xs text-muted-foreground">Updated yesterday, 2:15 PM</p>
              </div>
            </div>
          </section>

          {/* New for you (Updates) */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2 tracking-tight">
                <Bell className="h-5 w-5 text-[#f97316]" />
                New for you
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
              <div className="bg-card border border-border p-4 rounded-xl shadow-sm flex gap-3 items-start active:scale-[0.98] transition-transform cursor-pointer">
                <div className="mt-1 h-2 w-2 rounded-full bg-[#f97316] shrink-0"></div>
                <div>
                  <h3 className="font-semibold text-foreground text-sm mb-1 leading-snug">New spam filtering enabled</h3>
                  <p className="text-xs text-muted-foreground line-clamp-1">We've upgraded our spam protection system for all accounts.</p>
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
              <div className="p-4 flex items-center justify-between group active:bg-muted/30 cursor-pointer">
                <div>
                  <h3 className="font-medium text-foreground text-sm mb-1">Cloud Backup storage increased</h3>
                  <p className="text-xs text-muted-foreground">Oct 1</p>
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
