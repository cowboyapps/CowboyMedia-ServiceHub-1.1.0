import React from "react";
import { AppChrome } from "./_shared/AppChrome";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Server,
  Gamepad2,
  HardDrive,
  Bot,
  CreditCard,
  Ticket,
  LifeBuoy,
  PlusCircle,
  AlertTriangle,
  ChevronRight,
  Clock,
  ArrowRight,
  Newspaper
} from "lucide-react";
import "./_group.css";
import "./PersonalHub.css";

const myServices = [
  { id: "s3", name: "VPS Hosting", plan: "4vCPU / 8GB RAM", status: "degraded", renews: "Jul 22", icon: HardDrive, price: "$24.00" },
  { id: "s1", name: "Web Hosting", plan: "Pro Plan", status: "operational", renews: "Aug 1", icon: Server, price: "$12.50" },
  { id: "s2", name: "Game Servers", plan: "64-Slot CS2", status: "operational", renews: "Aug 15", icon: Gamepad2, price: "$18.00" },
  { id: "s4", name: "Discord Bot", plan: "Node.js App", status: "operational", renews: "Aug 5", icon: Bot, price: "$4.00" },
];

const alerts = [
  { id: "a1", title: "VPS node maintenance window", services: ["VPS Hosting"], severity: "warning" },
  { id: "a2", title: "Intermittent latency on EU game servers", services: ["Game Servers"], severity: "info" },
];

const news = [
  { id: "n1", title: "New customer dashboard is coming", date: "Jul 11" },
  { id: "n2", title: "Game server fleet upgraded to NVMe", date: "Jul 8" },
];

function StatusDot({ status }: { status: string }) {
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

export function PersonalHub() {
  return (
    <AppChrome>
      <div className="relative -m-3 p-3">
        {/* Ambient Top Gradient */}
        <div className="personal-hub-gradient absolute top-0 left-0 right-0 h-64 pointer-events-none" />

        <div className="relative z-10 space-y-8 pb-6">
          
          {/* Greeting Section */}
          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-3">
              <Avatar className="h-12 w-12 border-2 border-primary/20">
                <AvatarFallback className="bg-primary/10 text-primary font-bold">JC</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Good morning, Jake.</h1>
                <p className="text-sm text-muted-foreground">Account active since 2024</p>
              </div>
            </div>
          </div>

          {/* Quick Actions */}
          <div className="grid grid-cols-3 gap-3">
            <button className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card border border-card-border p-3 hover-elevate tap-interactive transition-colors hover:border-primary/50 text-foreground">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                <PlusCircle className="h-5 w-5" />
              </div>
              <span className="text-xs font-medium">New Ticket</span>
            </button>
            <button className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card border border-card-border p-3 hover-elevate tap-interactive transition-colors hover:border-primary/50 text-foreground">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-chart-1/10 text-chart-1">
                <CreditCard className="h-5 w-5" />
              </div>
              <span className="text-xs font-medium">Pay Invoice</span>
            </button>
            <button className="flex flex-col items-center justify-center gap-2 rounded-xl bg-card border border-card-border p-3 hover-elevate tap-interactive transition-colors hover:border-primary/50 text-foreground">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-chart-2/10 text-chart-2">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <span className="text-xs font-medium">Get Help</span>
            </button>
          </div>

          {/* Action Items (Tickets & Billing) */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground ml-1">Needs Attention</h2>
            
            {/* Open Ticket */}
            <Card className="ticket-card border hover-elevate tap-interactive cursor-pointer transition-shadow">
              <CardContent className="p-4 flex flex-col gap-3">
                <div className="flex justify-between items-start">
                  <div className="flex items-center gap-2 text-sm font-medium text-chart-5">
                    <Ticket className="h-4 w-4" />
                    <span>Ticket #4829</span>
                  </div>
                  <Badge variant="secondary" className="bg-chart-5/10 text-chart-5 hover:bg-chart-5/20 border-none">Open</Badge>
                </div>
                <div>
                  <h3 className="font-semibold text-sm">Need help upgrading VPS storage</h3>
                  <p className="text-xs text-muted-foreground mt-1 line-clamp-1">"I'd like to add another 50GB of NVMe storage to my VPS..."</p>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 p-2 rounded-md">
                  <Clock className="h-3.5 w-3.5 text-chart-5" />
                  <span>Last reply 2h ago. Expect a response in ~4h.</span>
                </div>
              </CardContent>
            </Card>

            {/* Next Invoice */}
            <Card className="border border-primary/20 hover-elevate tap-interactive cursor-pointer transition-shadow relative overflow-hidden bg-primary/5">
              <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none">
                <CreditCard className="w-24 h-24 text-primary transform rotate-12" />
              </div>
              <CardContent className="p-4 flex items-center justify-between relative z-10">
                <div>
                  <div className="text-xs font-medium text-primary mb-1">Upcoming Invoice</div>
                  <div className="text-2xl font-bold">$42.50</div>
                  <div className="text-xs text-muted-foreground mt-1">Due Jul 22 • VPS & Web Hosting</div>
                </div>
                <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
                  Pay Now
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Your Services */}
          <div className="space-y-3">
            <div className="flex items-center justify-between ml-1">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Your Services</h2>
              <Button variant="link" size="sm" className="h-auto p-0 text-muted-foreground hover:text-foreground">
                Manage All <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
            
            <div className="grid grid-cols-1 gap-3">
              {myServices.map((service) => {
                const Icon = service.icon;
                const isDegraded = service.status !== "operational";
                return (
                  <Card key={service.id} className={`border hover-elevate tap-interactive cursor-pointer transition-shadow ${isDegraded ? 'service-card-degraded' : ''}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-3">
                          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${isDegraded ? 'bg-status-away/10 text-status-away' : 'bg-secondary text-secondary-foreground'}`}>
                            <Icon className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="font-semibold text-sm flex items-center gap-2">
                              {service.name}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{service.plan}</p>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="flex items-center gap-1.5 bg-background border border-border px-2 py-0.5 rounded-full">
                            <StatusDot status={service.status} />
                            <span className="text-[10px] font-medium capitalize tracking-wide">{service.status}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground mr-1">Renews {service.renews}</span>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>

          {/* Company Wide: Alerts & News */}
          <div className="space-y-4 pt-4 border-t border-border/50">
            {alerts.length > 0 && (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                  <AlertTriangle className="h-4 w-4 text-status-away" />
                  System Alerts ({alerts.length})
                </h2>
                <div className="flex overflow-x-auto pb-2 -mx-3 px-3 gap-3 snap-x">
                  {alerts.map(alert => (
                    <div key={alert.id} className="snap-start shrink-0 w-[280px] bg-card border border-border rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium leading-tight">{alert.title}</p>
                        <Badge variant="outline" className={alert.severity === 'warning' ? 'text-status-away border-status-away/20' : 'text-primary border-primary/20'}>
                          {alert.severity}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-2">Affects: {alert.services.join(", ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-foreground">
                <Newspaper className="h-4 w-4 text-muted-foreground" />
                Latest Updates
              </h2>
              <div className="space-y-2">
                {news.map(item => (
                  <div key={item.id} className="flex items-center justify-between p-3 bg-card border border-border rounded-lg tap-interactive hover-elevate cursor-pointer">
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.date}</p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>
      </div>
    </AppChrome>
  );
}
