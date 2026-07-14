import React from "react";
import { AppChrome } from "./_shared/AppChrome";
import { CheckCircle2, ChevronRight, Server, Mail, Network, Globe, Cloud, Shield, Newspaper, MessageSquare, Clock, ArrowUpCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import "./_group.css";

export function Scorecard() {
  const services = [
    { name: "Web Hosting", icon: Globe, uptime: "99.99%", status: "operational" },
    { name: "Email", icon: Mail, uptime: "99.95%", status: "operational" },
    { name: "API Gateway", icon: Network, uptime: "99.98%", status: "operational" },
    { name: "DNS", icon: Server, uptime: "100%", status: "operational" },
    { name: "Cloud Backup", icon: Cloud, uptime: "99.90%", status: "operational" },
    { name: "VPN", icon: Shield, uptime: "99.97%", status: "operational" },
  ];

  const tickets = [
    { title: "Email not syncing on iPhone", status: "Awaiting reply", time: "2h ago" },
    { title: "Website loading slowly", status: "In progress", time: "1d ago" },
  ];

  const updates = [
    { title: "Maintenance completed on Email service", time: "Today, 4:00 AM" },
    { title: "New spam filtering enabled", time: "Yesterday" },
  ];

  const news = [
    { title: "Quarterly feature roundup: What's new in Q2", date: "Jun 15" },
    { title: "Best practices for securing your API keys", date: "Jun 10" },
    { title: "CowboyMedia recognized in top 10 hosting providers", date: "Jun 1" },
  ];

  // Helper to render a 14-day sparkline
  const renderSparkline = () => {
    return (
      <div className="flex items-center gap-0.5 mt-1.5">
        {Array.from({ length: 14 }).map((_, i) => (
          <div key={i} className="flex-1 h-3 rounded-sm bg-green-500/80"></div>
        ))}
      </div>
    );
  };

  return (
    <AppChrome>
      <div className="flex flex-col pb-8 bg-background min-h-full">
        {/* Status Hero */}
        <div className="px-5 pt-8 pb-6 bg-[#FAFAF9] border-b border-border">
          <div className="flex items-start gap-4">
            <CheckCircle2 className="w-8 h-8 text-green-600 shrink-0" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">You're all caught up.</h1>
              <p className="text-muted-foreground mt-1 text-sm">All systems running smoothly right now.</p>
            </div>
          </div>
        </div>

        {/* Services Scorecard */}
        <div className="px-5 py-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">Service Health</h2>
            <span className="text-xs font-medium text-muted-foreground">Past 14 days</span>
          </div>
          
          <div className="border-t border-border">
            {services.map((service, i) => (
              <div key={i} className="py-3.5 border-b border-border/60 group cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-orange-100/50 flex items-center justify-center">
                      <service.icon className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">{service.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500"></span>
                        Operational
                      </div>
                    </div>
                  </div>
                  <div className="text-right w-24">
                    <div className="text-sm font-semibold text-foreground">{service.uptime}</div>
                    {renderSparkline()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full h-2 bg-[#FAFAF9] border-y border-border/50"></div>

        {/* Tickets */}
        <div className="px-5 py-6">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">Your Open Tickets</h2>
            <Badge variant="secondary" className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-0 h-5 px-1.5 rounded text-[10px]">2</Badge>
          </div>
          
          <div className="border border-border/80 rounded-xl overflow-hidden bg-card">
            {tickets.map((ticket, i) => (
              <div key={i} className={`p-4 ${i !== tickets.length - 1 ? 'border-b border-border/60' : ''} active:bg-accent/50 cursor-pointer transition-colors`}>
                <div className="flex justify-between items-start gap-4">
                  <div>
                    <h3 className="text-sm font-medium text-foreground line-clamp-1">{ticket.title}</h3>
                    <div className="flex items-center gap-2 mt-2">
                      <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${ticket.status === 'Awaiting reply' ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-700'}`}>
                        {ticket.status}
                      </span>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {ticket.time}
                      </span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Updates */}
        <div className="px-5 py-2">
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase">Service Updates</h2>
            <Badge variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/10 border-0 h-5 px-1.5 rounded text-[10px]">2 new</Badge>
          </div>
          
          <div className="space-y-4">
            {updates.map((update, i) => (
              <div key={i} className="flex gap-3 items-start group cursor-pointer">
                <div className="mt-0.5 p-1.5 rounded-full bg-primary/10 shrink-0">
                  <ArrowUpCircle className="w-3.5 h-3.5 text-primary" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground leading-snug group-hover:text-primary transition-colors">{update.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{update.time}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="w-full h-2 bg-[#FAFAF9] border-y border-border/50 mt-6"></div>

        {/* News */}
        <div className="px-5 py-6">
          <h2 className="text-sm font-semibold tracking-wide text-foreground uppercase mb-4">New for you</h2>
          
          <div className="space-y-5">
            {news.map((item, i) => (
              <div key={i} className="flex gap-4 items-start group cursor-pointer">
                <div className="w-16 h-12 bg-orange-50 rounded-md shrink-0 border border-orange-100 flex items-center justify-center">
                  <Newspaper className="w-5 h-5 text-primary/60" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-foreground leading-tight group-hover:text-primary transition-colors">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">{item.date}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppChrome>
  );
}
