import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Info } from "lucide-react";
import { RichTextContent } from "@/components/rich-text-content";

type PublicIncident = {
  id: string;
  title: string;
  description: string;
  status: string;
  severity: string;
  serviceName: string;
  serviceCategory: string | null;
  createdAt: string | null;
  resolvedAt: string | null;
  durationSeconds: number;
  updates: { id: string; message: string; status: string; imageUrl: string | null; createdAt: string }[];
};

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "resolved":
      return <CheckCircle className="w-4 h-4 text-emerald-500" />;
    case "investigating":
      return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    case "identified":
      return <Info className="w-4 h-4 text-primary" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return rem ? `${h}h ${rem}m` : `${h}h`;
  const d = Math.floor(h / 24);
  const remH = h % 24;
  return remH ? `${d}d ${remH}h` : `${d}d`;
}

// Maps a service category to a public-facing image used for OG/Twitter previews.
// Falls back to the site favicon when no per-category icon is configured.
function categoryOgImage(category: string | null | undefined, origin: string): string {
  return `${origin}/favicon.png`;
  // Note: per-category icon assets are not bundled today. When a future task
  // adds them under e.g. /icons/category/<key>.png, branch on `category` here.
}

function useIncidentMeta(incident: PublicIncident | undefined) {
  useEffect(() => {
    if (!incident) return;
    const prevTitle = document.title;
    const title = `${incident.title} — ${incident.serviceName} | Status`;
    document.title = title;
    const description = (incident.description || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const ogImage = categoryOgImage(incident.serviceCategory, window.location.origin);
    const url = window.location.href;

    type Snapshot = { el: HTMLMetaElement; created: boolean; prev: string | null };
    const snapshots: Snapshot[] = [];
    const upsert = (name: string, content: string, attr: "name" | "property" = "name") => {
      let el = document.head.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
      const created = !el;
      const prev = el?.getAttribute("content") ?? null;
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
      snapshots.push({ el, created, prev });
    };

    upsert("description", description);
    upsert("og:title", title, "property");
    upsert("og:description", description, "property");
    upsert("og:type", "article", "property");
    upsert("og:url", url, "property");
    upsert("og:image", ogImage, "property");
    upsert("twitter:card", "summary_large_image");
    upsert("twitter:title", title);
    upsert("twitter:description", description);
    upsert("twitter:image", ogImage);

    return () => {
      document.title = prevTitle;
      for (const snap of snapshots) {
        if (snap.created) {
          snap.el.remove();
        } else if (snap.prev !== null) {
          snap.el.setAttribute("content", snap.prev);
        }
      }
    };
  }, [incident]);
}

// The shared default queryFn throws `Error("<status>: <body>")` on non-ok
// responses, so a missing incident (404) and a server/network failure both land
// in `error`. Only a genuine 404 means "this incident doesn't exist" — anything
// else must render an explicit "couldn't load" state (with retry), never the
// misleading "Incident not found".
function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && /^404[:\s]/.test(error.message);
}

// How often the page re-polls an ongoing (unresolved) incident. Visitors leave
// this page open during an outage, so it must keep pulling new updates without
// a manual reload; once the incident is resolved it goes back to the cheap
// app-wide cache-forever behavior.
export const ONGOING_INCIDENT_REFETCH_MS = 30_000;

function isOngoing(data: PublicIncident | undefined): boolean {
  return !!data && data.status !== "resolved";
}

export default function PublicIncidentPage() {
  const params = useParams<{ id: string }>();

  const { data, isLoading, error, refetch } = useQuery<PublicIncident>({
    queryKey: ["/api/public/incidents", params.id],
    // Live-update while the outage is ongoing. The app-wide default is
    // `staleTime: Infinity` (fetch once, freeze), which is wrong for an active
    // incident page. `refetchInterval` ignores staleTime, and the
    // focus/reconnect refetches use "always" for the same reason — with an
    // infinite staleTime a plain `true` would never fire. All three predicates
    // read the query's own data, so a resolved incident keeps the cheap cached
    // behavior with no polling and no focus refetches.
    refetchInterval: (query) =>
      isOngoing(query.state.data) ? ONGOING_INCIDENT_REFETCH_MS : false,
    refetchOnWindowFocus: (query) => (isOngoing(query.state.data) ? "always" : false),
    refetchOnReconnect: (query) => (isOngoing(query.state.data) ? "always" : false),
  });

  useIncidentMeta(data);

  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/status" className="inline-flex items-center text-sm text-primary hover:underline" data-testid="link-back-status">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to status
          </Link>
          <a href="/" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-signin">Sign in</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-10 w-3/4" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-60 w-full" />
          </div>
        ) : error && !isNotFoundError(error) ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="font-medium" data-testid="text-incident-error">Couldn't load this incident</p>
              <p className="text-sm text-muted-foreground">
                Something went wrong while fetching the incident details. Please try again.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-incident">
                  Try again
                </Button>
                <Link href="/status">
                  <Button variant="ghost" size="sm" data-testid="link-error-back-status">Back to status</Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : !data ? (
          <Card>
            <CardContent className="py-10 text-center space-y-3">
              <p className="text-muted-foreground" data-testid="text-incident-not-found">Incident not found.</p>
              <Link href="/status">
                <Button variant="outline" size="sm">Back to status</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader className="pb-3">
                <div className="space-y-2">
                  <CardTitle className="text-2xl" data-testid="text-incident-title">{data.title}</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant={data.severity === "critical" ? "destructive" : data.severity === "warning" ? "default" : "secondary"}
                      className="text-xs capitalize"
                      data-testid="badge-severity"
                    >
                      {data.severity}
                    </Badge>
                    <Badge
                      variant={data.status === "resolved" ? "secondary" : "default"}
                      className="text-xs capitalize"
                      data-testid="badge-status"
                    >
                      {data.status}
                    </Badge>
                    <Badge variant="secondary" className="text-xs" data-testid="badge-service">{data.serviceName}</Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <RichTextContent content={data.description} className="text-sm" testId="text-incident-description" />
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground pt-1">
                  {data.createdAt && (
                    <span className="flex items-center gap-1" data-testid="text-opened-at">
                      <Clock className="w-3 h-3" />
                      Opened {format(new Date(data.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  )}
                  {data.resolvedAt && (
                    <span className="flex items-center gap-1" data-testid="text-resolved-at">
                      <CheckCircle className="w-3 h-3" />
                      Resolved {format(new Date(data.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
                    </span>
                  )}
                  {data.durationSeconds > 0 && (
                    <span data-testid="text-duration">
                      Duration: {formatDuration(data.durationSeconds)}
                      {data.status !== "resolved" && " (ongoing)"}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Updates Timeline</CardTitle>
              </CardHeader>
              <CardContent>
                {data.updates.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6" data-testid="text-no-updates">No updates posted yet</p>
                ) : (
                  <div className="relative space-y-0">
                    <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />
                    {data.updates.map((update) => (
                      <div key={update.id} className="relative pl-7 pb-6 last:pb-0" data-testid={`incident-update-${update.id}`}>
                        <div className="absolute left-0 top-1 z-10 bg-background p-0.5 rounded-full">
                          <StatusIcon status={update.status} />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs capitalize">{update.status}</Badge>
                            <span className="text-xs text-muted-foreground">
                              {format(new Date(update.createdAt), "MMM d, h:mm a")}
                            </span>
                          </div>
                          <RichTextContent content={update.message} className="text-sm" testId={`text-incident-update-message-${update.id}`} />
                          {update.imageUrl && (
                            <img src={update.imageUrl} alt="Update attachment" className="max-h-48 rounded-md mt-1 border" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
