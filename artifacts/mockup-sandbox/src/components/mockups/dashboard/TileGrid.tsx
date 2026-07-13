import React from "react";
import "./_group.css";
import "./TileGrid.css";
import { AppChrome } from "./_shared/AppChrome";
import { CheckCircle2, ChevronRight, Clock, FileText, Bell, Ticket, Newspaper } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const SERVICES = [
  { name: "Web Hosting", uptime: "99.99%" },
  { name: "Email", uptime: "100%" },
  { name: "API Gateway", uptime: "99.98%" },
  { name: "DNS", uptime: "100%" },
  { name: "Cloud Backup", uptime: "99.95%" },
  { name: "VPN", uptime: "99.99%" },
];

const TICKETS = [
  { title: "Email not syncing on iPhone", status: "Awaiting reply", time: "2 hours ago" },
  { title: "Website loading slowly", status: "In progress", time: "Yesterday" },
];

const UPDATES = [
  { title: "Maintenance completed on Email service", date: "Today, 4:00 AM" },
  { title: "New spam filtering enabled", date: "Yesterday" },
];

const NEWS = [
  { title: "ServiceHub 2.0 is here!", date: "Oct 12" },
  { title: "Tips for faster cloud backups", date: "Oct 05" },
];

export function TileGrid() {
  return (
    <AppChrome>
      <div className="flex flex-col gap-6 p-4 pb-12 bg-background min-h-full">
        {/* Status Hero */}
        <section className="bg-emerald-50 dark:bg-emerald-950/30 rounded-2xl p-5 flex flex-col items-center justify-center text-center border border-emerald-100 dark:border-emerald-900 shadow-sm relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-emerald-500" />
          <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900 rounded-full flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-semibold text-emerald-900 dark:text-emerald-300 mb-1">
            All systems running smoothly
          </h2>
          <p className="text-sm text-emerald-700 dark:text-emerald-500/80">
            You're all caught up. No issues detected.
          </p>
        </section>

        {/* Services Grid */}
        <section>
          <div className="flex items-center justify-between mb-3 px-1">
            <h3 className="font-semibold text-foreground text-lg">Service Health</h3>
            <span className="text-xs font-medium text-muted-foreground">Last updated just now</span>
          </div>
          <div className="tile-grid-container">
            {SERVICES.map((s, i) => (
              <div key={i} className="bg-card border rounded-xl p-3 flex flex-col gap-2 tile-grid-card">
                <div className="flex items-start justify-between">
                  <span className="font-medium text-sm text-foreground leading-tight">{s.name}</span>
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 mt-1 shadow-[0_0_8px_rgba(16,185,129,0.4)]" />
                </div>
                <div className="mt-auto flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Uptime</span>
                  <span className="font-semibold text-foreground">{s.uptime}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Open Tickets */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <Ticket className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-lg">Your open tickets</h3>
          </div>
          <div className="flex flex-col gap-3">
            {TICKETS.map((t, i) => (
              <Card key={i} className="tile-grid-card border-none shadow-sm ring-1 ring-border/50">
                <CardContent className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-sm text-foreground truncate">{t.title}</h4>
                    <div className="flex items-center gap-2 mt-1.5 text-xs">
                      <Badge variant="secondary" className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300 hover:bg-orange-100 font-medium px-1.5 py-0">
                        {t.status}
                      </Badge>
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {t.time}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        {/* Service Updates */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <Bell className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-lg flex items-center gap-2">
              Service updates
              <Badge className="bg-primary hover:bg-primary text-primary-foreground text-[10px] px-1.5 py-0 h-5">
                2 new
              </Badge>
            </h3>
          </div>
          <Card className="tile-grid-card border-none shadow-sm ring-1 ring-border/50 overflow-hidden">
            <div className="flex flex-col divide-y divide-border/50">
              {UPDATES.map((u, i) => (
                <div key={i} className="p-4 flex gap-3 bg-primary/5 hover:bg-primary/10 transition-colors">
                  <div className="mt-0.5 w-2 h-2 rounded-full bg-primary flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground leading-snug">{u.title}</p>
                    <span className="text-xs text-muted-foreground mt-1 block">{u.date}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-muted/30 p-3 text-center border-t border-border/50">
              <button className="text-sm font-medium text-primary hover:underline">View all updates</button>
            </div>
          </Card>
        </section>

        {/* News */}
        <section>
          <div className="flex items-center gap-2 mb-3 px-1">
            <Newspaper className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground text-lg">New for you</h3>
          </div>
          <div className="flex flex-col gap-3">
            {NEWS.map((n, i) => (
              <div key={i} className="flex items-center gap-3 p-3 rounded-xl bg-card border hover:border-primary/30 transition-colors cursor-pointer tile-grid-card">
                <div className="w-12 h-12 rounded-lg bg-orange-50 dark:bg-orange-950/30 flex items-center justify-center flex-shrink-0 text-orange-600 dark:text-orange-400">
                  <FileText className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium text-sm text-foreground">{n.title}</h4>
                  <span className="text-xs text-muted-foreground">{n.date}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

      </div>
    </AppChrome>
  );
}