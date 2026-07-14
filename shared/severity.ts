// Canonical alert severity levels + legacy alias normalization, shared by the
// web UI (badge styling/labels) and every server-side formatter (Discord,
// Telegram) so all channels show the same "Critical"/"Warning"/"Info" wording
// for legacy severities like "sev_1" or "major".

export type CanonicalSeverity = "critical" | "warning" | "info";

// Legacy severity aliases. Old rows (written before the server-side severity
// whitelist) may carry strings like "sev_1" or "major" that map cleanly onto
// the canonical critical/warning/info levels. Keys are compared after trim +
// lowercase with separators (_, -, whitespace) collapsed to a single underscore.
export const severityAliases: Record<string, CanonicalSeverity> = {
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
export function normalizeAlertSeverity(severity: string | null | undefined): CanonicalSeverity | null {
  const raw = (severity ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw === "critical" || raw === "warning" || raw === "info") return raw;
  const collapsed = raw.split(/[_\-\s]+/).filter(Boolean).join("_");
  return severityAliases[collapsed] ?? null;
}

// Known alert severity labels. Legacy rows may carry arbitrary strings
// (e.g. "sev_1"); alertSeverityLabel falls back to a readable Title Case
// of the raw value (never blank, never raw underscores).
export const alertSeverityLabels: Record<CanonicalSeverity, string> = {
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
