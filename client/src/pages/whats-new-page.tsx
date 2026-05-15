import { useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { versionAnchor } from "@shared/version";

type ChangelogRow = {
  version: string;
  title: string;
  bodyHtml: string;
  publishedAt: string | null;
};

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
    const hash = window.location.hash;
    if (!hash) return;
    const id = hash.slice(1);
    // Wait a tick for the freshly-rendered content to be in the DOM.
    requestAnimationFrame(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [entries]);

  return (
    <div className="max-w-3xl mx-auto py-2">
      <h1 className="text-3xl font-bold mb-2" data-testid="text-whats-new-title">What&apos;s New</h1>
      <p className="text-sm text-muted-foreground mb-4">
        A history of features, fixes, and improvements.
      </p>
      {isLoading && (
        <p className="text-sm text-muted-foreground" data-testid="text-whats-new-loading">Loading…</p>
      )}
      {!isLoading && entries.length === 0 && (
        <p className="text-sm text-muted-foreground" data-testid="text-whats-new-empty">
          No release notes published yet.
        </p>
      )}
      <div className="space-y-8">
        {entries.map((e) => (
          <article
            key={e.version}
            id={versionAnchor(e.version)}
            className="scroll-mt-20"
            data-testid={`section-changelog-${e.version}`}
          >
            <header className="mb-2">
              <h2 className="text-2xl font-bold">
                Version {e.version}
                {e.publishedAt && (
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    {format(new Date(e.publishedAt), "MMMM d, yyyy")}
                  </span>
                )}
              </h2>
              {e.title && (
                <p className="text-base text-muted-foreground mt-1">{e.title}</p>
              )}
            </header>
            <div
              className="prose prose-sm max-w-none dark:prose-invert"
              dangerouslySetInnerHTML={{ __html: e.sanitized }}
              data-testid={`content-changelog-${e.version}`}
            />
          </article>
        ))}
      </div>
    </div>
  );
}
