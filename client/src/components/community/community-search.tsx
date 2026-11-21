import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, X, MessageSquare, Image as ImageIcon, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommunityMessage } from "@shared/schema";
import { useDebounce } from "@/hooks/use-debounce";

type SearchResponse = { messages: CommunityMessage[]; truncated: boolean };
export const COMMUNITY_SEARCH_QUERY_KEY = ["/api/community-chat/search"];

export function CommunitySearch({ onPreview }: { onPreview: (message: CommunityMessage) => void }) {
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const term = useDebounce(query.trim(), 300);
  const valid = term.length >= 2 && term.length <= 120;
  const key = useMemo(() => [...COMMUNITY_SEARCH_QUERY_KEY, term, 25], [term]);
  const search = useQuery<SearchResponse>({
    queryKey: key,
    enabled: expanded && valid,
    queryFn: async ({ signal }) => {
      const response = await fetch(`/api/community-chat/search?q=${encodeURIComponent(term)}&limit=25`, {
        credentials: "include",
        signal,
      });
      if (!response.ok) throw new Error("Could not search messages");
      return response.json();
    },
  });
  return (
    <section className="border-b border-border px-3 py-2 sm:px-4" data-testid="community-search">
      {!expanded ? (
        <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(true)}
          aria-label="Search community messages" className="h-8 gap-2 px-2 text-muted-foreground" data-testid="button-open-community-search">
          <Search className="h-4 w-4" />Search messages
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <Input autoFocus value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)}
              placeholder="Search 2–120 characters" aria-label="Search community messages"
              data-testid="input-community-search" className="h-9" />
            <Button type="button" variant="ghost" size="icon" aria-label="Close message search"
              onClick={() => {
                setExpanded(false);
                setQuery("");
                void queryClient.cancelQueries({ queryKey: COMMUNITY_SEARCH_QUERY_KEY });
              }} data-testid="button-close-community-search">
              <X className="h-4 w-4" />
            </Button>
          </div>
          {term.length > 0 && term.length < 2 && <p className="pl-6 text-xs text-muted-foreground">Enter at least 2 characters.</p>}
          {valid && (
            <div className="max-h-64 space-y-1 overflow-y-auto pl-6" aria-live="polite" data-testid="community-search-results">
              {search.isLoading ? <div className="space-y-2 py-1" aria-label="Loading search results">
                <Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
              </div> : search.isError ? (
                <div className="flex items-center justify-between gap-2 rounded-md bg-destructive/5 p-2 text-sm text-destructive" role="alert">
                  <span>Search couldn’t load. Try again.</span>
                  <Button variant="outline" size="sm" onClick={() => void search.refetch()}><RotateCw className="mr-1.5 h-3.5 w-3.5" />Retry</Button>
                </div>
              ) : search.data?.messages.length ? (
                <>
                  {search.data.messages.map((item) => (
                    <button type="button" key={item.id} onClick={() => onPreview(item)}
                      className="flex w-full items-start gap-2 rounded-lg border border-border/70 bg-background/70 px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      data-testid={`community-search-result-${item.id}`}>
                      {item.imageUrl && <ImageIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Has photo" />}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-xs">
                          <strong className="truncate">{item.chatUsername}</strong>
                          <time className="shrink-0 text-muted-foreground">{new Date(item.createdAt).toLocaleString()}</time>
                        </span>
                        <span className="mt-0.5 block truncate text-sm text-muted-foreground">
                          {item.content || (item.imageUrl ? "Photo" : item.newsArticleId ? "News article" : item.kbArticleSlug ? "Knowledge Base article" : "Message")}
                        </span>
                      </span>
                      <MessageSquare className="mt-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                  {search.data.truncated && <p className="py-1 text-center text-xs text-muted-foreground">Showing the 25 newest matches.</p>}
                </>
              ) : (
                <p className="rounded-md bg-muted/60 px-3 py-3 text-sm text-muted-foreground" data-testid="community-search-empty">
                  No messages match “{term}”.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
