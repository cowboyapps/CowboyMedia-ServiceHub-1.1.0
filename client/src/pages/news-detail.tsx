import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ArrowLeft, Calendar } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import { isHtmlContent } from "@/components/rich-text-editor";
import { NewsReactionsBar } from "@/components/news-reactions-bar";
import DOMPurify from "dompurify";
import type { NewsStory } from "@shared/schema";
import { Poll } from "@/components/poll";
import { queryClient } from "@/lib/queryClient";
import { useEffect } from "react";

export default function NewsDetail() {
  const params = useParams<{ id: string }>();

  const { data: story, isLoading } = useQuery<NewsStory>({
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if ((data.type === "poll_vote" || data.type === "poll_created" || data.type === "poll_deleted") && data.parentType === "news" && data.parentId === params.id) {
          queryClient.invalidateQueries({ queryKey: ["/api/polls", { parentType: "news", parentId: params.id }] });
          if (data.pollId) queryClient.invalidateQueries({ queryKey: ["/api/polls", data.pollId] });
        }
      } catch {}
    };
    return () => ws.close();
  }, [params.id]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (!story) {
    return (
      <div className="text-center py-12">
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
      <Link href="/news">
        <Button variant="ghost" size="sm" data-testid="button-back-news">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to News
        </Button>
      </Link>

      {story.imageUrl && (
        <ClickableImage
          src={story.imageUrl}
          alt={story.title}
          className="w-full h-64 object-contain rounded-md"
        />
      )}

      <div className="space-y-3">
        <h1 className="text-2xl font-bold" data-testid="text-story-title">{story.title}</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>{format(new Date(story.createdAt), "MMMM d, yyyy 'at' h:mm a")}</span>
        </div>
      </div>

      {polls && polls.length > 0 && (
        <div className="space-y-3">
          {polls.map((p) => (
            <Poll key={p.id} pollId={p.id} />
          ))}
        </div>
      )}

      <Card>
        <CardContent className="p-6">
          {isRich ? (
            <div
              className="prose prose-sm dark:prose-invert max-w-none prose-img:rounded-md prose-img:max-w-full"
              data-testid="text-story-content"
              dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(story.content, { ALLOWED_TAGS: ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a"], ALLOWED_ATTR: ["style", "src", "alt", "width", "height", "href", "target"] }) }}
            />
          ) : (
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap" data-testid="text-story-content">
              {story.content}
            </div>
          )}
        </CardContent>
      </Card>

      <NewsReactionsBar storyId={story.id} source="detail" />
    </div>
  );
}
