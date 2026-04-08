import { useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { format } from "date-fns";
import { Newspaper, ChevronRight } from "lucide-react";
import { LazyImage } from "@/components/lazy-image";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { NewsStory } from "@shared/schema";

export default function NewsPage() {
  const { data: news, isLoading } = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
  });

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
      <div>
        <h1 className="text-2xl font-bold" data-testid="text-news-title">News & Updates</h1>
        <p className="text-sm text-muted-foreground mt-1">Stay up to date with the latest company news</p>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4 flex gap-4">
              <Skeleton className="w-20 h-14 sm:w-28 sm:h-20 rounded-md flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          ))}
        </div>
      ) : !news || news.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Newspaper className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
            <p className="text-muted-foreground">No news stories published yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {news.map((story) => (
            <Link key={story.id} href={`/news/${story.id}`} className="block">
              <Card className="hover-elevate tap-interactive cursor-pointer" data-testid={`card-news-${story.id}`}>
                <CardContent className="flex gap-4 p-4">
                  {story.imageUrl && (
                    <LazyImage
                      src={story.imageUrl}
                      alt=""
                      className="w-20 h-14 sm:w-28 sm:h-20 rounded-md object-contain flex-shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <h3 className="font-semibold text-sm">{story.title}</h3>
                    <p className="text-xs text-muted-foreground line-clamp-2">{story.content}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(story.createdAt), "MMMM d, yyyy")}
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 self-center" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
