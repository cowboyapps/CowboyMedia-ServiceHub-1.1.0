import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { ArrowLeft, AlertTriangle, CheckCircle, Clock, Info, Activity, ListTodo } from "lucide-react";
import { RichTextContent } from "@/components/rich-text-content";
import { alertStatusLabel, alertSeverityLabel, alertSeverityMeta } from "@/lib/status-meta";

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
      return <CheckCircle className="w-4 h-4 text-status-online" />;
    case "investigating":
      return <AlertTriangle className="w-4 h-4 text-status-away" />;
    case "identified":
      return <Info className="w-4 h-4 text-primary" />;
    default:
      return <Clock className="w-4 h-4 text-muted-foreground" />;
  }
}

const statusPill: Record<string, string> = {
  investigating: "bg-status-away/15 text-status-away",
  identified: "bg-status-away/15 text-status-away",
  monitoring: "bg-primary/15 text-primary",
  resolved: "bg-status-online/15 text-status-online",
};

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

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
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
      <header className="border-b border-border bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link href="/status" className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-back-status">
            <ArrowLeft className="w-4 h-4 mr-1.5" /> Back to status
          </Link>
          <a href="/" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors" data-testid="link-signin">Sign in</a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {isLoading ? (
          <div className="space-y-6">
            <section className="rounded-xl border border-card-border bg-card p-6 space-y-4">
              <Skeleton className="h-8 w-3/4 animate-shimmer" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-20 rounded-full animate-shimmer" />
                <Skeleton className="h-6 w-24 rounded-full animate-shimmer" />
              </div>
              <Skeleton className="h-20 w-full animate-shimmer" />
            </section>
            <section className="rounded-xl border border-card-border bg-card p-6 space-y-4">
              <Skeleton className="h-6 w-40 animate-shimmer" />
              <div className="pl-6 space-y-4">
                <Skeleton className="h-16 w-full animate-shimmer" />
                <Skeleton className="h-16 w-full animate-shimmer" />
              </div>
            </section>
          </div>
        ) : error && !isNotFoundError(error) ? (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="py-12 px-6 text-center space-y-4">
              <AlertTriangle className="w-10 h-10 text-status-away mx-auto opacity-80" />
              <div>
                <p className="font-semibold text-lg" data-testid="text-incident-error">Couldn't load this incident</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Something went wrong while fetching the incident details. Please try again.
                </p>
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <Button variant="outline" size="sm" onClick={() => refetch()} data-testid="button-retry-incident">
                  Try again
                </Button>
                <Link href="/status">
                  <Button variant="ghost" size="sm" data-testid="link-error-back-status">Back to status</Button>
                </Link>
              </div>
            </div>
          </section>
        ) : !data ? (
          <section className="rounded-xl border border-card-border bg-card overflow-hidden">
            <div className="py-12 px-6 text-center space-y-4">
              <Info className="w-10 h-10 text-muted-foreground mx-auto opacity-50" />
              <div>
                <p className="font-semibold text-lg" data-testid="text-incident-not-found">Incident not found</p>
                <p className="text-sm text-muted-foreground mt-1">The incident you're looking for doesn't exist or has been removed.</p>
              </div>
              <div className="pt-2">
                <Link href="/status">
                  <Button variant="outline" size="sm">Back to status</Button>
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="rounded-xl border border-card-border bg-card overflow-hidden animate-fade-in">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-3">
                  <SectionIcon icon={Activity} tone="bg-status-away/10 text-status-away" />
                  Incident Details
                </h2>
              </div>
              <div className="p-6">
                <div className="space-y-4">
                  <h1 className="text-2xl font-bold" data-testid="text-incident-title">{data.title}</h1>
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${alertSeverityMeta(data.severity).pill}`}
                      data-testid="badge-severity"
                    >
                      {alertSeverityLabel(data.severity)}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusPill[data.status] || "bg-muted text-muted-foreground"}`}
                      data-testid="badge-status"
                    >
                      {alertStatusLabel(data.status)}
                    </span>
                    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground" data-testid="badge-service">
                      {data.serviceName}
                    </span>
                  </div>
                </div>
                
                <div className="mt-6 pt-6 border-t border-border">
                  <RichTextContent content={data.description} className="text-sm" testId="text-incident-description" />
                  <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground mt-6 pt-4">
                    {data.createdAt && (
                      <span className="flex items-center gap-1.5" data-testid="text-opened-at">
                        <Clock className="w-3.5 h-3.5" />
                        Opened {format(new Date(data.createdAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    )}
                    {data.resolvedAt && (
                      <span className="flex items-center gap-1.5" data-testid="text-resolved-at">
                        <CheckCircle className="w-3.5 h-3.5" />
                        Resolved {format(new Date(data.resolvedAt), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    )}
                    {data.durationSeconds > 0 && (
                      <span className="flex items-center gap-1.5" data-testid="text-duration">
                        <Activity className="w-3.5 h-3.5" />
                        Duration: {formatDuration(data.durationSeconds)}
                        {data.status !== "resolved" && " (ongoing)"}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-card-border bg-card overflow-hidden animate-slide-up">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <h2 className="text-sm font-semibold flex items-center gap-3">
                  <SectionIcon icon={ListTodo} tone="bg-muted text-muted-foreground" />
                  Updates Timeline
                </h2>
              </div>
              <div className="p-6">
                {data.updates.length === 0 ? (
                  <div className="text-center py-8">
                    <Clock className="w-8 h-8 mx-auto mb-3 text-muted-foreground opacity-50" />
                    <p className="text-sm text-muted-foreground" data-testid="text-no-updates">No updates posted yet</p>
                  </div>
                ) : (
                  <div className="relative space-y-0">
                    <div className="absolute left-[9px] top-3 bottom-3 w-px bg-border" />
                    {data.updates.map((update) => (
                      <div key={update.id} className="stagger-item relative pl-8 pb-8 last:pb-0" data-testid={`incident-update-${update.id}`}>
                        <div className="absolute left-0 top-1 z-10 bg-background p-0.5 rounded-full border border-border">
                          <StatusIcon status={update.status} />
                        </div>
                        <div className="space-y-2">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${statusPill[update.status] || "bg-muted text-muted-foreground"}`} data-testid={`badge-update-status-${update.id}`}>
                              {alertStatusLabel(update.status)}
                            </span>
                            <span className="text-xs text-muted-foreground font-medium">
                              {format(new Date(update.createdAt), "MMM d, h:mm a")}
                            </span>
                          </div>
                          <div className="text-sm bg-muted/30 rounded-lg p-4 border border-border/50">
                            <RichTextContent content={update.message} className="text-sm" testId={`text-incident-update-message-${update.id}`} />
                            {update.imageUrl && (
                              <img src={update.imageUrl} alt="Update attachment" className="max-h-64 rounded-md mt-3 border shadow-sm" />
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
