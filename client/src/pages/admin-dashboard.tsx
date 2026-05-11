import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  LifeBuoy,
  Server,
  AlertTriangle,
  Bell,
  Mail,
  BookOpen,
  MessageSquare,
  Users,
  Clock,
  TrendingUp,
} from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { formatDistanceToNow } from "date-fns";

type DashboardMetrics = {
  generatedAt: string;
  cached?: boolean;
  tickets: {
    open: number; awaitingCustomer: number; awaitingAdmin: number;
    openedToday: number; resolvedToday: number;
    avgFirstResponseMinutes7d: number | null;
    series14d: { date: string; opened: number; resolved: number }[];
  };
  services: {
    total: number; operational: number; degraded: number; down: number;
    activeAlerts: number;
    recentAlerts: { id: string; title: string; severity: string; status: string; createdAt: string }[];
  };
  notifications: {
    pushSent24h: number; emailSent24h: number;
    pushSubscriptionsTotal: number; pushSubscriptionsThisWeek: number;
  };
  knowledgeBase: {
    total: number; published: number;
    topViewed: { id: string; title: string; slug: string; viewCount: number }[];
  };
  community: { messages24h: number; activeUsers7d: number; bannedUsers: number };
  users: { total: number; customers: number; admins: number; signupsToday: number; signupsThisWeek: number };
};

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

function severityColor(s: string) {
  switch (s) {
    case "critical": return "bg-red-500/10 text-red-600 dark:text-red-400";
    case "warning": return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
    default: return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
  }
}

export default function AdminDashboard({ onNavigateSection }: { onNavigateSection?: (key: string) => void }) {
  const [, navigate] = useLocation();
  const { data, isLoading, error, dataUpdatedAt } = useQuery<DashboardMetrics>({
    queryKey: ["/api/admin/dashboard"],
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-sm text-muted-foreground" data-testid="text-dashboard-error">
        Couldn't load the overview right now. Try again in a moment.
      </div>
    );
  }

  const go = (key: string) => onNavigateSection ? onNavigateSection(key) : null;

  const fmtMinutes = (m: number | null) => {
    if (m === null) return "—";
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}h ${rem}m` : `${h}h`;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {/* Tickets */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2 xl:col-span-2"
          onClick={() => navigate("/tickets")}
          data-testid="card-dashboard-tickets"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <LifeBuoy className="w-4 h-4 text-sky-500" /> Support tickets
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Open" value={data.tickets.open} />
              <Stat label="Awaiting admin" value={data.tickets.awaitingAdmin} />
              <Stat label="Awaiting customer" value={data.tickets.awaitingCustomer} />
              <Stat label="Opened today" value={data.tickets.openedToday} />
              <Stat label="Resolved today" value={data.tickets.resolvedToday} />
              <Stat label="Avg 1st reply (7d)" value={fmtMinutes(data.tickets.avgFirstResponseMinutes7d)} />
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.tickets.series14d} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)} />
                  <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="opened" fill="hsl(217 91% 60%)" name="Opened" />
                  <Bar dataKey="resolved" fill="hsl(142 71% 45%)" name="Resolved" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Services & alerts */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2"
          onClick={() => go("services")}
          data-testid="card-dashboard-services"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Server className="w-4 h-4 text-green-500" /> Services & alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total services" value={data.services.total} sub={`${data.services.operational} operational`} />
              <Stat label="Active alerts" value={data.services.activeAlerts} sub={`${data.services.degraded} degraded · ${data.services.down} down`} />
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Recent alerts
              </p>
              {data.services.recentAlerts.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No alerts on record</p>
              ) : data.services.recentAlerts.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs gap-2" data-testid={`row-recent-alert-${a.id}`}>
                  <span className="truncate flex-1">{a.title}</span>
                  <Badge variant="secondary" className={`text-[10px] ${severityColor(a.severity)}`}>{a.severity}</Badge>
                  <span className="text-muted-foreground whitespace-nowrap">{formatDistanceToNow(new Date(a.createdAt), { addSuffix: true })}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Notifications */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2"
          onClick={() => go("logs")}
          data-testid="card-dashboard-notifications"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Bell className="w-4 h-4 text-orange-500" /> Notifications (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Push sent" value={data.notifications.pushSent24h} />
              <Stat label="Email sent" value={data.notifications.emailSent24h} sub={<span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" /> last 24h</span>} />
              <Stat label="Push subs" value={data.notifications.pushSubscriptionsTotal} sub={`+${data.notifications.pushSubscriptionsThisWeek} this week`} />
            </div>
          </CardContent>
        </Card>

        {/* Knowledge base */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2"
          onClick={() => go("knowledge-base")}
          data-testid="card-dashboard-kb"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <BookOpen className="w-4 h-4 text-indigo-500" /> Knowledge base
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Articles" value={data.knowledgeBase.total} sub={`${data.knowledgeBase.published} published`} />
              <Stat label="Top views" value={data.knowledgeBase.topViewed[0]?.viewCount ?? 0} sub={data.knowledgeBase.topViewed[0]?.title ?? "—"} />
            </div>
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Most viewed</p>
              {data.knowledgeBase.topViewed.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">No articles yet</p>
              ) : data.knowledgeBase.topViewed.map(a => (
                <div key={a.id} className="flex items-center justify-between text-xs gap-2" data-testid={`row-kb-top-${a.id}`}>
                  <span className="truncate flex-1">{a.title}</span>
                  <span className="text-muted-foreground tabular-nums">{a.viewCount}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Community */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2"
          onClick={() => go("chat-admin")}
          data-testid="card-dashboard-community"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="w-4 h-4 text-pink-500" /> Community
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Messages 24h" value={data.community.messages24h} />
              <Stat label="Active 7d" value={data.community.activeUsers7d} />
              <Stat label="Banned" value={data.community.bannedUsers} />
            </div>
          </CardContent>
        </Card>

        {/* Users */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2"
          onClick={() => go("users")}
          data-testid="card-dashboard-users"
        >
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4 text-blue-500" /> Users
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Total" value={data.users.total} sub={`${data.users.customers} customers · ${data.users.admins} admins`} />
              <Stat label="Online now" value="—" sub="Coming soon" />
              <Stat label="Signups today" value={data.users.signupsToday} sub={<span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {data.users.signupsThisWeek} this week</span>} />
            </div>
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-dashboard-updated">
        <Clock className="w-3 h-3" /> Last updated {formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })}
        {data.cached && <span className="ml-1">· cached</span>}
      </p>
    </div>
  );
}
