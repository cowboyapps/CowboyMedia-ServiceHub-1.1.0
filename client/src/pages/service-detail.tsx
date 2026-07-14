import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDistanceToNow } from "date-fns";
import { ArrowLeft, Activity, CheckCircle2, AlertTriangle, XCircle, Wrench, Clock, ChevronRight } from "lucide-react";
import { QueryErrorState } from "@/components/query-error-state";
import { stripHtml } from "@/components/rich-text-editor";
import { alertStatusLabel, alertSeverityLabel } from "@/lib/status-meta";
import type { Service, ServiceAlertWithServices } from "@shared/schema";

type DailyStatus = "up" | "partial" | "down" | "unknown";

interface UptimeData {
  uptime30d: number | null;
  dailyBuckets: { date: string; status: DailyStatus; downtimeSeconds: number }[];
  hasMonitor: boolean;
}

const severityMeta: Record<string, { pill: string }> = {
  critical: { pill: "bg-status-busy/15 text-status-busy" },
  warning: { pill: "bg-status-away/15 text-status-away" },
  info: { pill: "bg-status-away/15 text-status-away" },
};

const statusPill: Record<string, string> = {
  investigating: "bg-status-away/15 text-status-away",
  identified: "bg-status-away/15 text-status-away",
  monitoring: "bg-primary/15 text-primary",
  resolved: "bg-status-online/15 text-status-online",
};

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function UptimeBlock({ serviceId }: { serviceId: string }) {
  const { data, isLoading } = useQuery<UptimeData>({ queryKey: ["/api/services", serviceId, "uptime"] });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!data || !data.hasMonitor) return null;
  const colors: Record<DailyStatus, string> = {
    up: "bg-status-online",
    partial: "bg-status-away",
    down: "bg-status-busy",
    unknown: "bg-muted",
  };
  return (
    <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-service-uptime">
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">30-day uptime</p>
            <p className="text-2xl font-bold mt-0.5" data-testid="text-service-uptime-30d">
              {data.uptime30d != null ? `${data.uptime30d.toFixed(2)}%` : "—"}
            </p>
          </div>
          <span className="text-xs text-muted-foreground">Last 90 days</span>
        </div>
        <div className="flex items-end gap-[2px] h-8 w-full overflow-hidden">
          {data.dailyBuckets.map((b) => (
            <div
              key={b.date}
              className={`flex-1 min-w-0 rounded-sm ${colors[b.status]}`}
              style={{ height: "100%" }}
              title={`${b.date} — ${b.status}${b.downtimeSeconds > 0 ? ` (${Math.round(b.downtimeSeconds / 60)}m down)` : ""}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function ServiceStatusIcon({ status }: { status: string }) {
  const isActive = status !== "operational";
  const pulseClass = isActive ? "animate-status-pulse" : "";
  switch (status) {
    case "operational":
      return <CheckCircle2 className="w-8 h-8 text-status-online animate-status-glow" />;
    case "degraded":
      return <AlertTriangle className={`w-8 h-8 text-status-away ${pulseClass}`} />;
    case "outage":
      return <XCircle className={`w-8 h-8 text-status-busy ${pulseClass}`} />;
    case "maintenance":
      return <Wrench className={`w-8 h-8 text-status-offline ${pulseClass}`} />;
    default:
      return <Activity className="w-8 h-8 text-muted-foreground" />;
  }
}

function ServiceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    operational: "bg-status-online/15 text-status-online",
    degraded: "bg-status-away/15 text-status-away",
    outage: "bg-status-busy/15 text-status-busy",
    maintenance: "bg-status-offline/20 text-muted-foreground",
  };
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${styles[status] || "bg-muted text-muted-foreground"}`}>{status}</span>;
}

export default function ServiceDetail() {
  const params = useParams<{ id: string }>();

  const { data: services, isLoading: servicesLoading, isError: servicesError, error: servicesErrorObj, refetch: refetchServices, isFetching: servicesFetching } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });
  const { data: allAlerts, isLoading: alertsLoading, isError: alertsIsError, error: alertsErrorObj, refetch: refetchAlerts, isFetching: alertsFetching } = useQuery<ServiceAlertWithServices[]>({
    queryKey: ["/api/alerts"],
  });

  const service = services?.find((s) => s.id === params.id);
  const alerts = allAlerts?.filter((a) => a.serviceIds?.includes(params.id)) || [];
  const activeAlerts = alerts.filter((a) => a.status !== "resolved");
  const resolvedAlerts = alerts.filter((a) => a.status === "resolved");
  const isLoading = servicesLoading || alertsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (servicesError || alertsIsError) {
    return (
      <div className="space-y-4">
        <Link href="/services">
          <Button variant="ghost" size="sm" data-testid="button-back-services">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Services
          </Button>
        </Link>
        <QueryErrorState
          error={servicesError ? servicesErrorObj : alertsErrorObj}
          onRetry={() => {
            if (servicesError) refetchServices();
            if (alertsIsError) refetchAlerts();
          }}
          isRetrying={servicesFetching || alertsFetching}
          resourceName="this service"
          data-testid="error-service-detail"
        />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="space-y-4">
        <Link href="/services">
          <Button variant="ghost" size="sm" data-testid="button-back-services">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Services
          </Button>
        </Link>
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="py-12 text-center">
            <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">Service not found</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/services">
        <Button variant="ghost" size="sm" data-testid="button-back-services">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Services
        </Button>
      </Link>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="card-service-detail">
        <div className="flex items-start gap-4 p-5">
          <div className="mt-1 shrink-0">
            <ServiceStatusIcon status={service.status} />
          </div>
          <div className="flex-1 min-w-0 space-y-2.5">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold" data-testid="text-service-name">{service.name}</h1>
              <ServiceStatusBadge status={service.status} />
            </div>
            {service.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-service-description">{service.description}</p>
            )}
            {service.category && (
              <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground" data-testid="text-service-category">
                {service.category}
              </span>
            )}
          </div>
        </div>
      </section>

      <UptimeBlock serviceId={service.id} />

      <div>
        <h2 className="text-lg font-semibold mb-3" data-testid="text-service-alerts-heading">Service Alerts</h2>
        <Tabs defaultValue="active">
          <TabsList>
            <TabsTrigger value="active" data-testid="tab-service-active-alerts">
              Active ({activeAlerts.length})
            </TabsTrigger>
            <TabsTrigger value="resolved" data-testid="tab-service-resolved-alerts">
              Resolved ({resolvedAlerts.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="active" className="mt-4">
            <section className="rounded-xl border border-card-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-3">
                  <SectionIcon icon={AlertTriangle} tone="bg-status-away/10 text-status-away" />
                  Active incidents
                </h2>
              </div>
              {activeAlerts.length === 0 ? (
                <div className="px-5 py-12 text-center">
                  <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-status-online animate-status-glow" />
                  <p className="font-medium">All Clear</p>
                  <p className="text-sm text-muted-foreground mt-1">No active incidents for this service</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {activeAlerts.map((alert) => {
                    const meta = severityMeta[alert.severity] || severityMeta.info;
                    return (
                      <li key={alert.id}>
                        <Link href={`/alerts/${alert.id}`} className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive" data-testid={`card-service-alert-${alert.id}`}>
                          <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 animate-status-pulse ${meta.pill.split(" ")[0].replace("/15", "")}`} />
                          <div className="flex-1 min-w-0 space-y-1.5">
                            <h3 className="font-semibold text-sm">{alert.title}</h3>
                            <p className="text-xs text-muted-foreground line-clamp-1">{stripHtml(alert.description)}</p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.pill}`}>{alertSeverityLabel(alert.severity)}</span>
                              <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[alert.status] || "bg-muted text-muted-foreground"}`}>{alertStatusLabel(alert.status)}</span>
                            </div>
                            <p className="text-xs text-muted-foreground flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                            </p>
                          </div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </TabsContent>

          <TabsContent value="resolved" className="mt-4">
            <section className="rounded-xl border border-card-border bg-card overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-3">
                  <SectionIcon icon={CheckCircle2} tone="bg-status-online/10 text-status-online" />
                  Resolved incidents
                </h2>
              </div>
              {resolvedAlerts.length === 0 ? (
                <div className="px-5 py-10 text-center">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">No resolved incidents for this service</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {resolvedAlerts.map((alert) => (
                    <li key={alert.id}>
                      <Link href={`/alerts/${alert.id}`} className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive opacity-80" data-testid={`card-service-alert-resolved-${alert.id}`}>
                        <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-status-online shrink-0" />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <h3 className="font-semibold text-sm">{alert.title}</h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="rounded-full px-2.5 py-0.5 text-xs font-medium capitalize bg-status-online/15 text-status-online">resolved</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Resolved {alert.resolvedAt ? formatDistanceToNow(new Date(alert.resolvedAt), { addSuffix: true }) : ""}
                          </p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
