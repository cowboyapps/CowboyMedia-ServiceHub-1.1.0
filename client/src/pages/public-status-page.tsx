import { serviceStatusDot, severityMeta, incidentStatusPill as statusPill } from "@/lib/status-meta";
import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { format, formatDistanceToNow } from "date-fns";
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Bell, AlertCircle, ShieldCheck, ChevronRight, Megaphone, Activity, History } from "lucide-react";
import { Link } from "wouter";
import { htmlToPlainTextInline } from "@shared/html-text";

type PublicAlert = {
  id: string;
  title: string;
  status: string;
  severity: string;
  serviceName: string;
  serviceNames?: string[];
  createdAt: string | null;
  resolvedAt: string | null;
  lastUpdateAt: string | null;
};

type DailyBucket = { date: string; status: "up" | "partial" | "down" | "unknown"; downtimeSeconds?: number };

type PublicService = {
  id: string;
  name: string;
  status: string;
  category?: string;
  hasMonitor?: boolean;
  uptime30d?: number | null;
  dailyBuckets?: DailyBucket[];
};

type PublicServiceUpdate = {
  id: string;
  title: string;
  description: string;
  serviceName: string;
  createdAt: string | null;
};

type PublicStatusResponse = {
  services: PublicService[];
  alerts: PublicAlert[];
  updates: PublicServiceUpdate[];
};

function truncate(text: string, max: number): string {
  const plain = text.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  if (plain.length <= max) return plain;
  return plain.slice(0, max).trimEnd() + "…";
}

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowSkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-2.5 w-2.5 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
          </div>
          <Skeleton className="h-8 w-20 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

function bucketColor(state: string): string {
  switch (state) {
    case "up": return "bg-status-online";
    case "partial": return "bg-status-away";
    case "down": return "bg-status-busy";
    default: return "bg-muted";
  }
}

function Sparkline({ buckets }: { buckets: DailyBucket[] }) {
  return (
    <div className="flex gap-[2px] h-6 items-end w-full overflow-hidden" data-testid="sparkline-uptime">
      {buckets.map((b, i) => (
        <div
          key={i}
          title={`${b.date}: ${b.status}`}
          className={`flex-1 min-w-0 h-full rounded-sm ${bucketColor(b.status)}`}
        />
      ))}
    </div>
  );
}

function FollowDialog({ service, open, onOpenChange }: { service: PublicService; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState<string[]>(["incident", "resolved"]);

  const followMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/public/subscribe", {
        email: email.trim(),
        serviceId: service.id,
        events,
      });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.confirmed ? "Already subscribed" : "Check your inbox", description: data.message });
      setEmail("");
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Subscribe failed", description: serverActionErrorMessage(err, "Couldn't subscribe right now. Please try again."), variant: "destructive" });
    },
  });

  const toggleEvent = (e: string) => {
    setEvents((prev) => prev.includes(e) ? prev.filter((x) => x !== e) : [...prev, e]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Follow {service.name}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!email.trim() || events.length === 0) return;
            followMutation.mutate();
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="follow-email">Email address</Label>
            <Input id="follow-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" data-testid="input-follow-email" />
          </div>
          <div className="space-y-2">
            <Label>Notify me about</Label>
            <div className="space-y-2">
              {[
                { key: "status", label: "Service status changes" },
                { key: "incident", label: "New incidents" },
                { key: "resolved", label: "Incident resolutions" },
              ].map((opt) => (
                <div key={opt.key} className="flex items-center gap-2">
                  <Checkbox id={`evt-${opt.key}`} checked={events.includes(opt.key)} onCheckedChange={() => toggleEvent(opt.key)} data-testid={`checkbox-event-${opt.key}`} />
                  <Label htmlFor={`evt-${opt.key}`} className="font-normal cursor-pointer">{opt.label}</Label>
                </div>
              ))}
            </div>
          </div>
          <p className="text-xs text-muted-foreground">We'll send a confirmation email. You can unsubscribe anytime.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={followMutation.isPending || events.length === 0} data-testid="button-confirm-follow">
              {followMutation.isPending ? "Sending…" : "Follow"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const statusColor = serviceStatusDot;

type Banner = { tone: "ok" | "warn" | "bad"; title: string; icon: typeof ShieldCheck };

function computeBanner(services: PublicService[]): Banner {
  if (services.some((s) => s.status === "outage")) {
    return { tone: "bad", title: "Major outage", icon: AlertCircle };
  }
  if (services.some((s) => s.status === "degraded" || s.status === "maintenance")) {
    return { tone: "warn", title: "Some systems degraded", icon: AlertTriangle };
  }
  return { tone: "ok", title: "All systems operational", icon: ShieldCheck };
}

const bannerStyles: Record<Banner["tone"], string> = {
  ok: "border-status-online/40 ring-1 ring-inset ring-status-online/20 bg-gradient-to-br from-status-online/20 via-status-online/10 to-transparent text-status-online",
  warn: "border-status-away/40 ring-1 ring-inset ring-status-away/20 bg-gradient-to-br from-status-away/20 via-status-away/10 to-transparent text-status-away",
  bad: "border-status-busy/40 ring-1 ring-inset ring-status-busy/20 bg-gradient-to-br from-status-busy/20 via-status-busy/10 to-transparent text-status-busy",
};

const FOURTEEN_DAYS_MS = 14 * 86400000;

export default function PublicStatusPage() {
  const [followService, setFollowService] = useState<PublicService | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    const prevTitle = document.title;
    document.title = "Service Status — CowboyMedia";
    let metaDesc = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const prevDesc = metaDesc?.getAttribute("content") || null;
    if (!metaDesc) {
      metaDesc = document.createElement("meta");
      metaDesc.name = "description";
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute("content", "Live service status, 30-day uptime, and incident history for CowboyMedia. Subscribe to per-service email updates.");
    return () => {
      document.title = prevTitle;
      if (metaDesc) {
        if (prevDesc !== null) metaDesc.setAttribute("content", prevDesc);
        else metaDesc.remove();
      }
    };
  }, []);

  const { data, isLoading, isError, refetch } = useQuery<PublicStatusResponse>({
    queryKey: ["/api/public/status"],
  });

  const services = useMemo(() => data?.services || [], [data?.services]);
  const alerts = data?.alerts || [];
  const updates = data?.updates || [];
  const banner = useMemo(() => computeBanner(services), [services]);

  const grouped = useMemo(() => {
    const map = new Map<string, PublicService[]>();
    for (const s of services) {
      const key = s.category || "Other";
      const arr = map.get(key) || [];
      arr.push(s);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [services]);

  const now = Date.now();
  const currentIncidents = alerts.filter((a) => a.status !== "resolved");
  const recentHistory = alerts.filter((a) => {
    if (a.status !== "resolved") return false;
    const t = a.resolvedAt ? new Date(a.resolvedAt).getTime() : a.createdAt ? new Date(a.createdAt).getTime() : 0;
    return now - t <= FOURTEEN_DAYS_MS;
  });

  const renderIncident = (a: PublicAlert) => {
    return (
      <li key={a.id} data-testid={`item-incident-${a.id}`}>
        <Link
          href={`/status/incidents/${a.id}`}
          className="flex items-start gap-3 px-5 py-4 hover-elevate tap-interactive"
          data-testid={`link-incident-${a.id}`}
        >
          <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 ${a.status === "resolved" ? "bg-status-online" : "bg-status-away animate-status-pulse"}`} />
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="truncate text-sm font-medium">{a.title}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                {a.serviceNames && a.serviceNames.length > 0 ? a.serviceNames.join(", ") : a.serviceName}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${(severityMeta[a.severity] || severityMeta.info).pill}`}>
                {a.severity}
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${statusPill[a.status] || "bg-muted text-muted-foreground"}`}>
                {a.status}
              </span>
            </div>
            <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
              {a.createdAt && <span>Started {format(new Date(a.createdAt), "PPp")}</span>}
              {a.lastUpdateAt && a.status !== "resolved" && (
                <span data-testid={`text-last-update-${a.id}`}>Last update {format(new Date(a.lastUpdateAt), "PPp")}</span>
              )}
              {a.resolvedAt && <span>Resolved {format(new Date(a.resolvedAt), "PPp")}</span>}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
        </Link>
      </li>
    );
  };

  const BannerIcon = banner.icon;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold" data-testid="text-public-status-title">Service Status</h1>
          <a href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-signin">Sign in</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        {isError ? (
          <div
            className="flex flex-col items-start gap-3 rounded-xl border border-card-border p-6 bg-card"
            data-testid="banner-overall-error"
          >
            <div className="flex items-center gap-3 text-foreground">
              <AlertCircle className="h-5 w-5 shrink-0 text-muted-foreground" />
              <span className="font-semibold" data-testid="text-banner-error-title">
                Status unavailable
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              We couldn't load the current service status. This does not mean services are down — please try again.
            </p>
            <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-status">
              Retry
            </Button>
          </div>
        ) : (
        <>
        <div
          className={`flex items-center gap-4 rounded-xl border p-6 shadow-sm ${bannerStyles[banner.tone]}`}
          data-testid={`banner-overall-${banner.tone}`}
        >
          <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ring-1 ${banner.tone === 'ok' ? 'bg-status-online/15 ring-status-online/30' : banner.tone === 'warn' ? 'bg-status-away/15 ring-status-away/30' : 'bg-status-busy/15 ring-status-busy/30'}`}>
            <BannerIcon className={`h-6 w-6 ${banner.tone !== 'ok' ? 'animate-status-pulse' : ''} ${banner.tone === 'ok' ? 'text-status-online' : banner.tone === 'warn' ? 'text-status-away' : 'text-status-busy'}`} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold" data-testid="text-banner-title">{banner.title}</p>
            <p className="text-sm opacity-90">Based on live monitoring of all active systems</p>
          </div>
        </div>

        {isLoading ? (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="flex items-center px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-3">
                <SectionIcon icon={Activity} tone="bg-muted text-muted-foreground" />
                Current status
              </h2>
            </div>
            <RowSkeletons />
          </section>
        ) : (
          grouped.map(([category, list]) => (
            <section key={category} className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid={`group-category-${category}`}>
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-3">
                  <SectionIcon icon={ShieldCheck} tone="bg-primary/10 text-primary" />
                  {category}
                </h2>
              </div>
              <ul className="divide-y divide-border">
                {list.map((s) => (
                  <li key={s.id} className="px-5 py-4 space-y-3" data-testid={`row-service-${s.id}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium text-sm">{s.name}</span>
                      <div className="flex items-center gap-4">
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor(s.status)} ${s.status !== "operational" ? "animate-status-pulse" : ""}`} />
                          <span className="capitalize text-muted-foreground">{s.status}</span>
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8"
                          onClick={() => setFollowService(s)}
                          data-testid={`button-follow-${s.id}`}
                        >
                          <Bell className="h-3.5 w-3.5 mr-1.5" />
                          Follow
                        </Button>
                      </div>
                    </div>
                    {s.hasMonitor && s.dailyBuckets && s.dailyBuckets.length > 0 ? (
                      <div className="space-y-1.5">
                        <Sparkline buckets={s.dailyBuckets} />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>90 days ago</span>
                          <span data-testid={`text-uptime-${s.id}`}>
                            {typeof s.uptime30d === "number" ? `${s.uptime30d.toFixed(2)}% uptime` : "— uptime"}
                          </span>
                          <span>Today</span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>No uptime monitor configured</span>
                        <span data-testid={`text-uptime-${s.id}`}>— uptime · 30d</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}

        {!isLoading && services.length === 0 && (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="px-5 py-8 text-center">
              <ShieldCheck className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No services configured.</p>
            </div>
          </section>
        )}

        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={AlertTriangle} tone="bg-status-away/10 text-status-away" />
              Current incidents
            </h2>
          </div>
          {isLoading ? (
            <RowSkeletons rows={2} />
          ) : currentIncidents.length === 0 ? (
            <div className="px-5 py-8 text-center">
              <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-status-online animate-status-glow" />
              <p className="text-sm text-muted-foreground" data-testid="text-no-current-incidents">No incidents in progress.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">{currentIncidents.map(renderIncident)}</ul>
          )}
        </section>

        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <button
            type="button"
            className="flex items-center justify-between w-full px-5 py-4 border-b border-border text-left hover:bg-muted/50 transition-colors"
            onClick={() => setHistoryOpen((v) => !v)}
            data-testid="button-toggle-history"
          >
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={History} tone="bg-muted text-muted-foreground" />
              Recent history (last 14 days)
            </h2>
            {historyOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
          {historyOpen && (
            <div>
              {isLoading ? (
                <RowSkeletons rows={2} />
              ) : recentHistory.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No incidents resolved in the last 14 days.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">{recentHistory.map(renderIncident)}</ul>
              )}
            </div>
          )}
        </section>

        {!isLoading && updates.length > 0 && (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-recent-updates">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold flex items-center gap-3">
                <SectionIcon icon={Bell} tone="bg-blue-500/10 text-blue-500" />
                Recent service updates
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {updates.map((u) => (
                <li key={u.id} data-testid={`item-update-${u.id}`} className="px-5 py-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <Megaphone className="h-4 w-4 text-blue-500 shrink-0" />
                        <span className="font-medium text-sm">{u.title}</span>
                        <span className="inline-flex items-center rounded-full bg-blue-500/10 text-blue-500 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                          Update
                        </span>
                      </div>
                      {u.description && (
                        <p className="text-sm text-muted-foreground mb-2" data-testid={`text-update-snippet-${u.id}`}>
                          {truncate(htmlToPlainTextInline(u.description), 200)}
                        </p>
                      )}
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                        <span className="rounded-full bg-muted px-2 py-0.5">{u.serviceName}</span>
                        {u.createdAt && (
                          <span className="flex items-center" data-testid={`text-update-time-${u.id}`}>
                            {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
        </>
        )}

      </main>

      {followService && (
        <FollowDialog
          service={followService}
          open={!!followService}
          onOpenChange={(v) => { if (!v) setFollowService(null); }}
        />
      )}
    </div>
  );
}
