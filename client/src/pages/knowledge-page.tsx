import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link, useLocation } from "wouter";
import DOMPurify from "dompurify";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ArrowLeft, BookOpen, ChevronDown, ChevronRight, Eye, LifeBuoy, Search, ThumbsDown, ThumbsUp } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import type { KbArticle, KbCategory } from "@shared/schema";

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "span", "img", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a", "code", "pre"];
const ALLOWED_ATTR = ["style", "src", "alt", "width", "height", "href", "target", "rel"];

function ArticleDetail({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [voted, setVoted] = useState<"up" | "down" | null>(null);

  const { data: article, isLoading, error } = useQuery<KbArticle>({
    queryKey: ["/api/kb/articles", slug],
  });

  const helpfulMutation = useMutation({
    mutationFn: async (helpful: boolean) => {
      const res = await apiRequest("POST", `/api/kb/articles/${slug}/helpful`, { helpful });
      return res.json();
    },
    onSuccess: (_data, helpful) => {
      setVoted(helpful ? "up" : "down");
      queryClient.invalidateQueries({ queryKey: ["/api/kb/articles", slug] });
      toast({ title: "Thanks for your feedback!" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-60" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Article not found</p>
        <Link href="/knowledge">
          <Button variant="ghost" className="mt-2" data-testid="button-back-knowledge">
            Back to Knowledge Base
          </Button>
        </Link>
      </div>
    );
  }

  const safeHtml = DOMPurify.sanitize(article.bodyHtml, { ALLOWED_TAGS, ALLOWED_ATTR });

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <Link href="/knowledge">
        <Button variant="ghost" size="sm" data-testid="button-back-knowledge">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back to Knowledge Base
        </Button>
      </Link>

      <div className="space-y-3">
        <h1 className="text-2xl font-bold" data-testid="text-kb-article-title">{article.title}</h1>
        {article.summary && (
          <p className="text-sm text-muted-foreground" data-testid="text-kb-article-summary">{article.summary}</p>
        )}
        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1" data-testid="text-kb-article-views">
            <Eye className="w-3.5 h-3.5" /> {article.viewCount} views
          </span>
          {article.tags?.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {article.tags.map((t) => (
                <Badge key={t} variant="secondary" className="text-[10px]" data-testid={`badge-kb-tag-${t}`}>{t}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          <div
            className="prose prose-sm dark:prose-invert max-w-none prose-img:rounded-md prose-img:max-w-full"
            data-testid="text-kb-article-body"
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Was this article helpful?</p>
            <p className="text-xs text-muted-foreground">
              {article.helpfulCount} found this helpful · {article.unhelpfulCount} did not
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={voted === "up" ? "default" : "outline"}
              disabled={helpfulMutation.isPending || voted !== null}
              onClick={() => helpfulMutation.mutate(true)}
              data-testid="button-kb-helpful-yes"
            >
              <ThumbsUp className="w-4 h-4 mr-1" /> Yes
            </Button>
            <Button
              size="sm"
              variant={voted === "down" ? "default" : "outline"}
              disabled={helpfulMutation.isPending || voted !== null}
              onClick={() => helpfulMutation.mutate(false)}
              data-testid="button-kb-helpful-no"
            >
              <ThumbsDown className="w-4 h-4 mr-1" /> No
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <LifeBuoy className="w-5 h-5 text-primary" />
            <p className="text-sm">Still need help? Open a support ticket and we'll get back to you.</p>
          </div>
          <Button size="sm" onClick={() => setLocation("/tickets")} data-testid="button-kb-open-ticket">
            Open a ticket
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function KnowledgeIndex() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 250);
  const [openCategoryIds, setOpenCategoryIds] = useState<Set<string>>(new Set());

  const { data: categories = [], isLoading: catsLoading } = useQuery<KbCategory[]>({
    queryKey: ["/api/kb/categories"],
  });

  const { data: articles = [], isLoading: articlesLoading } = useQuery<KbArticle[]>({
    queryKey: debouncedSearch.trim()
      ? ["/api/kb/articles", { search: debouncedSearch.trim() }]
      : ["/api/kb/articles"],
    queryFn: async () => {
      const url = debouncedSearch.trim()
        ? `/api/kb/articles?search=${encodeURIComponent(debouncedSearch.trim())}`
        : "/api/kb/articles";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const isSearching = !!debouncedSearch.trim();

  const grouped = useMemo(() => {
    const map = new Map<string, KbArticle[]>();
    for (const a of articles) {
      const arr = map.get(a.categoryId) ?? [];
      arr.push(a);
      map.set(a.categoryId, arr);
    }
    return map;
  }, [articles]);

  const toggleCategory = (id: string) => {
    setOpenCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const visibleCategories = isSearching
    ? categories.filter((c) => (grouped.get(c.id)?.length ?? 0) > 0)
    : categories;

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" data-testid="text-kb-title">
          <BookOpen className="w-6 h-6" /> Knowledge Base
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Browse articles and answers to common questions.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search articles..."
          className="pl-9"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          data-testid="input-kb-search"
        />
      </div>

      {(catsLoading || articlesLoading) ? (
        <div className="space-y-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : isSearching ? (
        articles.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No articles match "{debouncedSearch}".
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2" data-testid="list-kb-search-results">
            {articles.map((a) => {
              const cat = categories.find((c) => c.id === a.categoryId);
              return (
                <Link key={a.id} href={`/knowledge/${a.slug}`}>
                  <Card className="hover-elevate tap-interactive cursor-pointer" data-testid={`card-kb-article-${a.id}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="font-medium text-sm">{a.title}</p>
                          {a.summary && <p className="text-xs text-muted-foreground line-clamp-2">{a.summary}</p>}
                          {cat && <Badge variant="outline" className="text-[10px] mt-1">{cat.name}</Badge>}
                        </div>
                        <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-0.5" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )
      ) : visibleCategories.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No articles available yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleCategories.map((cat) => {
            const items = grouped.get(cat.id) ?? [];
            const isOpen = openCategoryIds.has(cat.id);
            return (
              <Card key={cat.id} data-testid={`card-kb-category-${cat.id}`}>
                <Collapsible open={isOpen} onOpenChange={() => toggleCategory(cat.id)}>
                  <CollapsibleTrigger asChild>
                    <button
                      className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-accent/30 rounded-lg tap-interactive"
                      data-testid={`button-kb-category-${cat.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{cat.name}</p>
                        {cat.description && <p className="text-xs text-muted-foreground mt-0.5">{cat.description}</p>}
                        <p className="text-[11px] text-muted-foreground mt-1">{items.length} article{items.length === 1 ? "" : "s"}</p>
                      </div>
                      {isOpen ? <ChevronDown className="w-4 h-4 flex-shrink-0" /> : <ChevronRight className="w-4 h-4 flex-shrink-0" />}
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="px-4 pb-4 space-y-1">
                      {items.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">No articles in this category.</p>
                      ) : (
                        items.map((a) => (
                          <Link key={a.id} href={`/knowledge/${a.slug}`}>
                            <button
                              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-accent/50 tap-interactive text-left"
                              data-testid={`link-kb-article-${a.id}`}
                            >
                              <div className="min-w-0">
                                <p className="text-sm">{a.title}</p>
                                {a.summary && <p className="text-xs text-muted-foreground line-clamp-1">{a.summary}</p>}
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                            </button>
                          </Link>
                        ))
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function KnowledgePage() {
  const params = useParams<{ slug?: string }>();
  if (params.slug) return <ArticleDetail slug={params.slug} />;
  return <KnowledgeIndex />;
}
