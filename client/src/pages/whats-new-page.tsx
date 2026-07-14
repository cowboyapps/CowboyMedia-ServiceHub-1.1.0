import { useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { versionAnchor } from "@shared/version";
import { History } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

type ChangelogRow = {
  version: string;
  title: string;
  bodyHtml: string;
  publishedAt: string | null;
};

function SectionIcon({ icon: Icon, tone }: { icon: any; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

export default function WhatsNewPage() {
  const { data, isLoading } = useQuery<ChangelogRow[]>({
    queryKey: ["/api/changelog"],
  });

  const entries = useMemo(() => {
    if (!data) return [];
    return data.map((row) => ({
      ...row,
      sanitized: DOMPurify.sanitize(row.bodyHtml, { ADD_ATTR: ["id"] }),
    }));
  }, [data]);

  useEffect(() => {
    if (!entries.length) return;
    // If the URL has a #version-x-y hash (e.g. from the welcome popup), honor it.
    // Otherwise land on the latest published entry so the settings link
    // "What's new in this version" surfaces the most recent release, not the
    // very first entry that happens to render at the top of the DOM.
    const hash = window.location.hash;
    const id = hash ? hash.slice(1) : versionAnchor(entries[0].version);
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: hash ? "smooth" : "auto", block: "start" });
    });
  }, [entries]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-whats-new-title">What&apos;s New</h1>
        <p className="text-sm text-muted-foreground mt-1">
          A history of features, fixes, and improvements.
        </p>
      </div>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={History} tone="bg-primary/10 text-primary" />
            Release Notes
          </h2>
        </div>
        
        {isLoading ? (
          <div className="divide-y divide-border" data-testid="text-whats-new-loading">
            {[1, 2, 3].map((i) => (
              <div key={i} className="px-5 py-6 space-y-4">
                <div>
                  <Skeleton className="h-6 w-1/4 mb-2" />
                  <Skeleton className="h-4 w-1/3" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-4/6" />
                </div>
              </div>
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="text-center py-12 px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mx-auto mb-3">
              <History className="w-6 h-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium" data-testid="text-whats-new-empty">
              No release notes published yet.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {entries.map((e) => (
              <article
                key={e.version}
                id={versionAnchor(e.version)}
                className="scroll-mt-20 px-5 py-6 stagger-item"
                data-testid={`section-changelog-${e.version}`}
              >
                <header className="mb-4">
                  <h2 className="text-lg font-bold flex items-center gap-2">
                    Version {e.version}
                    {e.publishedAt && (
                      <span className="text-xs font-medium bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                        {format(new Date(e.publishedAt), "MMM d, yyyy")}
                      </span>
                    )}
                  </h2>
                  {e.title && (
                    <p className="text-sm text-foreground mt-1 font-medium">{e.title}</p>
                  )}
                </header>
                <div
                  className="prose prose-sm max-w-none dark:prose-invert text-muted-foreground"
                  dangerouslySetInnerHTML={{ __html: e.sanitized }}
                  data-testid={`content-changelog-${e.version}`}
                />
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
