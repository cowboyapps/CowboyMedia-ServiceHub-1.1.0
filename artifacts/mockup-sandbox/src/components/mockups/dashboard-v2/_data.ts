export type ServiceStatus = "operational" | "degraded" | "outage" | "maintenance";

export interface MockService {
  id: string;
  name: string;
  status: ServiceStatus;
  uptime30d: string;
  subscribed: boolean;
}

export const services: MockService[] = [
  { id: "s1", name: "Cowboy Cloud Hosting", status: "operational", uptime30d: "99.98%", subscribed: true },
  { id: "s2", name: "Email Platform", status: "degraded", uptime30d: "99.61%", subscribed: true },
  { id: "s3", name: "DNS & Domains", status: "operational", uptime30d: "100%", subscribed: true },
  { id: "s4", name: "Backup Vault", status: "operational", uptime30d: "99.92%", subscribed: true },
  { id: "s5", name: "VPN Gateway", status: "maintenance", uptime30d: "99.75%", subscribed: true },
  { id: "s6", name: "Media Streaming", status: "operational", uptime30d: "99.99%", subscribed: false },
];

export interface MockAlert {
  id: string;
  title: string;
  severity: "critical" | "warning" | "info";
  serviceNames: string[];
  startedAgo: string;
  latestUpdate: string;
}

export const activeAlerts: MockAlert[] = [
  {
    id: "a1",
    title: "Delayed outbound email delivery",
    severity: "warning",
    serviceNames: ["Email Platform"],
    startedAgo: "42 min ago",
    latestUpdate: "Queue is draining; delays now under 5 minutes.",
  },
  {
    id: "a2",
    title: "Scheduled maintenance: VPN Gateway upgrade",
    severity: "info",
    serviceNames: ["VPN Gateway"],
    startedAgo: "2 hr ago",
    latestUpdate: "Maintenance window ends at 16:00 — brief reconnects expected.",
  },
];

export interface MockTicket {
  id: string;
  subject: string;
  status: "open" | "waiting" | "resolved";
  lastActivity: string;
  lastMessageFrom: "support" | "you";
}

export const tickets: MockTicket[] = [
  { id: "t1", subject: "Mailbox quota increase", status: "open", lastActivity: "12 min ago", lastMessageFrom: "support" },
  { id: "t2", subject: "SSL renewal question", status: "waiting", lastActivity: "3 hr ago", lastMessageFrom: "you" },
];

export interface MockNews {
  id: string;
  title: string;
  excerpt: string;
  date: string;
}

export const news: MockNews[] = [
  { id: "n1", title: "New backup retention options", excerpt: "Choose 30, 60, or 90-day retention on every Backup Vault plan.", date: "Jul 12" },
  { id: "n2", title: "Faster streaming across Europe", excerpt: "New edge nodes cut buffering times by up to 40%.", date: "Jul 9" },
  { id: "n3", title: "Summer maintenance calendar", excerpt: "All planned windows for July and August in one place.", date: "Jul 5" },
];

export const counts = {
  services: 5,
  activeAlerts: 2,
  openTickets: 2,
  newsStories: 3,
  newServiceUpdates: 4,
  unreadNotifications: 3,
};

export const userName = "Sarah";
