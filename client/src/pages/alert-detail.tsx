import { useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAnalyticsView } from "@/hooks/use-analytics-view";
import { useParams, useSearch, Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowDown, ArrowLeft, AlertTriangle, CheckCircle, Clock, Info, Activity } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import { RichTextContent } from "@/components/rich-text-content";
import { QueryErrorState } from "@/components/query-error-state";
import { TimeoutError } from "@/lib/queryClient";
import type { ServiceAlertWithServices, AlertUpdate, Service } from "@shared/schema";
import { alertStatusLabel, alertSeverityLabel, alertSeverityMeta } from "@/lib/status-meta";

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

function LatestPill() {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-status-online/15 px-2.5 py-0.5 text-xs font-semibold text-status-online" data-testid="badge-alert-latest">
      Latest
    </span>
  );
}

export default function AlertDetail() {
  const params = useParams<{ id: string }>();
  const search = useSearch();
  const latestUpdateRef = useRef<HTMLLIElement>(null);
  const handledJumpRef = useRef<string | null>(null);

  const { data: alert, isLoading, isError, error, refetch, isFetching } = useQuery<ServiceAlertWithServices>({
    queryKey: ["/api/alerts", params.id],
  });
  useAnalyticsView("service_alert_viewed", !isError ? alert?.id : undefined);

  const { data: updates, isLoading: updatesLoading, isSuccess: updatesLoaded, isError: updatesFailed, error: updatesError, refetch: refetchUpdates, isFetching: updatesFetching } = useQuery<AlertUpdate[]>({
    queryKey: ["/api/alerts", params.id, "updates"],
  });

  const latestUpdate = updates?.reduce<AlertUpdate | undefined>(
    (latest, update) => !latest || new Date(update.createdAt).getTime() > new Date(latest.createdAt).getTime()
      ? update
      : latest,
    undefined,
  );

  const viewLatestUpdate = useCallback(() => {
    const target = latestUpdateRef.current;
    if (!target?.isConnected) return;

    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      block: "start",
      inline: "nearest",
    });
  }, []);

  // Dashboard links opt in explicitly. Wait for data and the real DOM target,
  // then let the app's route scroll restoration settle before taking focus.
  // Consume once per navigation, not once per update, so background refreshes
  // never pull someone away from the history they are reading.
  const jumpRequest = new URLSearchParams(search).get("latest") === "1";
  const jumpKey = `${params.id ?? ""}?${search}`;
  useEffect(() => {
    if (!jumpRequest) {
      handledJumpRef.current = null;
      return;
    }
    if (isLoading || isError || !alert || !updatesLoaded || !latestUpdate || handledJumpRef.current === jumpKey) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        if (!latestUpdateRef.current?.isConnected) return;
        handledJumpRef.current = jumpKey;
        viewLatestUpdate();
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpRequest, jumpKey, isLoading, isError, alert, updatesLoaded, latestUpdate, viewLatestUpdate]);

  const { data: services } = useQuery<Service[]>({
    queryKey: ["/api/services"],
  });

  const alertServiceNames = (alert?.serviceIds || [])
    .map((sid) => services?.find((s) => s.id === sid)?.name)
    .filter((n): n is string => Boolean(n));

  if (isLoading) {
    return (
      <div className="sh-page space-y-6">
        <Skeleton className="h-8 w-48" />
        <section className="sh-panel rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="p-5 space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-20" />
          </div>
        </section>
        <section className="sh-panel rounded-xl border border-card-border bg-card overflow-hidden">
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
        <div className="sh-page space-y-4">
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
      <div className="sh-page text-center py-12">
        <AlertTriangle className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Alert not found</p>
        <Link href="/alerts">
          <Button variant="ghost" className="mt-2">Back to Alerts</Button>
        </Link>
      </div>
    );
  }

  const severityPillCls = alertSeverityMeta(alert.severity).pill;

  return (
    <div className="sh-page space-y-6">
      <Link href="/alerts">
        <Button variant="ghost" size="sm" data-testid="button-back-alerts">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Alerts
        </Button>
      </Link>

      <section className="sh-panel rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="px-4 py-3 border-b border-border bg-card/50">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1.5">
              <h1 className="sh-page-title text-xl font-bold" data-testid="text-alert-title">{alert.title}</h1>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${severityPillCls}`}>
                  {alertSeverityLabel(alert.severity)}
                </span>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[alert.status] || "bg-muted text-muted-foreground"}`} data-testid="badge-alert-status">
                  {alertStatusLabel(alert.status)}
                </span>
                {updatesLoaded && updates?.length === 0 && <LatestPill />}
                {alertServiceNames.map((name, i) => (
                  <span key={i} className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground" data-testid={`badge-alert-service-${i}`}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
            {updatesLoaded && latestUpdate && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11 sm:min-h-8 text-primary"
                onClick={viewLatestUpdate}
                data-testid="button-view-latest-update"
              >
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
                View latest update
              </Button>
            )}
          </div>
        </div>
        <div className="px-4 py-4 space-y-4">
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

      <section className="sh-panel rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="sh-section-head flex items-center justify-between px-5 py-4 border-b border-border">
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
        ) : updatesFailed ? (
          <QueryErrorState
            error={updatesError}
            onRetry={() => void refetchUpdates()}
            isRetrying={updatesFetching}
            resourceName="alert updates"
            data-testid="error-alert-updates"
          />
        ) : !updates || updates.length === 0 ? (
          <div className="px-5 py-8 text-center">
            <Clock className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No updates posted yet</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {updates.map((update) => (
              <li
                key={update.id}
                ref={update.id === latestUpdate?.id ? latestUpdateRef : undefined}
                tabIndex={-1}
                className="px-4 py-4 flex gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                // The app header sits outside the scroll container. Leave a
                // top gap there and clearance for the fixed phone navigation.
                style={{
                  scrollMarginTop: "1rem",
                  scrollMarginBottom: "calc(4.5rem + var(--sab, env(safe-area-inset-bottom, 0px)))",
                }}
                data-testid={`alert-update-${update.id}`}
              >
                <div className="mt-0.5 shrink-0">
                  <StatusIcon status={update.status} />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[update.status] || "bg-muted text-muted-foreground"}`} data-testid={`badge-alert-update-status-${update.id}`}>
                      {alertStatusLabel(update.status)}
                    </span>
                    {update.id === latestUpdate?.id && <LatestPill />}
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
