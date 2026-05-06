import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import DOMPurify from "dompurify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { format } from "date-fns";
import { CheckCircle2, AlertTriangle, FileText, ChevronDown, ChevronUp, Bell } from "lucide-react";

type PublicAlert = {
  id: string;
  title: string;
  status: string;
  severity: string;
  serviceName: string;
  createdAt: string | null;
  resolvedAt: string | null;
  postmortemHtml: string | null;
  postmortemPublishedAt: string | null;
};

type PublicService = {
  id: string;
  name: string;
  status: string;
  hasMonitor?: boolean;
  uptime30d?: number | null;
  dailyBuckets?: { date: string; state: "up" | "partial" | "down" | "unknown" }[];
};

type PublicStatusResponse = {
  services: PublicService[];
  alerts: PublicAlert[];
};

function bucketColor(state: string): string {
  switch (state) {
    case "up": return "bg-emerald-500";
    case "partial": return "bg-amber-500";
    case "down": return "bg-red-500";
    default: return "bg-muted";
  }
}

function Sparkline({ buckets }: { buckets: { date: string; state: string }[] }) {
  return (
    <div className="flex gap-[2px] h-6 items-end" data-testid="sparkline-uptime">
      {buckets.map((b, i) => (
        <div
          key={i}
          title={`${b.date}: ${b.state}`}
          className={`flex-1 min-w-[2px] h-full rounded-sm ${bucketColor(b.state)}`}
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
      const res = await apiRequest("POST", "/api/public/services/follow", {
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
      toast({ title: "Subscribe failed", description: err.message, variant: "destructive" });
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

const PURIFY_CONFIG = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"],
  ALLOWED_ATTR: ["style", "src", "alt", "width", "height", "href", "target", "rel"],
};

function statusColor(status: string): string {
  switch (status) {
    case "operational": return "bg-emerald-500";
    case "degraded": return "bg-amber-500";
    case "outage": return "bg-red-500";
    case "maintenance": return "bg-blue-500";
    default: return "bg-gray-400";
  }
}

export default function PublicStatusPage() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [followService, setFollowService] = useState<PublicService | null>(null);

  const { data, isLoading } = useQuery<PublicStatusResponse>({
    queryKey: ["/api/public/status"],
  });

  const subscribeMutation = useMutation({
    mutationFn: async (emailValue: string) => {
      const res = await apiRequest("POST", "/api/public/subscribe", { email: emailValue });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Subscribed", description: "Check your inbox to confirm." });
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["/api/public/status"] });
    },
    onError: (err: Error) => {
      toast({ title: "Subscribe failed", description: err.message, variant: "destructive" });
    },
  });

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const resolvedWithPostmortem = (data?.alerts || []).filter(a => a.status === "resolved" && a.postmortemHtml && a.postmortemPublishedAt);
  const recent = (data?.alerts || []).slice(0, 15);

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold" data-testid="text-public-status-title">Service Status</h1>
          <a href="/" className="text-sm text-primary hover:underline" data-testid="link-signin">Sign in</a>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <Card>
          <CardHeader><CardTitle>Current status</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <ul className="divide-y">
                {(data?.services || []).map(s => (
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
                    {s.hasMonitor && s.dailyBuckets && s.dailyBuckets.length > 0 && (
                      <div className="space-y-1">
                        <Sparkline buckets={s.dailyBuckets} />
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>90 days</span>
                          {typeof s.uptime30d === "number" && (
                            <span data-testid={`text-uptime-${s.id}`}>{s.uptime30d.toFixed(2)}% uptime · 30d</span>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                ))}
                {(data?.services || []).length === 0 && (
                  <li className="py-4 text-sm text-muted-foreground">No services configured.</li>
                )}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent incidents</CardTitle></CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-32 w-full" />
            ) : recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent incidents.</p>
            ) : (
              <ul className="space-y-4">
                {recent.map(a => {
                  const hasPostmortem = !!(a.postmortemHtml && a.postmortemPublishedAt);
                  const isOpen = expanded.has(a.id);
                  return (
                    <li key={a.id} className="border rounded-lg p-4" data-testid={`item-incident-${a.id}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {a.status === "resolved" ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : (
                              <AlertTriangle className="h-4 w-4 text-amber-500" />
                            )}
                            <span className="font-medium">{a.title}</span>
                          </div>
                          <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1">
                            <span>{a.serviceName}</span>
                            <span className="capitalize">{a.severity}</span>
                            <span className="capitalize">{a.status}</span>
                            {a.createdAt && <span>{format(new Date(a.createdAt), "PPp")}</span>}
                          </div>
                        </div>
                        {hasPostmortem && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => toggle(a.id)}
                            data-testid={`button-postmortem-${a.id}`}
                          >
                            <FileText className="h-3.5 w-3.5 mr-1" />
                            Postmortem
                            {isOpen ? <ChevronUp className="h-3.5 w-3.5 ml-1" /> : <ChevronDown className="h-3.5 w-3.5 ml-1" />}
                          </Button>
                        )}
                      </div>
                      {hasPostmortem && isOpen && (
                        <div
                          className="prose prose-sm dark:prose-invert max-w-none mt-4 pt-4 border-t"
                          data-testid={`text-postmortem-${a.id}`}
                          dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(a.postmortemHtml!, PURIFY_CONFIG),
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {!isLoading && resolvedWithPostmortem.length === 0 && recent.length > 0 && (
              <p className="text-xs text-muted-foreground mt-3">Postmortems will appear here once published.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Subscribe to postmortem updates</CardTitle></CardHeader>
          <CardContent>
            <form
              className="flex flex-col sm:flex-row gap-2"
              onSubmit={e => {
                e.preventDefault();
                if (email.trim()) subscribeMutation.mutate(email.trim());
              }}
            >
              <Input
                type="email"
                required
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                data-testid="input-subscribe-email"
              />
              <Button type="submit" disabled={subscribeMutation.isPending} data-testid="button-subscribe">
                {subscribeMutation.isPending ? "Subscribing…" : "Subscribe"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">Get an email when we publish an incident postmortem. Unsubscribe anytime.</p>
          </CardContent>
        </Card>
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
