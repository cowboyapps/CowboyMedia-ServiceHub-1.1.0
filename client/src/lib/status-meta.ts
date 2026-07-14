export type ServiceStatusMeta = { label: string; dot: string; pill: string };

export const serviceStatusMeta: Record<string, ServiceStatusMeta> = {
  operational: { label: "Operational", dot: "bg-status-online", pill: "bg-status-online/15 text-status-online" },
  degraded: { label: "Degraded", dot: "bg-status-away", pill: "bg-status-away/15 text-status-away" },
  outage: { label: "Outage", dot: "bg-status-busy", pill: "bg-status-busy/15 text-status-busy" },
  maintenance: { label: "Maintenance", dot: "bg-status-offline", pill: "bg-status-offline/20 text-muted-foreground" },
};

export function serviceStatusDot(status: string): string {
  return (serviceStatusMeta[status] ?? { dot: "bg-muted" }).dot;
}

export type SeverityMeta = { dot: string; pill: string; icon: string };

export const severityMeta: Record<string, SeverityMeta> = {
  critical: { dot: "bg-status-busy", pill: "bg-status-busy/15 text-status-busy", icon: "text-status-busy" },
  warning: { dot: "bg-status-away", pill: "bg-status-away/15 text-status-away", icon: "text-status-away" },
  info: { dot: "bg-primary", pill: "bg-primary/15 text-primary", icon: "text-primary" },
};

// Neutral styling for severities outside the known set (legacy rows may
// carry arbitrary strings like "sev_1"). Unknown severities must NOT fall
// back to the info (blue/primary) pill — that understates urgency by making
// them look like low-priority notices. They render muted/neutral instead.
export const unknownSeverityMeta: SeverityMeta = {
  dot: "bg-muted-foreground/60",
  pill: "bg-muted text-muted-foreground",
  icon: "text-muted-foreground",
};

// Severity alias normalization + labels live in shared/severity.ts so the
// server-side formatters (Discord/Telegram) show the same canonical wording.
// Re-exported here so existing client imports keep working.
export { severityAliases, normalizeAlertSeverity, alertSeverityLabels, alertSeverityLabel } from "@shared/severity";
import { normalizeAlertSeverity } from "@shared/severity";

export function alertSeverityMeta(severity: string | null | undefined): SeverityMeta {
  const raw = (severity ?? "").trim();
  if (!raw) return severityMeta.info;
  const canonical = normalizeAlertSeverity(raw);
  return canonical ? severityMeta[canonical] : unknownSeverityMeta;
}

export const incidentStatusPill: Record<string, string> = {
  investigating: "bg-status-away/15 text-status-away",
  identified: "bg-status-away/15 text-status-away",
  monitoring: "bg-primary/15 text-primary",
  resolved: "bg-status-online/15 text-status-online",
};

// Known alert/incident lifecycle labels. Legacy rows written before the
// server-side status whitelist may carry arbitrary strings; alertStatusLabel
// falls back to a readable Title Case of the raw value (never blank).
export const alertStatusLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export function alertStatusLabel(status: string | null | undefined): string {
  const raw = (status ?? "").trim();
  if (!raw) return "Update";
  const known = alertStatusLabels[raw.toLowerCase()];
  if (known) return known;
  return raw
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export const ticketStatusPill: Record<string, string> = {
  open: "bg-status-online/15 text-status-online",
  waiting: "bg-status-away/15 text-status-away",
  resolved: "bg-muted text-muted-foreground",
  closed: "bg-muted text-muted-foreground",
};
