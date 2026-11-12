import type { AnchorHTMLAttributes } from "react";
import { AlertCircle } from "lucide-react";

export type Service = { id: string; name: string; status: string };
export type ServiceAlertWithServices = { id: string; title: string; status: string; severity: string; serviceIds: string[]; createdAt: string };
export type NewsStory = { id: string; title: string; content: string; createdAt: string };
export type Ticket = { id: string; subject: string; status: string; createdAt: string };
export type ServiceUpdate = { id: string; title: string; message: string; content: string; serviceId: string; createdAt: string };
export type Promotion = { id: string; title: string };

const now = Date.now();
export const exampleServices: Service[] = [
  { id: "prime", name: "CowboyPRIME", status: "degraded" },
  { id: "one", name: "CowboyONE", status: "operational" },
];
export const exampleAlerts: ServiceAlertWithServices[] = [
  { id: "vod", title: "Some on-demand titles are temporarily unavailable", status: "identified", severity: "warning", serviceIds: ["prime"], createdAt: new Date(now - 7_200_000).toISOString() },
  { id: "maintenance", title: "Scheduled overnight maintenance", status: "monitoring", severity: "info", serviceIds: ["one"], createdAt: new Date(now - 10_800_000).toISOString() },
];
export const exampleTickets: Ticket[] = [{ id: "example-ticket", subject: "Help setting up a new device", status: "open", createdAt: new Date(now - 3_600_000).toISOString() }];
export const exampleUpdates: ServiceUpdate[] = [
  { id: "library", title: "On-demand library update", message: "More titles are being restored. Refresh your playlist to see newly available content.", content: "More titles are being restored.", serviceId: "prime", createdAt: new Date(now - 900_000).toISOString() },
  { id: "devices", title: "Getting started on a new device", message: "Find the latest app downloads and setup guides in Downloads.", content: "Updated setup guides are available.", serviceId: "one", createdAt: new Date(now - 86_400_000).toISOString() },
];
export function showPreviewDetail(title: string, body: string) {
  window.dispatchEvent(new CustomEvent("dashboard-preview-detail", { detail: { title, body } }));
}
export function Link({ href = "/", children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a {...props} href={href} onClick={event => {
    props.onClick?.(event);
    event.preventDefault();
    if (event.defaultPrevented && (event.target as HTMLElement).closest("button")) return;
    const alert = exampleAlerts.find(item => href.endsWith(`/${item.id}`));
    const update = exampleUpdates.find(item => href.includes(item.id));
    showPreviewDetail(alert?.title ?? update?.title ?? "Sample destination", alert
      ? "Example alert details: the provider identified the cause and is restoring affected titles. Next update will be posted when available."
      : update?.message ?? `This would open ${href} in the live app. This is a design preview only.`);
  }}>{children}</a>;
}
export function useAuth() {
  return { user: { fullName: "Sam", subscribedServices: ["prime", "one"] } };
}
export const liveQueryOptions = {};
const data: Record<string, unknown> = {
  "/api/services": exampleServices,
  "/api/services-uptime-summary": {},
  "/api/alerts": exampleAlerts,
  "/api/news": [{ id: "welcome", title: "Your ServiceHub guide", content: "Find service updates, downloads and support in one place.", createdAt: new Date(now - 86_400_000).toISOString() }],
  "/api/tickets": exampleTickets,
  "/api/service-updates": exampleUpdates,
  "/api/content-notifications/unread-references": ["library"],
  "/api/promotions": [{ id: "sample-offer", title: "Current customer offer" }],
};
// API/auth boundaries are deliberately stubbed: no requests or customer data.
export function useQuery<T>(options: { queryKey: string[]; [key: string]: unknown }) {
  return { data: data[options.queryKey[0]] as T | undefined, isLoading: false, isError: false, error: null, isFetching: false, refetch: async () => {} };
}
export function stripHtml(html: string) { return html.replace(/<[^>]*>/g, "").trim(); }
export function QueryErrorState({ resourceName }: { [key: string]: unknown }) {
  return <div className="p-5 text-sm"><AlertCircle className="h-4 w-4" />Couldn’t load {String(resourceName)}.</div>;
}
export const statusMeta: Record<string, { label: string; dot: string; pill: string }> = {
  operational: { label: "Operational", dot: "bg-status-online", pill: "bg-status-online/15 text-status-online" },
  degraded: { label: "Degraded", dot: "bg-status-away", pill: "bg-status-away/15 text-status-away" },
  outage: { label: "Outage", dot: "bg-status-busy", pill: "bg-status-busy/15 text-status-busy" },
  maintenance: { label: "Maintenance", dot: "bg-status-offline", pill: "bg-status-offline/20 text-muted-foreground" },
};
export const ticketStatusPill: Record<string, string> = { open: "bg-primary/15 text-primary", closed: "bg-muted text-muted-foreground" };
