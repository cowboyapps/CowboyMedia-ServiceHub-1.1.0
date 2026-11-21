import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Newspaper, RotateCw, Search } from "lucide-react";
import type { NewsArticleRef } from "@shared/news-attachments";
import { htmlToPlainTextInline } from "@shared/html-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type NewsStory = NewsArticleRef & {
  content: string;
  imageUrl: string | null;
  createdAt: string;
};

export function NewsArticlePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (article: NewsArticleRef) => void;
}) {
  const [search, setSearch] = useState("");
  const query = useQuery<NewsStory[]>({
    queryKey: ["/api/news"],
    enabled: open,
    staleTime: 30_000,
  });
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return (query.data ?? []).filter(article => !term || article.title.toLocaleLowerCase().includes(term));
  }, [query.data, search]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(80dvh,42rem)] w-[calc(100vw-2rem)] flex-col overflow-hidden sm:max-w-lg" data-testid="dialog-news-picker">
        <DialogHeader className="shrink-0">
          <DialogTitle>Share a news article</DialogTitle>
        </DialogHeader>
        <div className="relative shrink-0">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={search} onChange={event => setSearch(event.target.value)} className="pl-9"
            placeholder="Search news…" aria-label="Search news articles" data-testid="input-news-picker-search" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain -mx-2 px-2" tabIndex={0} aria-label="News articles">
          {query.isLoading ? (
            <div className="space-y-2 py-2" aria-label="Loading news articles">
              <Skeleton className="h-[4.5rem] w-full" /><Skeleton className="h-[4.5rem] w-full" /><Skeleton className="h-[4.5rem] w-full" />
            </div>
          ) : query.isError ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center" role="alert">
              <p className="text-sm text-muted-foreground">News articles couldn’t load.</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()} disabled={query.isFetching} data-testid="button-news-picker-retry">
                <RotateCw className="mr-1.5 h-3.5 w-3.5" />{query.isFetching ? "Trying again…" : "Try again"}
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="text-news-picker-empty">
              {search.trim() ? `No news articles match “${search.trim()}”.` : "No news articles are available."}
            </p>
          ) : (
            <div className="space-y-1 py-1">
              {filtered.map(article => (
                <button key={article.id} type="button" onClick={() => { onSelect({ id: article.id, title: article.title }); onOpenChange(false); }}
                  className="flex w-full items-start gap-2.5 rounded-md border border-border/70 p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  data-testid={`button-news-pick-${article.id}`}>
                  <Newspaper className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{article.title}</span>
                    <span className="mt-1 block line-clamp-2 text-xs text-muted-foreground">{htmlToPlainTextInline(article.content)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
