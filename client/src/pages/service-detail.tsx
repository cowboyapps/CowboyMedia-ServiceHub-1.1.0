import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { ArrowLeft, Activity, CheckCircle, AlertTriangle, XCircle, Wrench, Clock, ChevronRight } from "lucide-react";
import type { Service, ServiceAlert } from "@shared/schema";

function ServiceStatusIcon({ status }: { status: string }) {
  switch (status) {
    case "operational":
      return <CheckCircle className="w-6 h-6 text-status-online" />;
    case "degraded":
      return <AlertTriangle className="w-6 h-6 text-status-away" />;
    case "outage":
      return <XCircle className="w-6 h-6 text-status-busy" />;
    case "maintenance":
      return <Wrench className="w-6 h-6 text-status-offline" />;
    default:
      return <Activity className="w-6 h-6 text-muted-foreground" />;
  }
}

function ServiceStatusBadge({ status }: { status: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    operational: "secondary",
    degraded: "default",
    outage: "destructive",
    maintenance: "secondary",
  };
  return <Badge variant={variants[status] || "secondary"} className="capitalize text-xs">{status}</Badge>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const variants: Record<string, "default" | "secondary" | "destructive"> = {
    critical: "destructive",
    warning: "default",
    info: "secondary",
  };
  return <Badge variant={variants[severity] || "secondary"} className="text-xs capitalize">{severity}</Badge>;
}

function AlertStatusBadge({ status }: { status: string }) {
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

export default function ServiceDetail() {
  const params = useParams<{ id: string }>();

  const { data: services, isLoading: servicesLoading } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });
  const { data: allAlerts, isLoading: alertsLoading } = useQuery<ServiceAlert[]>({
    queryKey: ["/api/alerts"],
  });

  const service = services?.find((s) => s.id === params.id);
  const alerts = allAlerts?.filter((a) => a.serviceId === params.id) || [];
  const activeAlerts = alerts.filter((a) => a.status !== "resolved");
  const resolvedAlerts = alerts.filter((a) => a.status === "resolved");
  const isLoading = servicesLoading || alertsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32" />
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
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
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Service not found</p>
          </CardContent>
        </Card>
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

      <Card data-testid="card-service-detail">
        <CardContent className="flex items-start gap-4 p-5">
          <div className="mt-0.5">
            <ServiceStatusIcon status={service.status} />
          </div>
          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold" data-testid="text-service-name">{service.name}</h1>
              <ServiceStatusBadge status={service.status} />
            </div>
            {service.description && (
              <p className="text-sm text-muted-foreground" data-testid="text-service-description">{service.description}</p>
            )}
            {service.category && (
              <Badge variant="secondary" className="text-xs" data-testid="text-service-category">{service.category}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

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

          <TabsContent value="active" className="mt-4 space-y-3">
            {activeAlerts.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center">
                  <CheckCircle className="w-10 h-10 mx-auto mb-3 text-status-online" />
                  <p className="font-medium">All Clear</p>
                  <p className="text-sm text-muted-foreground mt-1">No active incidents for this service</p>
                </CardContent>
              </Card>
            ) : (
              activeAlerts.map((alert) => (
                <Link key={alert.id} href={`/alerts/${alert.id}`}>
                  <Card className="hover-elevate cursor-pointer" data-testid={`card-service-alert-${alert.id}`}>
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <AlertTriangle className="w-5 h-5 text-status-away flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h3 className="font-semibold text-sm">{alert.title}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-1">{alert.description}</p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <SeverityBadge severity={alert.severity} />
                            <AlertStatusBadge status={alert.status} />
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
                  <p className="text-sm text-muted-foreground">No resolved alerts for this service</p>
                </CardContent>
              </Card>
            ) : (
              resolvedAlerts.map((alert) => (
                <Link key={alert.id} href={`/alerts/${alert.id}`}>
                  <Card className="hover-elevate cursor-pointer opacity-80" data-testid={`card-service-alert-resolved-${alert.id}`}>
                    <CardContent className="flex items-start justify-between gap-3 p-4">
                      <div className="flex items-start gap-3">
                        <CheckCircle className="w-5 h-5 text-status-online flex-shrink-0 mt-0.5" />
                        <div className="space-y-1">
                          <h3 className="font-semibold text-sm">{alert.title}</h3>
                          <div className="flex items-center gap-2 flex-wrap">
                            <AlertStatusBadge status="resolved" />
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
    </div>
  );
}
