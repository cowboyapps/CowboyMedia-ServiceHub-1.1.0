import type { Service, ServiceAlertWithServices } from "@shared/schema";
import { normalizeAlertSeverity } from "@shared/severity";

function priority(alert: ServiceAlertWithServices) {
  const severity = normalizeAlertSeverity(alert.severity);
  return severity === "critical" ? 3 : severity === "info" ? 1 : 2;
}

export function dashboardHealth(services: Service[], alerts: ServiceAlertWithServices[]) {
  const active = alerts.filter(alert => alert.status !== "resolved").sort((a, b) =>
    Number(a.status === "monitoring") - Number(b.status === "monitoring") ||
    priority(b) - priority(a) ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
  const problems = active.filter(alert => alert.status !== "monitoring");
  const monitoring = active.filter(alert => alert.status === "monitoring");
  const outage = services.some(service => service.status === "outage") || problems.some(alert => priority(alert) === 3);
  const issue = problems.length > 0 || services.some(service => service.status !== "operational");
  const mode = outage ? "outage" : issue ? "issue" : monitoring.length ? "monitoring" : services.length ? "healthy" : "empty";
  return { active, problems, monitoring, mode, primary: problems[0] ?? monitoring[0] };
}

export function dashboardDate(value: Date | string | number | undefined | null): Date | undefined {
  if (value == null || value === "") return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : undefined;
}
