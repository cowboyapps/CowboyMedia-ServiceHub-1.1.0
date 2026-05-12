import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { NEWS_REACTION_EMOJIS } from "@shared/schema";

export type NewsReactionGroup = { emoji: string; count: number; mine: boolean };

type Props = {
  storyId: string;
  source: "list" | "detail";
};

export function NewsReactionsBar({ storyId, source }: Props) {
  const { user } = useAuth();

  const listQueryKey = ["/api/news/reactions/all"] as const;
  const detailQueryKey = ["/api/news", storyId, "reactions"] as const;

  const { data: allReactions } = useQuery<Record<string, NewsReactionGroup[]>>({
    queryKey: listQueryKey,
    enabled: !!user && source === "list",
  });

  const { data: detailReactions } = useQuery<NewsReactionGroup[]>({
    queryKey: detailQueryKey,
    queryFn: async () => {
      const res = await fetch(`/api/news/${storyId}/reactions`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load reactions");
      return res.json();
    },
    enabled: !!user && source === "detail",
  });

  const groups: NewsReactionGroup[] =
    source === "detail" ? (detailReactions ?? []) : (allReactions?.[storyId] ?? []);

  const toggle = useMutation({
    mutationFn: async (emoji: string) => {
      const res = await apiRequest("POST", `/api/news/${storyId}/reactions`, { emoji });
      return (await res.json()) as { added: boolean; reactions: NewsReactionGroup[] };
    },
    onMutate: async (emoji: string) => {
      const apply = (current: NewsReactionGroup[] | undefined): NewsReactionGroup[] => {
        const list = current ? current.map(g => ({ ...g })) : [];
        const idx = list.findIndex(g => g.emoji === emoji);
        if (idx === -1) {
          list.push({ emoji, count: 1, mine: true });
        } else {
          const g = list[idx];
          if (g.mine) {
            g.count -= 1;
            g.mine = false;
            if (g.count <= 0) list.splice(idx, 1);
          } else {
            g.count += 1;
            g.mine = true;
          }
        }
        return list;
      };

      await queryClient.cancelQueries({ queryKey: listQueryKey });
      await queryClient.cancelQueries({ queryKey: detailQueryKey });
      const prevList = queryClient.getQueryData<Record<string, NewsReactionGroup[]>>(listQueryKey);
      const prevDetail = queryClient.getQueryData<NewsReactionGroup[]>(detailQueryKey);

      if (prevList !== undefined) {
        queryClient.setQueryData<Record<string, NewsReactionGroup[]>>(listQueryKey, {
          ...prevList,
          [storyId]: apply(prevList[storyId]),
        });
      }
      if (prevDetail !== undefined) {
        queryClient.setQueryData<NewsReactionGroup[]>(detailQueryKey, apply(prevDetail));
      }
      return { prevList, prevDetail };
    },
    onError: (_err, _emoji, ctx) => {
      if (ctx?.prevList !== undefined) queryClient.setQueryData(listQueryKey, ctx.prevList);
      if (ctx?.prevDetail !== undefined) queryClient.setQueryData(detailQueryKey, ctx.prevDetail);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listQueryKey });
      queryClient.invalidateQueries({ queryKey: detailQueryKey });
    },
  });

  if (!user) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      data-testid={`news-reactions-${storyId}`}
    >
      {NEWS_REACTION_EMOJIS.map(emoji => {
        const g = groups.find(x => x.emoji === emoji);
        const mine = !!g?.mine;
        const count = g?.count ?? 0;
        return (
          <button
            key={emoji}
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggle.mutate(emoji);
            }}
            disabled={toggle.isPending}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors",
              "hover-elevate tap-interactive",
              mine
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-border bg-background text-muted-foreground",
            )}
            aria-pressed={mine}
            aria-label={`React with ${emoji}${count > 0 ? `, ${count} so far` : ""}`}
            data-testid={`button-news-react-${storyId}-${emoji}`}
          >
            <span aria-hidden>{emoji}</span>
            {count > 0 && (
              <span className="tabular-nums" data-testid={`text-news-react-count-${storyId}-${emoji}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
