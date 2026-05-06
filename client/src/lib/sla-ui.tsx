import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle, CheckCircle2, Clock } from "lucide-react";

export type SlaState = "met" | "breached" | "approaching" | "on_track" | "none";

export type SlaMetric = {
  state: SlaState;
  targetMinutes: number | null;
  elapsedMinutes: number;
  remainingMinutes: number | null;
  dueAt: string | null;
  completedAt: string | null;
};

export type TicketSla = {
  firstResponse: SlaMetric;
  resolution: SlaMetric;
  worstState: SlaState;
};

export const SLA_RANK: Record<SlaState, number> = { breached: 4, approaching: 3, on_track: 2, met: 1, none: 0 };

export function formatDuration(minutes: number): string {
  const abs = Math.abs(minutes);
  if (abs < 1) return "< 1m";
  if (abs < 60) return `${Math.round(abs)}m`;
  const hours = abs / 60;
  if (hours < 24) {
    const h = Math.floor(hours);
    const m = Math.round(abs - h * 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const days = Math.floor(hours / 24);
  const remH = Math.round(hours - days * 24);
  return remH > 0 ? `${days}d ${remH}h` : `${days}d`;
}

export function slaStateLabel(state: SlaState): string {
  switch (state) {
    case "breached": return "Breached";
    case "approaching": return "At risk";
    case "on_track": return "On track";
    case "met": return "Met";
    default: return "No SLA";
  }
}

function activeMetric(sla: TicketSla, ticketStatus: string): SlaMetric | null {
  if (ticketStatus === "closed") {
    if (sla.resolution.state !== "none") return sla.resolution;
    if (sla.firstResponse.state !== "none") return sla.firstResponse;
    return null;
  }
  // Open: prefer first-response if not yet met; otherwise resolution.
  if (sla.firstResponse.state !== "none" && !sla.firstResponse.completedAt) return sla.firstResponse;
  if (sla.resolution.state !== "none") return sla.resolution;
  if (sla.firstResponse.state !== "none") return sla.firstResponse;
  return null;
}

export function SlaPill({ sla, status, compact = false, testId }: { sla: TicketSla | null | undefined; status: string; compact?: boolean; testId?: string }) {
  if (!sla) return null;
  const metric = activeMetric(sla, status);
  if (!metric || metric.state === "none") return null;

  const state = metric.state;
  const isClosed = status === "closed";
  const Icon = state === "breached"
    ? AlertCircle
    : state === "approaching"
      ? AlertTriangle
      : state === "met"
        ? CheckCircle2
        : Clock;

  // Color spec: red=breached, amber=approaching, green=on_track, grey=met.
  const classes = state === "breached"
    ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/40 text-red-800 dark:text-red-200"
    : state === "approaching"
      ? "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200"
      : state === "on_track"
        ? "border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-200"
        : "border-muted-foreground/30 bg-muted text-muted-foreground";

  const metricLabel = metric === sla.firstResponse ? "First reply" : "Resolution";
  const remaining = metric.remainingMinutes;

  let suffix = "";
  if (isClosed || metric.completedAt) {
    suffix = state === "met" ? "met" : "breached";
  } else if (remaining === null) {
    suffix = slaStateLabel(state);
  } else if (remaining < 0) {
    suffix = `${formatDuration(-remaining)} over`;
  } else {
    suffix = `${formatDuration(remaining)} left`;
  }

  const label = compact ? suffix : `${metricLabel}: ${suffix}`;
  const title = `${metricLabel} SLA — ${slaStateLabel(state)}${metric.targetMinutes ? ` · target ${formatDuration(metric.targetMinutes)}` : ""}${metric.dueAt ? ` · due ${new Date(metric.dueAt).toLocaleString()}` : ""}`;

  return (
    <Badge variant="outline" className={`text-xs gap-1 ${classes}`} title={title} data-testid={testId || "sla-pill"}>
      <Icon className="w-3 h-3" />
      {label}
    </Badge>
  );
}
