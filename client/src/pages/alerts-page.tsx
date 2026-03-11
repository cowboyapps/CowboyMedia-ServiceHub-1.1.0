import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import { format } from "date-fns";
import { AlertTriangle, CheckCircle, Clock, ChevronRight } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ServiceAlert, Service } from "@shared/schema";

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    critical: "destructive",
    warning: "default",
    info: "secondary",
  };
  return <Badge variant={variants[severity] || "secondary"} className="text-xs capitalize">{severity}</Badge>;
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    investigating: "bg-status-away text-black",
    identified: "bg-status-away text-black",
    monitoring: "bg-primary text-primary-foreground",
    resolved: "bg-status-online text-white",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium capitalize ${colors[status] || "bg-muted text-muted-foreground"}`}>
      {status}
    </span>
  );
}

export default function AlertsPage() {
  const { data: alerts, isLoading: alertsLoading } = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
  });
  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  useEffect(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "alerts" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] }))
      .catch(() => {});
  }, []);

  const serviceMap = new Map(services?.map((s) => [s.id, s.name]) || []);
  const activeAlerts = alerts?.filter((a) => a.status !== "resolved") || [];
  const resolvedAlerts = alerts?.filter((a) => a.status === "resolved") || [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-alerts-title">Service Alerts</h1>
        <p className="text-sm text-muted-foreground mt-1">Track incidents and service disruptions</p>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active" data-testid="tab-active-alerts">
            Active ({activeAlerts.length})
          </TabsTrigger>
          <TabsTrigger value="resolved" data-testid="tab-resolved-alerts">
            Resolved ({resolvedAlerts.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4 space-y-3">
          {alertsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="border rounded-lg p-4 flex items-start gap-3">
                <Skeleton className="w-5 h-5 rounded flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-5 w-20 rounded-full" />
                  </div>
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="w-4 h-4 flex-shrink-0 self-center" />
              </div>
            ))
          ) : activeAlerts.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle className="w-10 h-10 mx-auto mb-3 text-status-online" />
                <p className="font-medium">All Clear</p>
                <p className="text-sm text-muted-foreground mt-1">No active incidents at this time</p>
              </CardContent>
            </Card>
          ) : (
            activeAlerts.map((alert) => (
              <Link key={alert.id} href={`/alerts/${alert.id}`}>
                <Card className="hover-elevate cursor-pointer" data-testid={`card-alert-${alert.id}`}>
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-status-away flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h3 className="font-semibold text-sm">{alert.title}</h3>
                        <p className="text-xs text-muted-foreground line-clamp-1">{alert.description}</p>
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={alert.severity} />
                          <StatusBadge status={alert.status} />
                          {serviceMap.get(alert.serviceId) && (
                            <Badge variant="secondary" className="text-xs">{serviceMap.get(alert.serviceId)}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {format(new Date(alert.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>

        <TabsContent value="resolved" className="mt-4 space-y-3">
          {resolvedAlerts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No resolved alerts</p>
              </CardContent>
            </Card>
          ) : (
            resolvedAlerts.map((alert) => (
              <Link key={alert.id} href={`/alerts/${alert.id}`}>
                <Card className="hover-elevate cursor-pointer opacity-80" data-testid={`card-alert-resolved-${alert.id}`}>
                  <CardContent className="flex items-start justify-between gap-3 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-status-online flex-shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <h3 className="font-semibold text-sm">{alert.title}</h3>
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusBadge status="resolved" />
                          {serviceMap.get(alert.serviceId) && (
                            <Badge variant="secondary" className="text-xs">{serviceMap.get(alert.serviceId)}</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Resolved {alert.resolvedAt ? format(new Date(alert.resolvedAt), "MMM d, yyyy") : ""}
                        </p>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
