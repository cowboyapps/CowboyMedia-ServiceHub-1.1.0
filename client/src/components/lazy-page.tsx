import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { recoverPageImport } from "@/lib/page-load-recovery";

class PageImportError extends Error {
  constructor(readonly originalError: unknown) {
    super("The page code could not be downloaded.");
    this.name = "PageImportError";
  }
}

class PageLoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error) {
    console.error("Page failed to open:", error instanceof PageImportError ? error.originalError : error);
    // Only a rejected import is eligible, never a component/rendering bug.
    if (!(error instanceof PageImportError)) return;
    try {
      recoverPageImport({
        storage: window.sessionStorage,
        destination: window.location.pathname + window.location.search + window.location.hash,
        online: navigator.onLine !== false,
        reload: () => window.location.reload(),
      });
    } catch {
      // Keep explicit recovery controls if storage/location access is blocked.
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="p-6 space-y-3" data-testid="page-load-error">
        <p className="text-sm text-muted-foreground">This page couldn’t load. Check your connection and try again.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={this.props.onRetry}>Try again</button>
          <button type="button" className="rounded-lg border px-4 py-2 text-sm" onClick={() => window.location.reload()}>Reload app</button>
        </div>
        <p className="text-xs text-muted-foreground">Reload app to get the latest page after an update. You’ll return to this same address.</p>
      </section>
    );
  }
}

/** No prefetch: secondary pages are downloaded only when actually opened. */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const loadPage = () => load().catch(error => { throw new PageImportError(error); });
  const InitialPage = lazy(loadPage);
  return function LazyPage() {
    const [attempt, setAttempt] = useState(() => ({ Page: InitialPage, key: 0 }));
    const Page = attempt.Page;
    return (
      <PageLoadBoundary key={attempt.key} onRetry={() => setAttempt(current => ({ Page: lazy(loadPage), key: current.key + 1 }))}>
        <Suspense fallback={
          <div role="status" aria-label="Loading page" className="p-6 space-y-3" data-testid="page-loading">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full" />
          </div>
        }>
          <Page />
        </Suspense>
      </PageLoadBoundary>
    );
  };
}
