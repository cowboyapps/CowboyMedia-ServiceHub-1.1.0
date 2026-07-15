import { EmptyState } from "@/components/empty-state";
import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { QueryErrorState } from "@/components/query-error-state";
import type { Service } from "@shared/schema";
import { Activity, CheckCircle2, ChevronRight } from "lucide-react";
import { Link } from "wouter";

const statusMeta: Record<string, { label: string; dot: string; pill: string }> = {
  operational: { label: "Operational", dot: "bg-status-online", pill: "bg-status-online/15 text-status-online" },
  degraded: { label: "Degraded", dot: "bg-status-away", pill: "bg-status-away/15 text-status-away" },
  outage: { label: "Outage", dot: "bg-status-busy", pill: "bg-status-busy/15 text-status-busy" },
  maintenance: { label: "Maintenance", dot: "bg-status-offline", pill: "bg-status-offline/20 text-muted-foreground" },
};

function SectionIcon({ icon: Icon, tone }: { icon: typeof Activity; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowSkeletons({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-2.5 w-2.5 rounded-full" />
          <Skeleton className="h-4 flex-1 max-w-48" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function ServicesPage() {
  const { data: services, isLoading, isError, error, refetch, isFetching } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const markServicesRead = useCallback(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "services" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    markServicesRead();
  }, [markServicesRead]);

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === "visible") markServicesRead();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [markServicesRead]);

  const operationalCount = services?.filter((s) => s.status === "operational").length || 0;
  const totalCount = services?.length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-services-title">Service Status</h1>
          <p className="text-sm text-muted-foreground mt-1">Current status of all available services</p>
        </div>
        {!isLoading && (
          <Badge variant="secondary" className="text-sm" data-testid="text-operational-count">
            {operationalCount}/{totalCount} Operational
          </Badge>
        )}
      </div>

      {isError ? (
        <QueryErrorState
          error={error}
          onRetry={() => refetch()}
          isRetrying={isFetching}
          resourceName="services"
          data-testid="error-services"
        />
      ) : !isLoading && (!services || services.length === 0) ? (
        <Card>
          <CardContent className="py-4">
            <EmptyState icon={Activity} title="No services available yet" hint="Services will appear here once they're added." />
          </CardContent>
        </Card>
      ) : (
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-sm font-semibold flex items-center gap-3">
              <SectionIcon icon={CheckCircle2} tone="bg-status-online/10 text-status-online" />
              Services
            </h2>
            <span className="text-xs text-muted-foreground hidden sm:inline">Click a service for alerts &amp; history</span>
          </div>
          {isLoading ? (
            <RowSkeletons />
          ) : (
            <ul className="divide-y divide-border">
              {services!.map((service) => {
                const meta = statusMeta[service.status] || statusMeta.maintenance;
                return (
                  <li key={service.id}>
                    <Link
                      href={`/services/${service.id}`}
                      className="stagger-item flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                      data-testid={`card-service-${service.id}`}
                    >
                      <span
                        className={`mt-1.5 h-2.5 w-2.5 rounded-full ${meta.dot} shrink-0 ${service.status !== "operational" ? "animate-status-pulse" : ""}`}
                      />
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{service.name}</span>
                          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.pill}`}>{meta.label}</span>
                        </div>
                        {service.description && (
                          <p className="text-xs text-muted-foreground line-clamp-2">{service.description}</p>
                        )}
                        {service.category && (
                          <Badge variant="secondary" className="text-xs mt-1">{service.category}</Badge>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
