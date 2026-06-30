import { AlertTriangle, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TimeoutError } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

function isTimeoutError(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "TimeoutError"
  );
}

interface QueryErrorStateProps {
  error?: unknown;
  onRetry: () => void;
  isRetrying?: boolean;
  /** Short noun describing what failed to load, e.g. "alerts". */
  resourceName?: string;
  className?: string;
  "data-testid"?: string;
}

/**
 * Consistent, friendly error state shown when a page's data query fails
 * (including the 30s read timeout in `getQueryFn`). Renders a clear message
 * plus a Retry button that re-runs the query via the supplied `onRetry`
 * (typically React Query's `refetch`).
 */
export function QueryErrorState({
  error,
  onRetry,
  isRetrying,
  resourceName,
  className,
  "data-testid": testId = "error-state",
}: QueryErrorStateProps) {
  const timedOut = isTimeoutError(error);
  const what = resourceName ?? "this content";

  const title = timedOut ? "This is taking too long" : "Couldn't load";
  const message = timedOut
    ? `Loading ${what} timed out. Check your connection and try again.`
    : `Something went wrong while loading ${what}. Please try again.`;

  const Icon = timedOut ? WifiOff : AlertTriangle;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center text-center rounded-lg border border-dashed bg-card px-6 py-12",
        className,
      )}
      role="alert"
      data-testid={testId}
    >
      <Icon className="w-10 h-10 mb-3 text-muted-foreground" />
      <h3 className="font-semibold text-base" data-testid={`${testId}-title`}>
        {title}
      </h3>
      <p
        className="text-sm text-muted-foreground mt-1 max-w-sm"
        data-testid={`${testId}-message`}
      >
        {message}
      </p>
      <Button
        variant="outline"
        className="mt-4"
        onClick={onRetry}
        disabled={isRetrying}
        data-testid={`${testId}-retry`}
      >
        <RefreshCw
          className={cn("w-4 h-4 mr-2", isRetrying && "animate-spin")}
        />
        {isRetrying ? "Retrying…" : "Retry"}
      </Button>
    </div>
  );
}
