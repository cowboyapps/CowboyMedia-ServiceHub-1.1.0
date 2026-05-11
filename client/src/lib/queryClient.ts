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
