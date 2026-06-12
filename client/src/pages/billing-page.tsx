import { useQuery } from "@tanstack/react-query";
import { BillingSummaryView, type BillingSummary } from "@/components/billing-summary";
import { WhmcsProfileCard } from "@/components/whmcs-profile-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Server } from "lucide-react";
import type { Service } from "@shared/schema";

interface DerivedServicesPayload {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  services: Service[];
}

function statusLabel(status: string): string {
  switch (status) {
    case "operational": return "Operational";
    case "degraded": return "Degraded";
    case "outage": return "Outage";
    case "maintenance": return "Maintenance";
    default: return status || "—";
  }
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "operational":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "degraded":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "outage":
      return "bg-destructive/15 text-destructive border-destructive/30";
    case "maintenance":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

function MyMonitoredServices() {
  const { data, isLoading } = useQuery<DerivedServicesPayload>({
    queryKey: ["/api/my/whmcs-services"],
  });

  if (isLoading) return <Skeleton className="h-28 rounded-xl" data-testid="my-services-loading" />;
  // Only render when there's something to show — linked with mapped services.
  if (!data || !data.configured || !data.enabled || !data.linked) return null;
  if (data.unreachable || data.services.length === 0) return null;

  return (
    <div data-testid="my-monitored-services">
      <div className="flex items-center gap-2 mb-2">
        <Server className="w-4 h-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold" data-testid="heading-my-services">Monitored services included with your products</h2>
      </div>
      <div className="space-y-2">
        {data.services.map((s) => (
          <Card key={s.id} data-testid={`card-my-service-${s.id}`}>
            <CardContent className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate" data-testid={`text-my-service-name-${s.id}`}>{s.name}</p>
                {s.description && (
                  <p className="text-xs text-muted-foreground truncate">{s.description}</p>
                )}
              </div>
              <Badge variant="outline" className={`shrink-0 ${statusBadgeClass(s.status)}`} data-testid={`badge-my-service-status-${s.id}`}>
                {statusLabel(s.status)}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export default function BillingPage() {
  const { data, isLoading } = useQuery<BillingSummary>({
    queryKey: ["/api/billing"],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-billing-title">Billing</h1>
        <p className="text-sm text-muted-foreground mt-1">Your invoices, services, and account balance</p>
      </div>

      <MyMonitoredServices />

      <BillingSummaryView data={data} isLoading={isLoading} context="customer" />

      <WhmcsProfileCard />
    </div>
  );
}
