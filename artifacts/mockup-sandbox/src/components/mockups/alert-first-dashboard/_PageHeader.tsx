import { useEffect, useRef, useState } from "react";

/**
 * iOS-style large-title page header. Renders a big bold title (with optional
 * subtitle); when the large title scrolls out of view, a compact sticky bar
 * with a frosted-glass backdrop fades in pinned to the top of the scroll
 * container. Detection uses an IntersectionObserver on the large title, so
 * there is no scroll listener and no per-frame work.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  testId,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  testId?: string;
}) {
  const titleRef = useRef<HTMLDivElement>(null);
  const [condensed, setCondensed] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Anchor detection to the app's real scroll container (pages scroll inside
    // it, not the viewport). Fall back to the viewport if it isn't mounted
    // (e.g. unauthenticated/public layouts).
    const root = document.getElementById("app-scroll-container");
    const observer = new IntersectionObserver(
      ([entry]) => setCondensed(!entry.isIntersecting),
      { root, rootMargin: "-44px 0px 0px 0px", threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      {/* Zero-height sticky wrapper: the compact bar overlays content without
          affecting layout, pinned to the top of the scroll container. */}
      <div className="sticky top-0 z-20 h-0 -mx-3 sm:-mx-6">
        <div
          aria-hidden={!condensed}
          className={`flex items-center justify-center h-11 px-3 sm:px-6 border-b transition-all duration-200 ${
            condensed
              ? "opacity-100 translate-y-0 bg-background/80 backdrop-blur-xl border-border"
              : "opacity-0 -translate-y-2 border-transparent pointer-events-none"
          }`}
        >
          <span className="text-sm font-semibold truncate max-w-[70%]">{title}</span>
        </div>
      </div>
      <div ref={titleRef} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight" data-testid={testId}>
            {title}
          </h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {actions && <div className="shrink-0 pt-1">{actions}</div>}
      </div>
    </>
  );
}
