import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Search } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { KbArticle, KbCategory } from "@shared/schema";

export type KbArticleRef = {
  slug: string;
  title: string;
  categoryName: string | null;
  summary: string | null;
};

export function KbArticlePickerDialog({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (article: KbArticleRef) => void;
}) {
  const [search, setSearch] = useState("");
  const { data: articles = [], isLoading } = useQuery<KbArticle[]>({
    queryKey: ["/api/kb/articles"],
    enabled: open,
  });
  const { data: categories = [] } = useQuery<KbCategory[]>({
    queryKey: ["/api/kb/categories"],
    enabled: open,
  });
  const categoryNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of categories) m.set(c.id, c.name);
    return m;
  }, [categories]);
  const filtered = useMemo(() => {
    const published = articles.filter((a) => a.published);
    const q = search.trim().toLowerCase();
    if (!q) return published;
    return published.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        (a.summary ?? "").toLowerCase().includes(q) ||
        (categoryNameById.get(a.categoryId) ?? "").toLowerCase().includes(q),
    );
  }, [articles, search, categoryNameById]);

  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[calc(100vw-2rem)] sm:max-w-lg max-h-[80vh] flex flex-col"
        data-testid="dialog-kb-picker"
      >
        <DialogHeader>
          <DialogTitle>Link a knowledge base article</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search articles..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-kb-picker-search"
            autoFocus
          />
        </div>
        <div className="flex-1 overflow-y-auto -mx-2 px-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading articles...</p>
          ) : filtered.length === 0 ? (
            <p
              className="text-sm text-muted-foreground text-center py-8"
              data-testid="text-kb-picker-empty"
            >
              {search.trim()
                ? `No articles match "${search}".`
                : "No published articles available."}
            </p>
          ) : (
            <div className="space-y-1">
              {filtered.map((a) => {
                const categoryName = categoryNameById.get(a.categoryId) ?? null;
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() =>
                      onSelect({
                        slug: a.slug,
                        title: a.title,
                        categoryName,
                        summary: a.summary ?? null,
                      })
                    }
                    className="w-full text-left p-2.5 rounded-md border hover-elevate tap-interactive"
                    data-testid={`button-kb-pick-${a.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <BookOpen className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{a.title}</p>
                        {categoryName && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            {categoryName}
                          </p>
                        )}
                        {a.summary && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {a.summary}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
