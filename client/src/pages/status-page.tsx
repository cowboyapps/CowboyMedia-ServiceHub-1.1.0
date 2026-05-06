import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, AlertTriangle, XCircle, Wrench, Bell, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

type DailyStatus = "up" | "partial" | "down" | "unknown";

interface PublicService {
  id: string;
  name: string;
  description: string | null;
  status: string;
  category: string | null;
  uptime30d: number | null;
  dailyBuckets: { date: string; status: DailyStatus; downtimeSeconds: number }[];
  hasMonitor: boolean;
  activeAlerts: { id: string; title: string; severity: string; status: string; createdAt: string }[];
  recentResolved: { id: string; title: string; resolvedAt: string; createdAt: string }[];
}

interface StatusResponse {
  services: PublicService[];
  generatedAt: string;
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "operational":
      return <CheckCircle className="w-5 h-5 text-emerald-500" />;
    case "degraded":
      return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    case "outage":
      return <XCircle className="w-5 h-5 text-red-500" />;
    case "maintenance":
      return <Wrench className="w-5 h-5 text-blue-500" />;
    default:
      return <CheckCircle className="w-5 h-5 text-muted-foreground" />;
  }
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    operational: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    degraded: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    outage: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30",
    maintenance: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30",
  };
  const labels: Record<string, string> = {
    operational: "Operational",
    degraded: "Degraded",
    outage: "Outage",
    maintenance: "Maintenance",
  };
  return (
    <span
      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${styles[status] || styles.operational}`}
      data-testid={`pill-status-${status}`}
    >
      {labels[status] || status}
    </span>
  );
}

function Sparkline({ buckets, serviceId }: { buckets: PublicService["dailyBuckets"]; serviceId: string }) {
  if (!buckets.length) {
    return <div className="text-xs text-muted-foreground italic">No uptime data available — link a URL monitor to this service to populate.</div>;
  }
  const colors: Record<DailyStatus, string> = {
    up: "bg-emerald-500",
    partial: "bg-amber-500",
    down: "bg-red-500",
    unknown: "bg-muted",
  };
  return (
    <div className="flex items-end gap-[2px] h-8" data-testid={`sparkline-${serviceId}`}>
      {buckets.map((b) => (
        <div
          key={b.date}
          className={`flex-1 min-w-[2px] rounded-sm ${colors[b.status]}`}
          style={{ height: "100%" }}
          title={`${b.date} — ${b.status}${b.downtimeSeconds > 0 ? ` (${Math.round(b.downtimeSeconds / 60)}m down)` : ""}`}
        />
      ))}
    </div>
  );
}

function FollowDialog({ service, open, onOpenChange }: { service: PublicService | null; open: boolean; onOpenChange: (v: boolean) => void }) {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [events, setEvents] = useState<string[]>(["incident", "resolved"]);

  const subscribeMutation = useMutation({
    mutationFn: async () => {
      if (!service) throw new Error("No service");
      return apiRequest("POST", "/api/public/subscribe", { email: email.trim(), serviceId: service.id, events });
    },
    onSuccess: async (res) => {
      const data = await res.json();
      toast({ title: "Check your email", description: data.message || "Confirmation email sent." });
      setEmail("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Couldn't subscribe", description: err.message || "Please try again.", variant: "destructive" });
    },
  });

  const toggle = (e: string) => setEvents((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Follow {service?.name}</DialogTitle>
          <DialogDescription>Get email updates whenever this service has an incident or status change.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="follow-email">Email address</Label>
            <Input
              id="follow-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              data-testid="input-follow-email"
            />
          </div>
          <div className="space-y-2">
            <Label>Notify me about</Label>
            {[
              { key: "incident", label: "New incidents" },
              { key: "status", label: "Service status changes" },
              { key: "resolved", label: "When incidents are resolved" },
            ].map((opt) => (
              <label key={opt.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={events.includes(opt.key)}
                  onCheckedChange={() => toggle(opt.key)}
                  data-testid={`checkbox-event-${opt.key}`}
                />
                {opt.label}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">We'll send a confirmation email — you must click the link to start receiving updates. You can unsubscribe at any time.</p>
          <Button
            className="w-full"
            disabled={!email.trim() || events.length === 0 || subscribeMutation.isPending}
            onClick={() => subscribeMutation.mutate()}
            data-testid="button-confirm-follow"
          >
            {subscribeMutation.isPending ? "Sending…" : "Send confirmation email"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ServiceRow({ service }: { service: PublicService }) {
  const [expanded, setExpanded] = useState(false);
  const [followOpen, setFollowOpen] = useState(false);

  return (
    <Card data-testid={`status-card-${service.id}`}>
      <CardContent className="p-4 sm:p-5 space-y-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5"><StatusIcon status={service.status} /></div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-base" data-testid={`text-service-name-${service.id}`}>{service.name}</h3>
              <StatusPill status={service.status} />
              {service.category && <Badge variant="secondary" className="text-[10px]">{service.category}</Badge>}
            </div>
            {service.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{service.description}</p>}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFollowOpen(true)}
            data-testid={`button-follow-${service.id}`}
            className="flex-shrink-0"
          >
            <Bell className="w-4 h-4 sm:mr-1.5" />
            <span className="hidden sm:inline">Follow</span>
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span data-testid={`text-uptime-${service.id}`}>
            {service.uptime30d != null
              ? <><strong className="text-foreground">{service.uptime30d.toFixed(2)}%</strong> uptime · 30 days</>
              : <span className="italic">No monitor linked</span>}
          </span>
          <span>Last 90 days →</span>
        </div>
        <Sparkline buckets={service.dailyBuckets} serviceId={service.id} />

        {service.activeAlerts.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2" data-testid={`active-incidents-${service.id}`}>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wide">Current incidents</p>
            {service.activeAlerts.map((a) => (
              <div key={a.id} className="text-sm">
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-muted-foreground capitalize">{a.status} · {format(new Date(a.createdAt), "MMM d, h:mm a")}</p>
              </div>
            ))}
          </div>
        )}

        {service.recentResolved.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              data-testid={`button-toggle-history-${service.id}`}
            >
              {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              Recent history ({service.recentResolved.length})
            </button>
            {expanded && (
              <div className="mt-2 space-y-1.5 pl-4 border-l border-border">
                {service.recentResolved.map((a) => (
                  <div key={a.id} className="text-xs">
                    <p className="font-medium">{a.title}</p>
                    <p className="text-muted-foreground">Resolved {format(new Date(a.resolvedAt), "MMM d, yyyy")}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
      <FollowDialog service={service} open={followOpen} onOpenChange={setFollowOpen} />
    </Card>
  );
}

export default function StatusPage() {
  const { data, isLoading } = useQuery<StatusResponse>({
    queryKey: ["/api/public/status"],
    refetchInterval: 60000,
  });

  const services = data?.services || [];
  const allOk = services.length > 0 && services.every((s) => s.status === "operational");
  const anyOutage = services.some((s) => s.status === "outage");
  const overallLabel = services.length === 0
    ? "No services configured"
    : allOk
    ? "All systems operational"
    : anyOutage
    ? "Major outage"
    : "Some systems impacted";
  const overallClass = allOk
    ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
    : anyOutage
    ? "bg-red-500/15 border-red-500/30 text-red-700 dark:text-red-400"
    : "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400";

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-5 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold" data-testid="text-status-title">Service Status</h1>
            <p className="text-xs text-muted-foreground">Real-time updates from CowboyMedia</p>
          </div>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-app">Back to app →</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        <div className={`rounded-xl border px-4 py-4 ${overallClass}`} data-testid="banner-overall-status">
          <p className="font-semibold text-base">{overallLabel}</p>
          {data && <p className="text-xs opacity-75 mt-0.5">Updated {format(new Date(data.generatedAt), "MMM d, yyyy 'at' h:mm a")}</p>}
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)}
          </div>
        ) : services.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">No services configured yet.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {services.map((s) => <ServiceRow key={s.id} service={s} />)}
          </div>
        )}

        <p className="text-xs text-center text-muted-foreground pt-4">
          Want updates? Click <Bell className="w-3 h-3 inline-block mb-0.5" /> Follow on any service.
        </p>
      </main>
    </div>
  );
}
