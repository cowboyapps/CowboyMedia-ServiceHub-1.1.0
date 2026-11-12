import { Component, lazy, Suspense, useState, type ComponentType, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

class PageLoadBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section role="alert" className="p-6 space-y-3" data-testid="page-load-error">
        <p className="text-sm text-muted-foreground">This page couldn’t load. Check your connection and try again.</p>
        <button type="button" className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground" onClick={this.props.onRetry}>Try again</button>
        <p className="text-xs text-muted-foreground">If it still won’t load after an update, reload the app.</p>
      </section>
    );
  }
}

/** No prefetch: secondary pages are downloaded only when actually opened. */
export function lazyPage(load: () => Promise<{ default: ComponentType }>) {
  const InitialPage = lazy(load);
  return function LazyPage() {
    const [attempt, setAttempt] = useState(() => ({ Page: InitialPage, key: 0 }));
    const Page = attempt.Page;
    return (
      <PageLoadBoundary key={attempt.key} onRetry={() => setAttempt(current => ({ Page: lazy(load), key: current.key + 1 }))}>
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
