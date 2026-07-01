import { useEffect, useRef, useState } from "react";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { LiveConnectionBanner } from "@/components/live-connection-banner";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
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
  Search,
  XCircle,
  Activity,
  FileText,
  ImageOff,
  ExternalLink,
} from "lucide-react";
import { APP_VERSION } from "@shared/version";
import { countBulletsInBody } from "@shared/changelog-append";

type ChangelogDraftRow = {
  version: string;
  status: "collecting" | "awaiting_publish" | "published" | "draft";
  bodyHtml: string;
  updatedAt: string;
};
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import { formatDistanceToNow } from "date-fns";

type DashboardMetrics = {
  generatedAt: string;
  cached?: boolean;
  usersOnline: number | null;
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
    pushSent24h: number; pushFailed24h: number; emailSent24h: number;
    pushSubscriptionsTotal: number; pushSubscriptionsThisWeek: number;
  };
  knowledgeBase: {
    total: number; published: number;
    topViewed: { id: string; title: string; slug: string; viewCount: number }[];
    topZeroResultSearches: { query: string; count: number }[];
  };
  community: { messages24h: number; activeUsers7d: number; bannedUsers: number };
  users: { total: number; customers: number; admins: number; signupsToday: number; signupsThisWeek: number };
};

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

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

const ticketChartConfig = {
  opened: { label: "Opened", color: "hsl(217 91% 60%)" },
  resolved: { label: "Resolved", color: "hsl(142 71% 45%)" },
} as const;

type SystemHealth = {
  dbOk: boolean;
  dbLatencyMs: number;
  count5xxLast5Min: number;
  recent: { id: string; severity: string; source: string; summary: string; createdAt: string; resolvedAt: string | null }[];
};

type AppHealth = { ok: boolean; db: string; version: string; gitSha: string | null; uptime: number };

type MissingImagesReport = {
  count: number;
  items: { type: "kb_article" | "news_story"; id: string; title: string; missingFilenames: string[] }[];
};

export default function AdminDashboard({ onNavigateSection }: { onNavigateSection?: (key: string) => void }) {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const { isMasterAdmin } = useAuth();
  const { data, isLoading, error, dataUpdatedAt } = useQuery<DashboardMetrics>({
    queryKey: ["/api/admin/dashboard"],
    refetchInterval: 30_000,
  });

  // System Health tile (master_admin only) — polls every 30s alongside the
  // main dashboard. Hidden entirely for non-master admins (the endpoint
  // returns 403 for them anyway, but `enabled: false` skips the wasted call).
  const { data: sysHealth } = useQuery<SystemHealth>({
    queryKey: ["/api/admin/health/errors"],
    refetchInterval: 30_000,
    enabled: !!isMasterAdmin,
  });
  const { data: appHealth } = useQuery<AppHealth>({
    queryKey: ["/api/health"],
    refetchInterval: 60_000,
    enabled: !!isMasterAdmin,
  });

  // Missing inline-image scan (master_admin only). Surfaces KB articles / news
  // stories that embed an /uploads/<uuid> image whose blob is gone, so a
  // silently-broken image gets noticed and re-uploaded before a customer hits
  // it. Polls less aggressively than the error tile — this drifts slowly.
  const { data: missingImages } = useQuery<MissingImagesReport>({
    queryKey: ["/api/admin/health/missing-images"],
    refetchInterval: 300_000,
    enabled: !!isMasterAdmin,
  });
  const [missingImagesOpen, setMissingImagesOpen] = useState(false);

  // Changelog draft activity (master_admin only). Surfaces the count of
  // bullets queued under the current APP_VERSION's draft so the user
  // sees agent-appended notes piling up without having to open the
  // Changelog tab. Reuses the existing list endpoint — no new route.
  const { data: changelogRows } = useQuery<ChangelogDraftRow[]>({
    queryKey: ["/api/admin/changelog"],
    enabled: !!isMasterAdmin,
  });
  // Surface the open rolling draft (status "collecting") so agent-appended
  // notes pile up visibly. Falls back to the current version's awaiting-publish
  // entry if a version bump just stamped the notes but they're not published.
  const currentDraft =
    changelogRows?.find((r) => r.status === "collecting") ??
    changelogRows?.find((r) => r.version === APP_VERSION && r.status === "awaiting_publish");
  const currentDraftBulletCount = currentDraft
    ? countBulletsInBody(currentDraft.bodyHtml)
    : 0;

  // Live refresh via websocket: invalidate the dashboard query when ticket
  // or alert events fire so the counters react instantly instead of waiting
  // for the 30s poll. Throttled by the server-side 30s cache.
  const pendingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    onMessage: (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (typeof msg?.type !== "string") return;
        if (
          msg.type.startsWith("ticket_") ||
          msg.type === "new_ticket" ||
          msg.type === "new_alert" ||
          msg.type === "alert_update" ||
          msg.type === "alert_updated" ||
          msg.type === "alert_resolved"
        ) {
          if (pendingRef.current) return;
          pendingRef.current = setTimeout(() => {
            pendingRef.current = null;
            queryClient.invalidateQueries({ queryKey: ["/api/admin/dashboard"] });
          }, 1500);
        }
      } catch {}
    },
  });
  useEffect(() => () => {
    if (pendingRef.current) clearTimeout(pendingRef.current);
  }, []);

  if (isLoading) {
    return (
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4" data-testid="loading-dashboard">
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

  const onlineDisplay = data.usersOnline === null || data.usersOnline === undefined ? "—" : data.usersOnline;

  return (
    <div className="space-y-4" data-testid="page-admin-dashboard">
      <LiveConnectionBanner status={wsStatus} />
      <div className="grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-4">
        {/* Tickets */}
        <Card
          className="cursor-pointer hover-elevate active-elevate-2 md:col-span-2 xl:col-span-4"
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
            <ChartContainer config={ticketChartConfig} className="h-32 w-full aspect-auto">
              <BarChart data={data.tickets.series14d} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="opened" fill="var(--color-opened)" name="Opened" />
                <Bar dataKey="resolved" fill="var(--color-resolved)" name="Resolved" />
              </BarChart>
            </ChartContainer>
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
              <Stat
                label="Push sent"
                value={data.notifications.pushSent24h}
                sub={
                  data.notifications.pushFailed24h > 0 ? (
                    <span className="inline-flex items-center gap-1 text-red-500">
                      <XCircle className="w-3 h-3" /> {data.notifications.pushFailed24h} failed
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0 failed</span>
                  )
                }
              />
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
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                <Search className="w-3 h-3" /> Top zero-result searches
              </p>
              {data.knowledgeBase.topZeroResultSearches.length === 0 ? (
                <p className="text-xs text-muted-foreground italic" data-testid="text-zero-search-empty">
                  Search analytics not tracked yet
                </p>
              ) : data.knowledgeBase.topZeroResultSearches.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-xs gap-2" data-testid={`row-kb-zero-${i}`}>
                  <span className="truncate flex-1">{s.query}</span>
                  <span className="text-muted-foreground tabular-nums">{s.count}</span>
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
              <Stat label="Online now" value={onlineDisplay} sub={data.usersOnline === null ? "presence unavailable" : "live websocket count"} />
              <Stat label="Signups today" value={data.users.signupsToday} sub={<span className="inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {data.users.signupsThisWeek} this week</span>} />
            </div>
          </CardContent>
        </Card>

        {/* System Health (master_admin only) — 5xx rate, DB latency, build SHA */}
        {isMasterAdmin && (
          <Card
            className="cursor-pointer hover-elevate active-elevate-2 md:col-span-2"
            onClick={() => go("error-log")}
            data-testid="card-dashboard-system-health"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Activity className={`w-4 h-4 ${sysHealth && sysHealth.count5xxLast5Min > 0 ? "text-red-500" : "text-green-500"}`} /> System Health
                {sysHealth && sysHealth.count5xxLast5Min > 0 && (
                  <Badge variant="destructive" className="ml-auto" data-testid="badge-system-health-alert">
                    {sysHealth.count5xxLast5Min} error{sysHealth.count5xxLast5Min === 1 ? "" : "s"}
                  </Badge>
                )}
                {missingImages && missingImages.count > 0 && (
                  <Badge
                    variant="destructive"
                    role="button"
                    tabIndex={0}
                    className={`cursor-pointer ${sysHealth && sysHealth.count5xxLast5Min > 0 ? "" : "ml-auto"}`}
                    onClick={(e) => { e.stopPropagation(); setMissingImagesOpen(true); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setMissingImagesOpen(true); } }}
                    title="View which articles are missing images"
                    data-testid="badge-missing-images-alert"
                  >
                    {missingImages.count} missing image{missingImages.count === 1 ? "" : "s"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat
                  label="5xx (5min)"
                  value={sysHealth ? sysHealth.count5xxLast5Min : "—"}
                  sub={sysHealth && sysHealth.count5xxLast5Min === 0 ? "no errors" : "click to view"}
                />
                <Stat
                  label="DB latency"
                  value={sysHealth ? `${sysHealth.dbLatencyMs}ms` : "—"}
                  sub={sysHealth?.dbOk === false ? <span className="text-red-500">DB down</span> : "SELECT 1 round-trip"}
                />
                <Stat
                  label="Version"
                  value={appHealth?.version ?? "—"}
                  sub={appHealth?.gitSha ? <span className="font-mono text-[10px]">{appHealth.gitSha.slice(0, 7)}</span> : "no git sha"}
                />
                <Stat
                  label="Uptime"
                  value={appHealth ? formatUptime(appHealth.uptime) : "—"}
                  sub={sysHealth?.recent.length ? `${sysHealth.recent.length} recent in log` : "log empty"}
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Missing-images breakdown dialog (master_admin only). Lists which KB
            articles / news stories embed an /uploads/<uuid> image whose blob is
            gone, plus the exact missing filenames, so the affected content can
            be found and the image re-uploaded (or recovered from backup). */}
        {isMasterAdmin && (
          <Dialog open={missingImagesOpen} onOpenChange={setMissingImagesOpen}>
            <DialogContent className="max-w-lg" data-testid="dialog-missing-images">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ImageOff className="w-4 h-4 text-red-500" />
                  Missing images
                </DialogTitle>
                <DialogDescription>
                  These published items embed an image whose file is no longer
                  stored. Open each one and re-upload the image (or recover it
                  from a backup) to fix the broken image for customers.
                </DialogDescription>
              </DialogHeader>
              <div className="max-h-[60vh] overflow-y-auto space-y-3">
                {!missingImages || missingImages.items.length === 0 ? (
                  <p className="text-sm text-muted-foreground" data-testid="text-missing-images-empty">
                    No missing images. Everything checks out.
                  </p>
                ) : (
                  missingImages.items.map((item) => (
                    <div
                      key={`${item.type}-${item.id}`}
                      className="rounded-md border p-3"
                      data-testid={`row-missing-image-${item.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {item.type === "kb_article" ? (
                            <BookOpen className="w-4 h-4 shrink-0 text-muted-foreground" />
                          ) : (
                            <FileText className="w-4 h-4 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium truncate" data-testid={`text-missing-image-title-${item.id}`}>
                            {item.title}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                          onClick={() => {
                            setMissingImagesOpen(false);
                            go(item.type === "kb_article" ? "knowledge-base" : "news");
                          }}
                          data-testid={`link-missing-image-${item.id}`}
                        >
                          Open <ExternalLink className="w-3 h-3" />
                        </button>
                      </div>
                      <p className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
                        {item.type === "kb_article" ? "Knowledge Base article" : "News story"}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {item.missingFilenames.map((fn) => (
                          <li
                            key={fn}
                            className="font-mono text-xs text-red-500 break-all"
                            data-testid={`text-missing-filename-${fn}`}
                          >
                            {fn}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Changelog draft (master_admin only) — visibility into how many
            agent-appended bullets are queued for the current release before
            the user opens the Changelog tab to proofread + publish. */}
        {isMasterAdmin && (
          <Card
            className="cursor-pointer hover-elevate active-elevate-2 md:col-span-2"
            onClick={() => go("changelog")}
            data-testid="card-dashboard-changelog-draft"
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-4 h-4 text-cyan-500" /> Changelog draft
                {currentDraft && currentDraftBulletCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="ml-auto"
                    data-testid="badge-changelog-draft-count"
                  >
                    {currentDraftBulletCount} bullet{currentDraftBulletCount === 1 ? "" : "s"}
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat
                  label="Collecting for"
                  value={
                    currentDraft?.status === "awaiting_publish"
                      ? <span className="font-mono">v{currentDraft.version}</span>
                      : "Next release"
                  }
                  sub={
                    currentDraft?.status === "awaiting_publish"
                      ? "staged — ready to publish"
                      : "publishes on next version change"
                  }
                />
                <Stat
                  label="Bullets queued"
                  value={currentDraft ? currentDraftBulletCount : "—"}
                  sub={
                    currentDraft?.status === "awaiting_publish"
                      ? "click to proofread + publish"
                      : currentDraftBulletCount > 0
                        ? "click to proofread"
                        : "agent appends as we ship"
                  }
                />
                <Stat
                  label="Last updated"
                  value={
                    currentDraft
                      ? formatDistanceToNow(new Date(currentDraft.updatedAt), { addSuffix: true })
                      : "—"
                  }
                />
                <Stat
                  label="Status"
                  value={
                    currentDraft?.status === "awaiting_publish" ? "Awaiting publish"
                    : currentDraft ? "Collecting"
                    : "Empty"
                  }
                  sub={
                    currentDraft?.status === "awaiting_publish"
                      ? <span className="text-amber-600 dark:text-amber-400">publish to fire the welcome popup</span>
                      : "publishes only when the version changes"
                  }
                />
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <p className="text-xs text-muted-foreground flex items-center gap-1" data-testid="text-dashboard-updated">
        <Clock className="w-3 h-3" /> Last updated {formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true })}
        {data.cached && <span className="ml-1">· cached</span>}
      </p>
    </div>
  );
}
