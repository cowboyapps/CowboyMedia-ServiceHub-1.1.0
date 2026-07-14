import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";
import { Newspaper, ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { LazyImage } from "@/components/lazy-image";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { stripHtml } from "@/components/rich-text-editor";
import { NewsReactionsBar } from "@/components/news-reactions-bar";
import { QueryErrorState } from "@/components/query-error-state";
import type { NewsStory } from "@shared/schema";

function SectionIcon({ icon: Icon, tone }: { icon: typeof Newspaper; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function NewBadge() {
  return (
    <span className="rounded-full bg-status-busy px-1.5 py-0.5 text-[10px] font-semibold uppercase text-background shrink-0">
      New
    </span>
  );
}

export default function NewsPage() {
  const { user } = useAuth();

  const { data: news, isLoading, isError, error, refetch, isFetching } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
  });

  const { data: unreadNewsIds } = useQuery<string[]>({
    queryKey: ["/api/content-notifications/unread-references", "news"],
    queryFn: async () => {
      const res = await fetch("/api/content-notifications/unread-references/news", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const unreadNewsSet = new Set(unreadNewsIds || []);

  const markNewsRead = useCallback(() => {
    apiRequest("POST", "/api/content-notifications/mark-read", { category: "news" })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ["/api/content-notifications/counts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    markNewsRead();
  }, [markNewsRead]);

  useEffect(() => {
    const onVisChange = () => {
      if (document.visibilityState === "visible") markNewsRead();
    };
    document.addEventListener("visibilitychange", onVisChange);
    return () => document.removeEventListener("visibilitychange", onVisChange);
  }, [markNewsRead]);

  return (
    <div className="space-y-6">
      <PageHeader title="News & Updates" subtitle="Stay up to date with the latest company news" testId="text-news-title" />

      <section className="rounded-xl border border-card-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold flex items-center gap-3">
            <SectionIcon icon={Newspaper} tone="bg-status-online/10 text-status-online" />
            Latest news
          </h2>
        </div>

        {isLoading ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex gap-3 px-5 py-3.5">
                <Skeleton className="h-10 w-14 rounded-md shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
            resourceName="news"
            className="py-6"
            data-testid="error-news"
          />
        ) : !news || news.length === 0 ? (
          <EmptyState icon={Newspaper} title="No news stories published yet" hint="Check back soon for company news and updates." />
        ) : (
          <ul className="divide-y divide-border">
            {news.map((story) => (
              <li key={story.id} className="stagger-item">
                <Link
                  href={`/news/${story.id}`}
                  className="flex items-start gap-3 px-5 py-3.5 hover-elevate tap-interactive"
                  data-testid={`card-news-${story.id}`}
                >
                  {story.imageUrl ? (
                    <LazyImage
                      src={story.imageUrl}
                      alt=""
                      className="h-14 w-20 rounded-md object-cover shrink-0"
                    />
                  ) : (
                    <span className="mt-0.5 shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                      {format(new Date(story.createdAt), "MMM d")}
                    </span>
                  )}
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <span className="truncate">{story.title}</span>
                      {unreadNewsSet.has(story.id) && <NewBadge />}
                    </p>
                    <p className="text-xs text-muted-foreground line-clamp-2">{stripHtml(story.content)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(story.createdAt), "MMMM d, yyyy")}
                    </p>
                    <div className="pt-1">
                      <NewsReactionsBar storyId={story.id} source="list" />
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
