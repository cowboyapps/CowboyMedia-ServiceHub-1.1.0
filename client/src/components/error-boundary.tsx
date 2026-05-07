import { Component, type ReactNode } from "react";
import { recoverFromStaleDeploy } from "@/lib/stale-deploy";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") {
      console.error("App boot error caught by boundary:", error);
    }
  }

  private handleReload = async () => {
    await recoverFromStaleDeploy({
      serviceWorker: "serviceWorker" in navigator ? navigator.serviceWorker : undefined,
      caches: "caches" in window ? caches : undefined,
      reload: () => window.location.reload(),
    });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error?.message || "An unexpected error occurred.";

    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center bg-background p-6"
        data-testid="app-error-boundary"
      >
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl" aria-hidden="true">⚠️</div>
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            The app couldn't finish loading. This usually means a stale cached version.
            Tap below to clear the cache and try again.
          </p>
          <details className="text-xs text-left text-muted-foreground bg-muted/40 rounded-md p-2">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="mt-2 whitespace-pre-wrap break-words">{message}</pre>
          </details>
          <button
            type="button"
            onClick={this.handleReload}
            className="w-full inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm font-medium hover:bg-primary/90"
            data-testid="button-error-reload"
          >
            Reload app
          </button>
        </div>
      </div>
    );
  }
}
