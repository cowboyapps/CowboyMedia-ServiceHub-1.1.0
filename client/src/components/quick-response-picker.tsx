import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Zap, Search, Star, Clock, Hash, AlertTriangle } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  applyQuickResponseVariables,
  recordQuickResponseInsertion,
  tokenizeQuickResponseTemplate,
  QUICK_RESPONSE_RECENT_MAX,
  type QuickResponseVarContext,
} from "@shared/quick-response-vars";
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
  /** Optional controlled open state (used when the picker is launched from an external menu). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Hide the built-in Zap trigger button (an invisible anchor is rendered instead). */
  hideTrigger?: boolean;
};

export function QuickResponsePicker({ adminId, context, onInsert, open: controlledOpen, onOpenChange, hideTrigger }: QuickResponsePickerProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const setOpen = (o: boolean) => {
    setUncontrolledOpen(o);
    onOpenChange?.(o);
  };
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

  const renderPreview = (qr: QuickResponse) => {
    const segments = tokenizeQuickResponseTemplate(qr.message, context);
    const missingVars = Array.from(
      new Set(
        segments.flatMap((s) => (s.kind === "missing" ? [s.variable] : [])),
      ),
    );
    return (
      <div data-testid={`picker-preview-${qr.id}`} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Preview
          </p>
          {missingVars.length > 0 && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-700 dark:text-amber-400"
              data-testid={`picker-preview-missing-${qr.id}`}
            >
              <AlertTriangle className="w-3 h-3" />
              {missingVars.length} unfilled
            </span>
          )}
        </div>
        <p className="text-sm whitespace-pre-wrap break-words leading-snug">
          {segments.length === 0 ? (
            <span className="text-muted-foreground italic">(empty)</span>
          ) : (
            segments.map((seg, i) => {
              if (seg.kind === "text") return <span key={i}>{seg.value}</span>;
              if (seg.kind === "filled") return <span key={i}>{seg.value}</span>;
              if (seg.kind === "unknown") {
                return (
                  <span
                    key={i}
                    className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {seg.raw}
                  </span>
                );
              }
              return (
                <span
                  key={i}
                  className="rounded-sm bg-amber-100 px-1 py-0.5 font-mono text-[11px] text-amber-900 ring-1 ring-amber-300 dark:bg-amber-500/20 dark:text-amber-200 dark:ring-amber-500/40"
                  data-testid={`picker-preview-placeholder-${qr.id}-${seg.variable}`}
                  title={`No value for {{${seg.variable}}} in this ticket`}
                >
                  {seg.raw}
                </span>
              );
            })
          )}
        </p>
        {missingVars.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Highlighted placeholders will be sent as-is unless filled in.
          </p>
        )}
      </div>
    );
  };

  const renderItem = (qr: QuickResponse) => {
    const isFav = favSet.has(qr.id);
    const hasMissing = tokenizeQuickResponseTemplate(qr.message, context).some(
      (s) => s.kind === "missing",
    );
    return (
      <HoverCard key={qr.id} openDelay={120} closeDelay={60}>
        <HoverCardTrigger asChild>
          <div
            className="group flex items-start gap-2 px-2 py-2 rounded-md hover-elevate cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => handleInsert(qr)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleInsert(qr);
              }
            }}
            tabIndex={0}
            role="button"
            data-testid={`picker-item-${qr.id}`}
          >
            <button
              type="button"
              className="mt-0.5 flex-shrink-0 text-muted-foreground hover:text-amber-500"
              onClick={(e) => {
                e.stopPropagation();
                favoriteMutation.mutate({ id: qr.id, on: !isFav });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                }
              }}
              aria-label={isFav ? "Unfavorite" : "Favorite"}
              data-testid={`picker-fav-${qr.id}`}
            >
              <Star className={`w-3.5 h-3.5 ${isFav ? "fill-amber-400 text-amber-500" : ""}`} />
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-medium truncate" data-testid={`picker-title-${qr.id}`}>{qr.title}</p>
                {hasMissing && (
                  <AlertTriangle
                    className="w-3 h-3 flex-shrink-0 text-amber-500"
                    aria-label="Has unfilled placeholders"
                    data-testid={`picker-item-warning-${qr.id}`}
                  />
                )}
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-wrap break-words">{qr.message}</p>
            </div>
          </div>
        </HoverCardTrigger>
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-80"
        >
          {renderPreview(qr)}
        </HoverCardContent>
      </HoverCard>
    );
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {hideTrigger ? (
          <span className="absolute bottom-0 left-0 w-px h-px pointer-events-none" aria-hidden="true" data-testid="anchor-quick-responses" />
        ) : (
          <Button type="button" size="icon" variant="ghost" className="flex-shrink-0 h-9 w-9 sm:h-10 sm:w-10" data-testid="button-quick-responses">
            <Zap className="w-4 h-4" />
          </Button>
        )}
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
