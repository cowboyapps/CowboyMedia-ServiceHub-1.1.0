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

// Legacy severity aliases. Old rows (written before the server-side severity
// whitelist) may carry strings like "sev_1" or "major" that map cleanly onto
// the canonical critical/warning/info levels. Normalizing them here lets both
// the label and the badge styling reflect the real urgency instead of the
// neutral "unknown" fallback. Keys are compared after trim + lowercase with
// separators (_, -, whitespace) collapsed to a single underscore.
export const severityAliases: Record<string, "critical" | "warning" | "info"> = {
  sev_1: "critical",
  sev1: "critical",
  p1: "critical",
  major: "critical",
  severe: "critical",
  urgent: "critical",
  emergency: "critical",
  high: "critical",
  sev_2: "warning",
  sev2: "warning",
  p2: "warning",
  minor: "warning",
  medium: "warning",
  moderate: "warning",
  degraded: "warning",
  sev_3: "info",
  sev3: "info",
  p3: "info",
  low: "info",
  notice: "info",
  informational: "info",
};

// Normalizes a raw severity string to a canonical key (critical/warning/info)
// when it is either already canonical or a known legacy alias. Returns null
// for blank/unrecognized values.
export function normalizeAlertSeverity(severity: string | null | undefined): "critical" | "warning" | "info" | null {
  const raw = (severity ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "critical" || raw === "warning" || raw === "info") return raw;
  const collapsed = raw.split(/[_\-\s]+/).filter(Boolean).join("_");
  return severityAliases[collapsed] ?? null;
}

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

// Known alert severity labels. Legacy rows may carry arbitrary strings
// (e.g. "sev_1"); alertSeverityLabel falls back to a readable Title Case
// of the raw value (never blank, never raw underscores).
export const alertSeverityLabels: Record<string, string> = {
  critical: "Critical",
  warning: "Warning",
  info: "Info",
};

export function alertSeverityLabel(severity: string | null | undefined): string {
  const raw = (severity ?? "").trim();
  if (!raw) return "Info";
  const canonical = normalizeAlertSeverity(raw);
  if (canonical) return alertSeverityLabels[canonical];
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
