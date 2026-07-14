import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { CheckCircle2, AlertTriangle, ChevronDown, ChevronUp, Bell, AlertCircle, ShieldCheck, ChevronRight, Megaphone } from "lucide-react";
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

function bucketColor(state: string): string {
  switch (state) {
    case "up": return "bg-emerald-500";
    case "partial": return "bg-amber-500";
    case "down": return "bg-red-500";
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

function statusColor(status: string): string {
  switch (status) {
    case "operational": return "bg-emerald-500";
    case "degraded": return "bg-amber-500";
    case "outage": return "bg-red-500";
    case "maintenance": return "bg-blue-500";
    default: return "bg-gray-400";
  }
}

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
  ok: "bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900 text-emerald-900 dark:text-emerald-100",
  warn: "bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-100",
  bad: "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900 text-red-900 dark:text-red-100",
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

  const { data, isLoading } = useQuery<PublicStatusResponse>({
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
          className="block border rounded-lg p-4 hover:bg-accent/40 transition-colors"
          data-testid={`link-incident-${a.id}`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 mb-1">
                {a.status === "resolved" ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                )}
                <span className="font-medium">{a.title}</span>
              </div>
              <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                <span>{a.serviceNames && a.serviceNames.length > 0 ? a.serviceNames.join(", ") : a.serviceName}</span>
                <span className="capitalize">{a.severity}</span>
                <span className="capitalize">{a.status}</span>
                {a.createdAt && <span>Started {format(new Date(a.createdAt), "PPp")}</span>}
                {a.lastUpdateAt && a.status !== "resolved" && (
                  <span data-testid={`text-last-update-${a.id}`}>Last update {format(new Date(a.lastUpdateAt), "PPp")}</span>
                )}
                {a.resolvedAt && <span>Resolved {format(new Date(a.resolvedAt), "PPp")}</span>}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
          </div>
        </Link>
      </li>
    );
  };

  const BannerIcon = banner.icon;

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold" data-testid="text-public-status-title">Service Status</h1>
          <a href="/" className="text-sm text-primary hover:underline" data-testid="link-signin">Sign in</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div
          className={`flex items-center gap-3 rounded-lg border p-4 ${bannerStyles[banner.tone]}`}
          data-testid={`banner-overall-${banner.tone}`}
        >
          <BannerIcon className="h-5 w-5 shrink-0" />
          <span className="font-semibold" data-testid="text-banner-title">{banner.title}</span>
        </div>

        {isLoading ? (
          <Card>
            <CardHeader><CardTitle>Current status</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ) : (
          grouped.map(([category, list]) => (
            <Card key={category} data-testid={`group-category-${category}`}>
              <CardHeader>
                <CardTitle className="text-base">{category}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {list.map((s) => (
                    <li key={s.id} className="py-3 space-y-2" data-testid={`row-service-${s.id}`}>
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{s.name}</span>
                        <div className="flex items-center gap-3">
                          <span className="flex items-center gap-2 text-sm">
                            <span className={`inline-block w-2.5 h-2.5 rounded-full ${statusColor(s.status)}`} />
                            <span className="capitalize">{s.status}</span>
                          </span>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setFollowService(s)}
                            data-testid={`button-follow-${s.id}`}
                          >
                            <Bell className="h-3.5 w-3.5 mr-1" />
                            Follow
                          </Button>
                        </div>
                      </div>
                      {s.hasMonitor && s.dailyBuckets && s.dailyBuckets.length > 0 ? (
                        <div className="space-y-1">
                          <Sparkline buckets={s.dailyBuckets} />
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>90 days</span>
                            <span data-testid={`text-uptime-${s.id}`}>
                              {typeof s.uptime30d === "number" ? `${s.uptime30d.toFixed(2)}% uptime · 30d` : "— uptime · 30d"}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>No uptime monitor</span>
                          <span data-testid={`text-uptime-${s.id}`}>— uptime · 30d</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))
        )}

        {!isLoading && services.length === 0 && (
          <Card><CardContent className="py-6 text-sm text-muted-foreground">No services configured.</CardContent></Card>
        )}

        <Card>
          <CardHeader><CardTitle>Current incidents</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : currentIncidents.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-current-incidents">No incidents in progress.</p>
            ) : (
              <ul className="space-y-4">{currentIncidents.map(renderIncident)}</ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <button
              type="button"
              className="flex items-center justify-between w-full text-left"
              onClick={() => setHistoryOpen((v) => !v)}
              data-testid="button-toggle-history"
            >
              <CardTitle>Recent history (last 14 days)</CardTitle>
              {historyOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </CardHeader>
          {historyOpen && (
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : recentHistory.length === 0 ? (
                <p className="text-sm text-muted-foreground">No incidents resolved in the last 14 days.</p>
              ) : (
                <ul className="space-y-4">{recentHistory.map(renderIncident)}</ul>
              )}
            </CardContent>
          )}
        </Card>

        {!isLoading && updates.length > 0 && (
          <Card data-testid="card-recent-updates">
            <CardHeader><CardTitle>Recent service updates</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-4">
                {updates.map((u) => (
                  <li key={u.id} data-testid={`item-update-${u.id}`} className="border rounded-lg p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <Megaphone className="h-4 w-4 text-blue-500" />
                          <span className="font-medium">{u.title}</span>
                          <span className="inline-flex items-center rounded-full border border-blue-200 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                            Update
                          </span>
                        </div>
                        {u.description && (
                          <p className="text-sm text-muted-foreground mb-1" data-testid={`text-update-snippet-${u.id}`}>
                            {truncate(htmlToPlainTextInline(u.description), 200)}
                          </p>
                        )}
                        <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                          <span>{u.serviceName}</span>
                          {u.createdAt && (
                            <span data-testid={`text-update-time-${u.id}`}>
                              {formatDistanceToNow(new Date(u.createdAt), { addSuffix: true })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
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
