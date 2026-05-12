import { useEffect, useMemo } from "react";
import DOMPurify from "dompurify";
import changelogRaw from "../../../CHANGELOG.md?raw";
import { renderChangelogToHtml } from "@shared/changelog-render";

export default function WhatsNewPage() {
  const html = useMemo(
    () => DOMPurify.sanitize(renderChangelogToHtml(changelogRaw), { ADD_ATTR: ["id"] }),
    [],
  );

  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [html]);

  return (
    <div className="max-w-3xl mx-auto py-2">
      <h1 className="text-3xl font-bold mb-2" data-testid="text-whats-new-title">What&apos;s New</h1>
      <p className="text-sm text-muted-foreground mb-4">
        A history of features, fixes, and improvements.
      </p>
      <article
        className="prose prose-sm max-w-none dark:prose-invert"
        data-testid="content-changelog"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
