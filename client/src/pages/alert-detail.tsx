import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Info, Activity } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import { RichTextContent } from "@/components/rich-text-content";
import { QueryErrorState } from "@/components/query-error-state";
import { TimeoutError } from "@/lib/queryClient";
import type { ServiceAlertWithServices, AlertUpdate, Service } from "@shared/schema";
import { alertStatusLabel } from "@/lib/status-meta";

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

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "resolved":
      return <CheckCircle className="w-5 h-5 text-status-online animate-status-glow" />;
    case "investigating":
      return <AlertTriangle className="w-5 h-5 text-status-away" />;
    case "identified":
      return <Info className="w-5 h-5 text-primary" />;
    default:
      return <Clock className="w-5 h-5 text-muted-foreground" />;
  }
}

export default function AlertDetail() {
  const params = useParams<{ id: string }>();

  const { data: alert, isLoading, isError, error, refetch, isFetching } = useQuery<ServiceAlertWithServices>({
    queryKey: ["/api/alerts", params.id],
  });

  const { data: updates, isLoading: updatesLoading } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", params.id, "updates"],
  });

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const alertServiceNames = (alert?.serviceIds || [])
    .map((sid) => services?.find((s) => s.id === sid)?.name)
    .filter((n): n is string => Boolean(n));

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="p-5 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20" />
          </div>
        </section>
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <Skeleton className="h-5 w-40" />
          </div>
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  if (isError) {
    const isNotFound =
      !(error instanceof TimeoutError) && /^(4\d\d):/.test((error as Error)?.message ?? "");
    if (!isNotFound) {
      return (
        <div className="space-y-4">
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
            resourceName="this alert"
            data-testid="error-alert-detail"
          />
          <div className="text-center">
            <Link href="/alerts">
              <Button variant="ghost">Back to Alerts</Button>
            </Link>
          </div>
        </div>
      );
    }
  }

  if (!alert) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Alert not found</p>
        <Link href="/alerts">
          <Button variant="ghost" className="mt-2">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  const severityPillCls = severityMeta[alert.severity]?.pill || severityMeta.info.pill;

  return (
    <div className="space-y-6">
      <Link href="/alerts">
        <Button variant="ghost" size="sm" data-testid="button-back-alerts">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Alerts
        </Button>
      </Link>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border bg-card/50">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold" data-testid="text-alert-title">{alert.title}</h1>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${severityPillCls}`}>
                  {alert.severity}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[alert.status] || "bg-muted text-muted-foreground"}`} data-testid="badge-alert-status">
                  {alertStatusLabel(alert.status)}
                </span>
                {alertServiceNames.map((name, i) => (
                  <span key={i} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground" data-testid={`badge-alert-service-${i}`}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <RichTextContent content={alert.description} className="text-sm" testId="text-alert-description" />
          {alert.imageUrl && (
            <ClickableImage src={alert.imageUrl} alt="Alert attachment" className="max-h-48 rounded-md" />
          )}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap pt-2">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              Created {format(new Date(alert.createdAt), "MMM d, yyyy 'at' h:mm a")}
            </span>
            {alert.resolvedAt && (
              <span className="flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Resolved {format(new Date(alert.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
              </span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={Activity} tone="bg-primary/10 text-primary" />
            Updates Timeline
          </h2>
        </div>
        
        {updatesLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="px-5 py-3.5 space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full max-w-lg" />
              </div>
            ))}
          </div>
        ) : !updates || updates.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No updates posted yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {updates.map((update) => (
              <li key={update.id} className="px-5 py-4 flex gap-4" data-testid={`alert-update-${update.id}`}>
                <div className="mt-0.5 shrink-0">
                  <StatusIcon status={update.status} />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[update.status] || "bg-muted text-muted-foreground"}`} data-testid={`badge-alert-update-status-${update.id}`}>
                      {alertStatusLabel(update.status)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(update.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  </div>
                  <RichTextContent content={update.message} className="text-sm" testId={`text-alert-update-message-${update.id}`} />
                  {update.imageUrl && (
                    <ClickableImage src={update.imageUrl} alt="Update attachment" className="max-h-32 rounded-md mt-2" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
