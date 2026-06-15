import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { serverActionErrorMessage } from "@/lib/server-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Trash2, Lock, Clock } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface PollData {
  id: string;
  parentType: string;
  parentId: string;
  question: string;
  multiSelect: boolean;
  closesAt: string | null;
  createdBy: string;
  createdAt: string;
  options: { id: string; text: string; sortOrder: number }[];
  counts: Record<string, number>;
  totalVotes: number;
  userVotes: string[];
}

export function Poll({ pollId, onDeleted, compact }: { pollId: string; onDeleted?: () => void; compact?: boolean }) {
  const { user, isAdmin } = useAuth();
  const { toast } = useToast();
  const [pendingSelection, setPendingSelection] = useState<string[] | null>(null);

  const { data: poll, isLoading } = useQuery<PollData>({
    queryKey: ["/api/polls", pollId],
  });

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!poll?.closesAt) return;
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [poll?.closesAt]);

  const isClosed = useMemo(() => {
    if (!poll?.closesAt) return false;
    return new Date(poll.closesAt).getTime() <= now;
  }, [poll?.closesAt, now]);

  const voteMutation = useMutation({
    mutationFn: async (optionIds: string[]) => {
      const res = await apiRequest("POST", `/api/polls/${pollId}/vote`, { optionIds });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/polls", pollId], data);
      setPendingSelection(null);
    },
    onError: (e: Error) => {
      toast({ title: "Vote failed", description: serverActionErrorMessage(e, "Couldn't record your vote. Please try again."), variant: "destructive" });
      setPendingSelection(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/polls/${pollId}`);
    },
    onSuccess: () => {
      toast({ title: "Poll deleted" });
      onDeleted?.();
    },
    onError: (e: Error) => toast({ title: "Delete failed", description: serverActionErrorMessage(e, "Couldn't delete the poll. Please try again."), variant: "destructive" }),
  });

  // Optimistic counts: subtract previously-voted options, add pending selections.
  // Hooks must run on every render, so these stay above the early returns below
  // and tolerate `poll` being undefined while the query loads.
  const counts = useMemo(() => {
    const next: Record<string, number> = { ...(poll?.counts ?? {}) };
    if (poll && pendingSelection) {
      for (const id of poll.userVotes) next[id] = Math.max(0, (next[id] || 0) - 1);
      for (const id of pendingSelection) next[id] = (next[id] || 0) + 1;
    }
    return next;
  }, [poll, pendingSelection]);
  const total = useMemo(() => Object.values(counts).reduce((a, b) => a + b, 0), [counts]);

  if (isLoading) return <Skeleton className="h-32 w-full" />;
  if (!poll) return null;

  const userVotes = pendingSelection ?? poll.userVotes;

  const handleToggle = (optionId: string) => {
    if (isClosed || !user) return;
    let next: string[];
    if (poll.multiSelect) {
      next = userVotes.includes(optionId)
        ? userVotes.filter(id => id !== optionId)
        : [...userVotes, optionId];
    } else {
      next = userVotes.includes(optionId) ? [] : [optionId];
    }
    setPendingSelection(next);
    voteMutation.mutate(next);
  };

  return (
    <Card className={`p-4 space-y-3 ${compact ? "" : ""}`} data-testid={`poll-${pollId}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 flex-1 min-w-0">
          <BarChart3 className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm break-words" data-testid={`poll-question-${pollId}`}>{poll.question}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] text-muted-foreground">
                {poll.multiSelect ? "Multiple choice" : "Single choice"} · {total} {total === 1 ? "vote" : "votes"}
              </span>
              {poll.closesAt && (
                <span className="text-[11px] text-muted-foreground inline-flex items-center gap-0.5">
                  {isClosed ? <Lock className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
                  {isClosed
                    ? `Closed ${formatDistanceToNow(new Date(poll.closesAt), { addSuffix: true })}`
                    : `Closes ${formatDistanceToNow(new Date(poll.closesAt), { addSuffix: true })}`}
                </span>
              )}
            </div>
          </div>
        </div>
        {isAdmin && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 flex-shrink-0"
            onClick={() => {
              if (confirm("Delete this poll?")) deleteMutation.mutate();
            }}
            disabled={deleteMutation.isPending}
            data-testid={`button-delete-poll-${pollId}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>

      <div className="space-y-1.5">
        {poll.options.map((opt) => {
          const count = counts[opt.id] || 0;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          const selected = userVotes.includes(opt.id);
          const disabled = isClosed || voteMutation.isPending || !user;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => handleToggle(opt.id)}
              disabled={disabled}
              className={`relative w-full text-left rounded-md border overflow-hidden transition-colors ${
                selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
              } ${disabled && !selected ? "cursor-default" : ""}`}
              data-testid={`poll-option-${pollId}-${opt.id}`}
            >
              <div
                className={`absolute inset-y-0 left-0 transition-all ${selected ? "bg-primary/15" : "bg-muted"}`}
                style={{ width: `${pct}%` }}
              />
              <div className="relative flex items-center justify-between gap-2 px-3 py-2">
                <span className="text-sm break-words flex-1 min-w-0">
                  {selected && <span className="mr-1 text-primary">✓</span>}
                  {opt.text}
                </span>
                <span className="text-[11px] tabular-nums text-muted-foreground flex-shrink-0">
                  {count} · {pct}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {!user && (
        <p className="text-[11px] text-muted-foreground">Sign in to vote.</p>
      )}
    </Card>
  );
}
