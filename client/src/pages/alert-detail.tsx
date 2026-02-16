import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Info } from "lucide-react";
import type { ServiceAlert, AlertUpdate, Service } from "@shared/schema";

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "resolved":
      return <CheckCircle className="w-4 h-4 text-status-online" />;
    case "investigating":
      return <AlertTriangle className="w-4 h-4 text-status-away" />;
    case "identified":
      return <Info className="w-4 h-4 text-primary" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

export default function AlertDetail() {
  const params = useParams<{ id: string }>();

  const { data: alert, isLoading } = useQuery<ServiceAlert>({
    queryKey: ["/api/alerts", params.id],
  });

  const { data: updates, isLoading: updatesLoading } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", params.id, "updates"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const serviceName = services?.find((s) => s.id === alert?.serviceId)?.name;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!alert) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Alert not found</p>
        <Link href="/alerts">
          <Button variant="ghost" className="mt-2">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link href="/alerts">
        <Button variant="ghost" size="sm" data-testid="button-back-alerts">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Alerts
        </Button>
      </Link>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-xl" data-testid="text-alert-title">{alert.title}</CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge
                  variant={alert.severity === "critical" ? "destructive" : alert.severity === "warning" ? "default" : "secondary"}
                  className="text-xs capitalize"
                >
                  {alert.severity}
                </Badge>
                <Badge variant={alert.status === "resolved" ? "secondary" : "default"} className="text-xs capitalize">
                  {alert.status}
                </Badge>
                {serviceName && <Badge variant="secondary" className="text-xs">{serviceName}</Badge>}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm" data-testid="text-alert-description">{alert.description}</p>
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Created: {format(new Date(alert.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </span>
            {alert.resolvedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                Resolved: {format(new Date(alert.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Updates Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          {updatesLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
            </div>
          ) : !updates || updates.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No updates posted yet</p>
          ) : (
            <div className="relative space-y-0">
              <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
              {updates.map((update, i) => (
                <div key={update.id} className="relative pl-7 pb-6 last:pb-0" data-testid={`alert-update-${update.id}`}>
                  <div className="absolute left-0 top-1 z-10 bg-background p-0.5 rounded-full">
                    <StatusIcon status={update.status} />
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs capitalize">{update.status}</Badge>
                      <span className="text-xs text-muted-foreground">
                        {format(new Date(update.createdAt), "MMM d, h:mm a")}
                      </span>
                    </div>
                    <p className="text-sm">{update.message}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
