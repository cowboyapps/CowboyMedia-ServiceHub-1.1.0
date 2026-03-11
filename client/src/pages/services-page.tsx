import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Service } from "@shared/schema";
import { Activity, CheckCircle, AlertTriangle, XCircle, Wrench, ChevronRight } from "lucide-react";
import { Link } from "wouter";

function StatusIcon({ status }: { status: string }) {
  const isActive = status !== "operational";
  const pulseClass = isActive ? "animate-status-pulse" : "";
  switch (status) {
    case "operational":
      return <CheckCircle className="w-5 h-5 text-status-online" />;
    case "degraded":
      return <AlertTriangle className={`w-5 h-5 text-status-away ${pulseClass}`} />;
    case "outage":
      return <XCircle className={`w-5 h-5 text-status-busy ${pulseClass}`} />;
    case "maintenance":
      return <Wrench className={`w-5 h-5 text-status-offline ${pulseClass}`} />;
    default:
      return <Activity className="w-5 h-5 text-muted-foreground" />;
  }
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    operational: "secondary",
    degraded: "default",
    outage: "destructive",
    maintenance: "secondary",
  };
  return <Badge variant={variants[status] || "secondary"} className="capitalize text-xs">{status}</Badge>;
}

export default function ServicesPage() {
  const { data: services, isLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  useEffect(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "services" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] }))
      .catch(() => {});
  }, []);

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

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4 flex items-start gap-3">
              <Skeleton className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-5 w-20 rounded-full" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : !services || services.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Activity className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No services available yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {services.map((service) => (
            <Link key={service.id} href={`/services/${service.id}`}>
              <Card className="hover-elevate tap-interactive cursor-pointer" data-testid={`card-service-${service.id}`}>
                <CardContent className="flex items-start gap-3 p-4">
                  <div className="mt-0.5">
                    <StatusIcon status={service.status} />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm">{service.name}</h3>
                      <StatusBadge status={service.status} />
                    </div>
                    {service.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{service.description}</p>
                    )}
                    {service.category && (
                      <Badge variant="secondary" className="text-xs mt-1">{service.category}</Badge>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
