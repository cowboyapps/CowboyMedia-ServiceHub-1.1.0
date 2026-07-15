import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ArrowLeft, Calendar, Newspaper } from "lucide-react";
import { ClickableImage, ImageLightbox } from "@/components/image-lightbox";
import { isHtmlContent } from "@/components/rich-text-editor";
import { NewsReactionsBar } from "@/components/news-reactions-bar";
import DOMPurify from "dompurify";
import type { NewsStory } from "@shared/schema";
import { Poll } from "@/components/poll";
import { QueryErrorState } from "@/components/query-error-state";
import { queryClient, TimeoutError } from "@/lib/queryClient";
import { useEffect, useRef, useState } from "react";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { LiveConnectionBanner } from "@/components/live-connection-banner";

export default function NewsDetail() {
  const params = useParams<{ id: string }>();
  const [lightbox, setLightbox] = useState<{ src: string; alt?: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const { data: story, isLoading, isError, error, refetch, isFetching } = useQuery<NewsStory>({
    queryKey: ["/api/news", params.id],
  });

  const { data: polls } = useQuery<{ id: string }[]>({
    queryKey: ["/api/polls", { parentType: "news", parentId: params.id }],
    queryFn: async () => {
      const res = await fetch(`/api/polls?parentType=news&parentId=${params.id}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!params.id,
  });

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !story || !isHtmlContent(story.content)) return;
    const imgs = el.querySelectorAll("img");
    imgs.forEach((img) => {
      if (img.closest("a")) return;
      img.tabIndex = 0;
      img.setAttribute("role", "button");
      if (!img.getAttribute("aria-label")) {
        img.setAttribute("aria-label", img.alt ? `View image: ${img.alt}` : "View image full screen");
      }
      img.style.cursor = "zoom-in";
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [story?.content]);

  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    deps: [params.id],
    onMessage: (event) => {
      try {
        const data = JSON.parse(event.data);
        if ((data.type === "poll_vote" || data.type === "poll_created" || data.type === "poll_deleted") && data.parentType === "news" && data.parentId === params.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/polls", { parentType: "news", parentId: params.id }] });
          if (data.pollId) queryClient.invalidateQueries({ queryKey: ["/api/polls", data.pollId] });
        }
      } catch {}
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <section className="rounded-xl border border-card-border bg-card overflow-hidden">
          <div className="p-6 space-y-4">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-64 rounded-md" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </section>
      </div>
    );
  }

  if (isError) {
    const isNotFound =
      !(error instanceof TimeoutError) && /^(4\d\d):/.test((error as Error)?.message ?? "");
    if (!isNotFound) {
      return (
        <div className="space-y-4 max-w-3xl mx-auto">
          <QueryErrorState
            error={error}
            onRetry={() => refetch()}
            isRetrying={isFetching}
            resourceName="this story"
            data-testid="error-news-detail"
          />
          <div className="text-center">
            <Link href="/news">
              <Button variant="ghost">Back to News</Button>
            </Link>
          </div>
        </div>
      );
    }
  }

  if (!story) {
    return (
      <div className="text-center py-12 max-w-3xl mx-auto">
        <Newspaper className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
        <p className="text-muted-foreground">Story not found</p>
        <Link href="/news">
          <Button variant="ghost" className="mt-2">Back to News</Button>
        </Link>
      </div>
    );
  }

  const isRich = isHtmlContent(story.content);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <LiveConnectionBanner status={wsStatus} />
      <Link href="/news">
        <Button variant="ghost" size="sm" data-testid="button-back-news">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to News
        </Button>
      </Link>

      <section className="rounded-xl border border-card-border bg-card overflow-hidden animate-fade-in">
        {story.imageUrl && (
          <div className="relative border-b border-border">
            <ClickableImage
              src={story.imageUrl}
              alt={story.title}
              className="w-full h-64 object-cover"
            />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
          </div>
        )}
        
        <div className="px-6 py-5 border-b border-border bg-card/50">
          <div className="space-y-3">
            <h1 className="text-2xl font-bold leading-tight" data-testid="text-story-title">{story.title}</h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="w-4 h-4" />
              <span>{format(new Date(story.createdAt), "MMMM d, yyyy 'at' h:mm a")}</span>
            </div>
          </div>
        </div>

        {polls && polls.length > 0 && (
          <div className="px-6 py-5 border-b border-border bg-muted/20 space-y-4">
            {polls.map((p) => (
              <Poll key={p.id} pollId={p.id} />
            ))}
          </div>
        )}

        <div className="p-6">
          {isRich ? (
            <div
              ref={bodyRef}
              className="prose prose-sm dark:prose-invert max-w-none prose-img:rounded-md prose-img:max-w-full"
              data-testid="text-story-content"
              onClick={(e) => {
                const target = e.target as HTMLElement;
                if (target.tagName !== "IMG") return;
                if (target.closest("a")) return;
                const img = target as HTMLImageElement;
                setLightbox({ src: img.currentSrc || img.src, alt: img.alt });
              }}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                const target = e.target as HTMLElement;
                if (target.tagName !== "IMG") return;
                if (target.closest("a")) return;
                e.preventDefault();
                const img = target as HTMLImageElement;
                setLightbox({ src: img.currentSrc || img.src, alt: img.alt });
              }}
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(story.content, { ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"], ALLOWED_ATTR: ["style", "src", "alt", "width", "height", "href", "target"] }) }}
            />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap" data-testid="text-story-content">
              {story.content}
            </div>
          )}
          <ImageLightbox
            src={lightbox?.src || ""}
            alt={lightbox?.alt}
            open={lightbox !== null}
            onOpenChange={(o) => { if (!o) setLightbox(null); }}
          />
        </div>
        
        <div className="px-6 py-4 bg-muted/10 border-t border-border">
          <NewsReactionsBar storyId={story.id} source="detail" />
        </div>
      </section>
    </div>
  );
}
