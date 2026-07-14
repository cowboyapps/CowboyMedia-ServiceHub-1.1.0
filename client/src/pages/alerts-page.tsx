import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, ChevronRight, Bell } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { stripHtml } from "@/components/rich-text-editor";
import { QueryErrorState } from "@/components/query-error-state";
import type { ServiceAlertWithServices, Service } from "@shared/schema";

import { severityMeta, incidentStatusPill as statusPill, alertStatusLabel } from "@/lib/status-meta";

function SectionIcon({ icon: Icon, tone }: { icon: typeof Bell; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function SeverityPill({ severity }: { severity: string }) {
  const meta = severityMeta[severity] || severityMeta.info;
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${meta.pill}`}>
      {severity}
    </span>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[status] || "bg-muted text-muted-foreground"}`} data-testid="badge-alert-status-pill">
      {alertStatusLabel(status)}
    </span>
  );
}

function ServicePill({ name }: { name: string }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
      {name}
    </span>
  );
}

function RowSkeletons({ rows = 3 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function AlertsPage() {
  const { data: alerts, isLoading: alertsLoading, isError: alertsError, error: alertsErrorObj, refetch: refetchAlerts, isFetching: alertsFetching } = useQuery<ServiceAlertWithServices[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const markAlertsRead = useCallback(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "alerts" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    markAlertsRead();
  }, [markAlertsRead]);

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === "visible") markAlertsRead();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [markAlertsRead]);

  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const activeAlerts = alerts?.filter((a) => a.status !== "resolved") || [];
  const resolvedAlerts = alerts?.filter((a) => a.status === "resolved") || [];

  return (
    <div className="space-y-6">
      <PageHeader title="Service Alerts" subtitle="Track incidents and service disruptions" testId="text-alerts-title" />

      {alertsError ? (
        <QueryErrorState
          error={alertsErrorObj}
          onRetry={() => refetchAlerts()}
          isRetrying={alertsFetching}
          resourceName="alerts"
          data-testid="error-alerts"
        />
      ) : (
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-alerts">
            Active ({activeAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="resolved" data-testid="tab-resolved-alerts">
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
              {activeAlerts.length > 0 && (
                <span className="rounded-full bg-status-away/15 px-2.5 py-0.5 text-xs font-medium text-status-away">
                  {activeAlerts.length} active
                </span>
              )}
            </div>
            {alertsLoading ? (
              <RowSkeletons />
            ) : activeAlerts.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-status-online animate-status-glow" />
                <p className="font-medium">All Clear</p>
                <p className="text-sm text-muted-foreground mt-1">No active incidents at this time</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {activeAlerts.map((alert) => {
                  const meta = severityMeta[alert.severity] || severityMeta.info;
                  return (
                    <li key={alert.id}>
                      <Link
                        href={`/alerts/${alert.id}`}
                        className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                        data-testid={`card-alert-${alert.id}`}
                      >
                        <span className={`mt-1.5 h-2.5 w-2.5 rounded-full shrink-0 animate-status-pulse ${meta.dot}`} />
                        <div className="flex-1 min-w-0 space-y-1.5">
                          <p className="truncate text-sm font-medium">{alert.title}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{stripHtml(alert.description)}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <SeverityPill severity={alert.severity} />
                            <StatusPill status={alert.status} />
                            {alert.serviceIds?.map((sid) => serviceMap.get(sid) && (
                              <ServicePill key={sid} name={serviceMap.get(sid)!} />
                            ))}
                          </div>
                          <p className="text-xs text-muted-foreground">
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
              <EmptyState icon={CheckCircle2} title="No resolved incidents yet" hint="Resolved incidents will be archived here." />
            ) : (
              <ul className="divide-y divide-border">
                {resolvedAlerts.map((alert) => (
                  <li key={alert.id}>
                    <Link
                      href={`/alerts/${alert.id}`}
                      className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive opacity-80"
                      data-testid={`card-alert-resolved-${alert.id}`}
                    >
                      <span className="mt-1.5 h-2.5 w-2.5 rounded-full bg-status-online shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <p className="truncate text-sm font-medium">{alert.title}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusPill status="resolved" />
                          {alert.serviceIds?.map((sid) => serviceMap.get(sid) && (
                            <ServicePill key={sid} name={serviceMap.get(sid)!} />
                          ))}
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
      )}
    </div>
  );
}
