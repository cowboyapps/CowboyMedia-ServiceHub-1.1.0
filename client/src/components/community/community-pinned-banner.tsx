import { useQuery } from "@tanstack/react-query";
import { Pin, PinOff, RotateCw } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CommunityMessage } from "@shared/schema";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

export const COMMUNITY_PIN_QUERY_KEY = ["/api/community-chat/pin"];
type PinResponse = { message: CommunityMessage | null };

export function CommunityPinnedBanner({ onPreview, canManage = false }: { onPreview: (message: CommunityMessage) => void; canManage?: boolean }) {
  const [unpinning, setUnpinning] = useState(false);
  const { toast } = useToast();
  const query = useQuery<PinResponse>({
    queryKey: COMMUNITY_PIN_QUERY_KEY,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/community-chat/pin");
      if (!response.ok) throw new Error("Could not load pinned message");
      return response.json();
    },
  });
  if (query.isLoading) return <div className="px-3 pt-2 sm:px-4" aria-label="Loading pinned message"><Skeleton className="h-11 w-full rounded-lg" /></div>;
  if (query.isError) return (
    <div className="flex items-center justify-between gap-2 px-3 pt-2 text-xs text-destructive sm:px-4" role="alert">
      <span>Pinned message unavailable.</span>
      <Button variant="ghost" size="sm" onClick={() => void query.refetch()} aria-label="Retry loading pinned message">
        <RotateCw className="mr-1 h-3.5 w-3.5" />Retry
      </Button>
    </div>
  );
  const message = query.data?.message;
  if (!message) return null;
  return (
    <div className="flex items-center gap-1 pr-3 sm:pr-4">
    <button type="button" onClick={() => onPreview(message)}
      className="ml-3 mt-2 flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-lg border border-primary/20 bg-primary/[0.06] px-3 py-2 text-left hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-4"
      aria-label={`Open pinned message from ${message.chatUsername}`} data-testid="community-pinned-banner">
      <Pin className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-primary">Pinned message · {message.chatUsername}</span>
        <span className="block truncate text-xs text-foreground/80">{message.content || (message.imageUrl ? "Photo" : message.kbArticleSlug ? "Knowledge Base article" : "Message")}</span>
      </span>
      <span className="shrink-0 text-xs font-medium text-primary">View</span>
    </button>
    {canManage && <Button type="button" variant="ghost" size="icon" className="mt-2 shrink-0"
      aria-label="Unpin community message" disabled={unpinning} data-testid="button-unpin-community-message"
      onClick={async () => {
        setUnpinning(true);
        try {
          await apiRequest("DELETE", "/api/community-chat/pin");
          queryClient.setQueryData(COMMUNITY_PIN_QUERY_KEY, { message: null });
          await queryClient.invalidateQueries({ queryKey: COMMUNITY_PIN_QUERY_KEY });
          toast({ title: "Pinned message removed" });
        } catch {
          toast({ title: "Couldn’t remove pinned message", variant: "destructive" });
        } finally { setUnpinning(false); }
      }}><PinOff className="h-4 w-4" /></Button>}
    </div>
  );
}
