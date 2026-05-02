export type AnnouncementRoute = {
  path: string;
  label: string;
};

export const ANNOUNCEMENT_ROUTES: AnnouncementRoute[] = [
  { path: "/", label: "Dashboard" },
  { path: "/news", label: "News" },
  { path: "/alerts", label: "Service Alerts" },
  { path: "/service-updates", label: "Service Updates" },
  { path: "/services", label: "My Services" },
  { path: "/tickets", label: "My Tickets" },
  { path: "/messages", label: "Message Center" },
  { path: "/downloads", label: "Downloads" },
  { path: "/community", label: "Community Chat" },
  { path: "/settings", label: "Settings" },
];

export const ANNOUNCEMENT_ROUTE_PATHS: ReadonlyArray<string> =
  ANNOUNCEMENT_ROUTES.map(r => r.path);

export function isAllowedAnnouncementPath(path: string | null | undefined): boolean {
  if (path === null || path === undefined || path === "") return true;
  return ANNOUNCEMENT_ROUTE_PATHS.includes(path);
}

export function getAnnouncementRouteLabel(path: string | null | undefined): string | null {
  if (!path) return null;
  return ANNOUNCEMENT_ROUTES.find(r => r.path === path)?.label ?? null;
}
