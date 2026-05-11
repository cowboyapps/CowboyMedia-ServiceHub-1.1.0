import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Zap, Search, Star, Clock, Hash } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { applyQuickResponseVariables, recordQuickResponseInsertion, QUICK_RESPONSE_RECENT_MAX, type QuickResponseVarContext } from "@shared/quick-response-vars";
import type { QuickResponse, QuickResponseCategory } from "@shared/schema";

const RECENT_KEY_PREFIX = "sh-qr-recent-";

function readRecent(adminId: string): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY_PREFIX + adminId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeRecent(adminId: string, ids: string[]) {
  try {
    localStorage.setItem(RECENT_KEY_PREFIX + adminId, JSON.stringify(ids.slice(0, QUICK_RESPONSE_RECENT_MAX)));
  } catch {}
}

export type QuickResponsePickerProps = {
  adminId: string;
  context: QuickResponseVarContext;
  /** Insert handler. Must return true when the text was actually inserted, false if the user cancelled. */
  onInsert: (text: string) => boolean;
};

export function QuickResponsePicker({ adminId, context, onInsert }: QuickResponsePickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<string>("all");
  const [recent, setRecent] = useState<string[]>(() => readRecent(adminId));

  useEffect(() => {
    if (open) setRecent(readRecent(adminId));
  }, [open, adminId]);

  const { data: responses } = useQuery<QuickResponse[]>({
    queryKey: ["/api/quick-responses"],
    enabled: open,
  });
  const { data: categories } = useQuery<QuickResponseCategory[]>({
    queryKey: ["/api/quick-response-categories"],
    enabled: open,
  });
  const { data: favorites } = useQuery<string[]>({
    queryKey: ["/api/quick-responses/favorites"],
    enabled: open,
  });

  const useMutationFn = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("POST", `/api/quick-responses/${id}/use`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses"] });
    },
  });

  const favoriteMutation = useMutation({
    mutationFn: async ({ id, on }: { id: string; on: boolean }) => {
      if (on) await apiRequest("POST", `/api/quick-responses/${id}/favorite`);
      else await apiRequest("DELETE", `/api/quick-responses/${id}/favorite`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quick-responses/favorites"] });
    },
  });

  const favSet = useMemo(() => new Set(favorites ?? []), [favorites]);

  const filtered = useMemo(() => {
    const list = responses ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((qr) => {
      if (!q) return true;
      return qr.title.toLowerCase().includes(q) || qr.message.toLowerCase().includes(q);
    });
  }, [responses, search]);

  const recentItems = useMemo(() => {
    const map = new Map((responses ?? []).map((r) => [r.id, r]));
    return recent.map((id) => map.get(id)).filter(Boolean) as QuickResponse[];
  }, [recent, responses]);

  const itemsForTab = useMemo(() => {
    if (tab === "all") return filtered;
    if (tab === "uncategorized") return filtered.filter((qr) => !qr.categoryId);
    return filtered.filter((qr) => qr.categoryId === tab);
  }, [tab, filtered]);

  const favoriteItems = useMemo(
    () => itemsForTab.filter((qr) => favSet.has(qr.id)),
    [itemsForTab, favSet],
  );

  const nonFavoriteItems = useMemo(
    () => itemsForTab.filter((qr) => !favSet.has(qr.id)),
    [itemsForTab, favSet],
  );

  const handleInsert = (qr: QuickResponse) => {
    const text = applyQuickResponseVariables(qr.message, context);
    const inserted = onInsert(text);
    recordQuickResponseInsertion({
      inserted,
      id: qr.id,
      recent,
      bumpUsage: (id) => useMutationFn.mutate(id),
      saveRecent: (next) => { setRecent(next); writeRecent(adminId, next); },
      closePicker: () => setOpen(false),
    });
  };

  const renderItem = (qr: QuickResponse) => {
    const isFav = favSet.has(qr.id);
    return (
      <div
        key={qr.id}
        className="group flex items-start gap-2 px-2 py-2 rounded-md hover-elevate cursor-pointer"
        onClick={() => handleInsert(qr)}
        data-testid={`picker-item-${qr.id}`}
      >
        <button
          type="button"
          className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-amber-500"
          onClick={(e) => {
            e.stopPropagation();
            favoriteMutation.mutate({ id: qr.id, on: !isFav });
          }}
          aria-label={isFav ? "Unfavorite" : "Favorite"}
          data-testid={`picker-fav-${qr.id}`}
        >
          <Star className={`w-3.5 h-3.5 ${isFav ? "fill-amber-400 text-amber-500" : ""}`} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate" data-testid={`picker-title-${qr.id}`}>{qr.title}</p>
          <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">{qr.message}</p>
        </div>
      </div>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10" data-testid="button-quick-responses">
          <Zap className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(420px,calc(100vw-1rem))] p-0">
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search responses..."
              className="h-8 pl-7 text-xs"
              data-testid="input-picker-search"
              autoFocus
            />
          </div>
        </div>
        <Tabs value={tab} onValueChange={setTab} className="flex flex-col">
          <ScrollArea className="w-full">
            <TabsList className="h-9 bg-transparent border-b rounded-none w-full justify-start gap-0.5 px-1 overflow-x-auto flex-nowrap">
              <TabsTrigger value="all" className="h-7 text-xs gap-1" data-testid="tab-all">All</TabsTrigger>
              {(categories ?? []).map((c) => (
                <TabsTrigger key={c.id} value={c.id} className="h-7 text-xs gap-1" data-testid={`tab-${c.id}`}>
                  <Hash className="w-3 h-3" />{c.name}
                </TabsTrigger>
              ))}
              <TabsTrigger value="uncategorized" className="h-7 text-xs gap-1" data-testid="tab-uncategorized">Uncategorized</TabsTrigger>
            </TabsList>
          </ScrollArea>
          <TabsContent value={tab} className="m-0">
            <ScrollArea className="max-h-[320px]">
              <div className="p-1 space-y-2">
                {favoriteItems.length > 0 && (
                  <div>
                    <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Star className="w-3 h-3 fill-amber-400 text-amber-500" /> Favorites
                    </p>
                    <div data-testid="picker-favorites">{favoriteItems.map(renderItem)}</div>
                  </div>
                )}
                {recentItems.length > 0 && !search.trim() && tab === "all" && (
                  <div>
                    <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" /> Recent
                    </p>
                    <div data-testid="picker-recent">{recentItems.map(renderItem)}</div>
                  </div>
                )}
                <div>
                  {(favoriteItems.length > 0 || (recentItems.length > 0 && !search.trim() && tab === "all")) && nonFavoriteItems.length > 0 && (
                    <p className="px-2 pt-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      All
                    </p>
                  )}
                  {itemsForTab.length === 0 ? (
                    <p className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="picker-empty">
                      {search.trim() ? "No matching responses." : "No responses in this category."}
                    </p>
                  ) : (
                    nonFavoriteItems.map(renderItem)
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
