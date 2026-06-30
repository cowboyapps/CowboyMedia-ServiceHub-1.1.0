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

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const res = await fetch(url, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(queryKey.join("/") as string, {
      credentials: "include",
    });

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
