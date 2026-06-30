import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    if (res.status === 429) {
      let retryAfterSeconds: number | undefined;
      try {
        const cloned = res.clone();
        const body = await cloned.json();
        if (typeof body?.retryAfterSeconds === "number") {
          retryAfterSeconds = body.retryAfterSeconds;
        }
      } catch {
        const headerVal = res.headers.get("Retry-After");
        if (headerVal) {
          const parsed = parseInt(headerVal, 10);
          if (!Number.isNaN(parsed)) retryAfterSeconds = parsed;
        }
      }
      const description = retryAfterSeconds
        ? `Try again in about ${retryAfterSeconds}s.`
        : "Please wait a moment before trying again.";
      toast({ title: "Slow down", description, variant: "destructive" });
      const text = (await res.text()) || res.statusText;
      throw new Error(`${res.status}: ${text}`);
    }
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export class TimeoutError extends Error {
  constructor(message = "The request timed out — please check your connection and try again.") {
    super(message);
    this.name = "TimeoutError";
  }
}

// Default client-side timeout for every mutation/write request. Without it, a
// truly dead connection (online flag set, but no packets flowing) leaves the
// fetch pending forever, so the bound `mutation.isPending` never clears and the
// button stays disabled with no way to retry short of a reload. Every
// `apiRequest` caller sends a small JSON body (file uploads go through
// `uploadRequest` below, never this helper), so a single shared timeout is safe.
// Opt out (or extend) per call via `{ timeoutMs }`: pass `0`/`null` to disable,
// or a larger number for legitimately slow endpoints (e.g. AI generation).
export const DEFAULT_TIMEOUT_MS = 30_000;

// Generous client-side timeout for raw file/image uploads. Uploads deliberately
// bypass `apiRequest` because they send multipart `FormData` (binary blobs), not
// a small JSON body, so they need their own helper. The deadline is far larger
// than the JSON-write default because a legitimately slow connection pushing a
// large image up can take a while — but a truly dead connection (online flag
// set, no packets flowing) would otherwise leave the upload pending forever, the
// progress spinner stuck with no error and no retry, the same failure mode the
// read/write timeouts fixed. A finite abort surfaces a `TimeoutError` the caller
// can show / retry instead of an infinite spinner. Opt out (or extend) per call
// via `{ timeoutMs }`: pass `0`/`null` to disable, or a larger number for
// unusually large uploads.
export const DEFAULT_UPLOAD_TIMEOUT_MS = 120_000;

// Default client-side timeout for every read (query) request. Without it, a
// truly dead connection (online flag set, but no packets flowing) leaves the
// `getQueryFn` fetch pending forever, so the bound `query.isLoading` never
// clears and the page sits on a loading skeleton with no error and no retry.
// A finite abort makes React Query's `isError` path render (retry UI / message)
// instead of an endless skeleton, while still being generous enough not to trip
// a slow-but-alive connection. The existing retry policy still applies on top.
export const DEFAULT_QUERY_TIMEOUT_MS = 30_000;

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
  options?: { timeoutMs?: number | null },
): Promise<Response> {
  const timeoutMs =
    options?.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const controller = timeoutMs ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (controller && timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller?.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new TimeoutError();
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }

  await throwIfResNotOk(res);
  return res;
}

// Raw multipart upload helper for file/image POST/PATCH calls. Mirrors
// `apiRequest`'s abort-timeout plumbing but sends `FormData` (so the browser
// sets the multipart boundary itself — never set Content-Type manually) and does
// NOT call `throwIfResNotOk`, because every upload call site does its own
// `res.ok` handling (custom messages, optimistic UI). Returns the raw Response
// so it is a drop-in for the previous `fetch(url, { method, body, credentials })`
// pattern, but now a dead connection aborts after `DEFAULT_UPLOAD_TIMEOUT_MS` and
// surfaces a `TimeoutError` instead of hanging the upload spinner forever.
export async function uploadRequest(
  method: string,
  url: string,
  formData: FormData,
  options?: { timeoutMs?: number | null },
): Promise<Response> {
  const timeoutMs =
    options?.timeoutMs === undefined
      ? DEFAULT_UPLOAD_TIMEOUT_MS
      : options.timeoutMs;
  const controller = timeoutMs ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  if (controller && timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  }

  try {
    return await fetch(url, {
      method,
      body: formData,
      credentials: "include",
      signal: controller?.signal,
    });
  } catch (err) {
    if (timedOut) {
      throw new TimeoutError();
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
  timeoutMs?: number | null;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior, timeoutMs }) =>
  async ({ queryKey, signal }) => {
    const effectiveTimeout =
      timeoutMs === undefined ? DEFAULT_QUERY_TIMEOUT_MS : timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timer = effectiveTimeout
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, effectiveTimeout)
      : undefined;
    // Honour React Query's own cancellation (unmount / refetch) by forwarding it
    // to the same controller, so we never leak a hanging fetch either way.
    signal?.addEventListener("abort", () => controller.abort());

    let res: Response;
    try {
      res = await fetch(queryKey.join("/") as string, {
        credentials: "include",
        signal: controller.signal,
      });
    } catch (err) {
      if (timedOut) {
        throw new TimeoutError();
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Cache policy for WHMCS-backed (read-on-demand) screens — customer billing,
// invoices, payments, services, and the admin per-user WHMCS panel + sub-views.
// WHMCS data can change directly in WHMCS (an invoice paid/deleted, a product
// cancelled) with no webhook to tell us, so these screens must re-check WHMCS on
// open, when the window/app regains focus (PWA resume fires visibilitychange),
// and on reconnect — instead of trusting the app-wide `staleTime: Infinity`
// default that would otherwise show an indefinitely cached snapshot. Spread this
// into the relevant `useQuery` calls (`...liveQueryOptions`) so the change is
// scoped to WHMCS-backed queries and the rest of the app keeps its caching.
//
// The finite `staleTime` is the real fix: with the app-wide `Infinity` a query
// is never stale, so nothing ever refetches; a 30s window makes data go stale
// quickly so the (staleness-respecting) mount/focus/reconnect refetches below
// actually fire on the next open/resume. They are `true` (not `"always"`) on
// purpose — re-navigating within 30s reuses the just-loaded data instead of
// firing a redundant refetch, while a resume/reopen after any real gap is past
// staleTime and refetches, clearing e.g. an invoice deleted directly in WHMCS.
export const liveQueryOptions = {
  staleTime: 30_000,
  refetchOnMount: true,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
} as const;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: (failureCount, error) => {
        if (!navigator.onLine) return false;
        return failureCount < 1;
      },
      networkMode: "offlineFirst",
    },
    mutations: {
      retry: false,
      networkMode: "offlineFirst",
    },
  },
});
