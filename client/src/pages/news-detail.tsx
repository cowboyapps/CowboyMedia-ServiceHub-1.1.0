import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { ArrowLeft, Calendar } from "lucide-react";
import { ClickableImage } from "@/components/image-lightbox";
import type { NewsStory } from "@shared/schema";

export default function NewsDetail() {
  const params = useParams<{ id: string }>();

  const { data: story, isLoading } = useQuery<NewsStory>({
    queryKey: ["/api/news", params.id],
  });

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
          className="w-full h-64 object-cover rounded-md"
        />
      )}

      <div className="space-y-3">
        <h1 className="text-2xl font-bold" data-testid="text-story-title">{story.title}</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="w-4 h-4" />
          <span>{format(new Date(story.createdAt), "MMMM d, yyyy 'at' h:mm a")}</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap" data-testid="text-story-content">
            {story.content}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
