import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ChevronRight, Newspaper, RotateCw } from "lucide-react";
import type { NewsArticleRef } from "@shared/news-attachments";

export function NewsArticleCard({ id, article, messageId, onBubble = false }: {
  id: string;
  article?: NewsArticleRef | null;
  messageId: string;
  onBubble?: boolean;
}) {
  const query = useQuery<NewsArticleRef | null>({
    queryKey: ["/api/news", id],
    enabled: !!id,
    placeholderData: article ?? undefined,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/news/${encodeURIComponent(id)}`, {
        credentials: "include", cache: "no-store", signal,
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error("News article could not be loaded");
      return await response.json() as NewsArticleRef;
    },
  });
  const story = query.data;
  const unavailable = query.isSuccess && story === null;
  return (
    <div className={`mt-2 rounded-md border ${onBubble ? "border-primary-foreground/30 bg-primary-foreground/10" : "border-border bg-background/60"}`}>
    <Link href={`/news/${encodeURIComponent(id)}`}
      className="flex items-start gap-2 rounded-md p-2 no-underline transition-colors hover-elevate tap-interactive"
      data-testid={`news-card-msg-${messageId}`} aria-label={unavailable ? "Shared news article unavailable" : `Open news article ${story?.title ?? ""}`}>
      <Newspaper className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium">
          {unavailable ? "News article unavailable" : story?.title ?? (query.isLoading ? "Loading news article…" : "News article")}
        </span>
        {!unavailable && !query.isError && <span className="mt-0.5 block text-[10px] opacity-80">News article</span>}
        {unavailable && <span className="mt-0.5 block text-[10px] opacity-80">This article may have been removed.</span>}
      </span>
      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" />
    </Link>
    {query.isError && <div className="px-2 pb-2 text-xs" role="alert">
      <p>Couldn’t load this article.</p>
      <button type="button" className="mt-1 inline-flex items-center gap-1 underline" onClick={() => void query.refetch()}
        disabled={query.isFetching} data-testid={`button-news-card-retry-${messageId}`}>
        <RotateCw className="h-3 w-3" /> Try again
      </button>
    </div>}
    </div>
  );
}
