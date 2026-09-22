import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink } from "lucide-react";
import type { ServiceAlertWithServices } from "@shared/schema";
import { Button } from "@/components/ui/button";

type AlertSummary = Pick<ServiceAlertWithServices, "id" | "title" | "status" | "serviceIds">;

export function ActiveAlertNoticeContent({
  alerts,
  serviceId,
}: {
  alerts: AlertSummary[];
  serviceId?: string;
}) {
  const relevant = alerts.filter((alert) =>
    alert.status !== "resolved" &&
    (!serviceId || alert.serviceIds.length === 0 || alert.serviceIds.includes(serviceId)),
  );
  if (!relevant.length) return null;

  return (
    <section
      aria-label="Active service alerts"
      className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40"
      data-testid="notice-active-alerts"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium">An active service alert may explain your issue</p>
          <p className="text-xs text-muted-foreground">
            Check the latest update before opening a ticket. You can still submit the form below if you need help.
          </p>
        </div>
      </div>
      <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto">
        {relevant.map((alert) => (
          <li key={alert.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0 flex-1 break-words text-sm">{alert.title}</span>
            <Button asChild size="sm" variant="outline" className="shrink-0">
              <a
                href={`/alerts/${encodeURIComponent(alert.id)}`}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View alert: ${alert.title} (opens in a new tab)`}
                data-testid={`button-ticket-alert-${alert.id}`}
              >
                View alert <ExternalLink className="ml-1.5 h-3 w-3" />
              </a>
            </Button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground">
        Alerts open in a new tab so your ticket form stays here.
      </p>
    </section>
  );
}

export function ActiveAlertNotice({ serviceId }: { serviceId?: string }) {
  const { data, isPending, isError } = useQuery<ServiceAlertWithServices[]>({
    queryKey: ["/api/alerts"],
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchInterval: 30_000,
    retry: 1,
  });

  if (isError) {
    return (
      <p className="mb-3 text-xs text-muted-foreground" role="status">
        We couldn’t refresh service alerts. You can still submit your ticket or{" "}
        <a className="underline" href="/alerts" target="_blank" rel="noopener noreferrer">
          check alerts in a new tab
        </a>.
      </p>
    );
  }
  if (isPending) {
    return <p className="mb-3 text-xs text-muted-foreground" role="status">Checking for active service alerts…</p>;
  }
  return <ActiveAlertNoticeContent alerts={data ?? []} serviceId={serviceId} />;
}