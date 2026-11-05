import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Copy, Trash2 } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { TICKET_REACTIONS, TICKET_REACTION_EMOJIS } from "@shared/ticket-reactions";

export type TicketReaction = { emoji: string; count: number; reacted: boolean };

type Props = {
  ticketId: string;
  messageId: string;
  message: string;
  reactions?: TicketReaction[];
  enabled: boolean;
  canDelete: boolean;
  onDelete: (id: string) => void;
  children?: ReactNode;
  footer?: ReactNode;
};

export function MessageActions({ ticketId, messageId, message, reactions = [], enabled, canDelete, onDelete, children, footer }: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const deleteAfterClose = useRef(false);
  const key = ["/api/tickets", ticketId, "messages"];

  const reactionMutation = useMutation({
    mutationFn: async (value: string | null) => {
      const response = await apiRequest("PUT", `/api/tickets/${ticketId}/messages/${messageId}/reaction`, { emoji: value });
      return { value, result: await response.json() as { reactions: TicketReaction[] } };
    },
    onMutate: async (nextEmoji) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previousReactions = queryClient.getQueryData<any[]>(key)?.find((item) => item.id === messageId)?.reactions;
      const current = previousReactions ?? reactions;
      const active = current.find((item: TicketReaction) => item.reacted)?.emoji;
      queryClient.setQueryData<any[]>(key, (old) => old?.map((item) => item.id !== messageId ? item : {
        ...item,
        reactions: optimisticReactions(current, active, nextEmoji),
      }));
      return { previousReactions };
    },
    onError: (_error, _emoji, context) => {
      if (context) queryClient.setQueryData<any[]>(key, (old) => old?.map((item) =>
        item.id === messageId ? { ...item, reactions: context.previousReactions } : item));
      toast({ title: "Reaction wasn’t saved", description: "Please try again.", variant: "destructive" });
    },
    onSuccess: ({ result }) => {
      queryClient.setQueryData<any[]>(key, (old) => old?.map((item) => item.id === messageId ? { ...item, reactions: result.reactions } : item));
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const react = (emoji: string) => {
    if (reactionMutation.isPending) return;
    const active = reactions.find(item => item.reacted)?.emoji;
    reactionMutation.mutate(active === emoji ? null : emoji);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      toast({ title: "Message copied" });
      setOpen(false);
    } catch {
      toast({ title: "Couldn’t copy message", description: "Please select the message text and copy it.", variant: "destructive" });
    }
  };

  const isInteractive = (target: EventTarget | null) => target instanceof Element &&
    !!target.closest("a,button,input,textarea,video,audio,[data-ticket-no-longpress],.selectable");
  const begin = (x: number, y: number, target: EventTarget | null) => {
    if (!enabled || isInteractive(target) || window.getSelection()?.toString()) return;
    if (timer.current) clearTimeout(timer.current);
    cancelled.current = false;
    start.current = { x, y };
    timer.current = setTimeout(() => {
      if (!cancelled.current && !window.getSelection()?.toString()) setOpen(true);
    }, 650);
  };
  const cancel = (event?: { clientX: number; clientY: number }) => {
    if (event && start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancelled.current = true;
    if (!event || cancelled.current) {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      start.current = null;
    }
  };

  return (
    <div className="relative min-w-0 space-y-0.5" data-testid={`message-actions-${messageId}`}
      onTouchStart={(event) => begin(event.touches[0]?.clientX ?? 0, event.touches[0]?.clientY ?? 0, event.target)}
      onTouchMove={(event) => cancel(event.touches[0])}
      onTouchEnd={() => cancel()}
      onTouchCancel={() => cancel()}
      onScrollCapture={() => cancel()}
      onPointerDown={(event) => { if (event.pointerType === "mouse") begin(event.clientX, event.clientY, event.target); }}
      onPointerMove={(event) => { if (event.pointerType === "mouse") cancel(event); }}
      onPointerUp={() => cancel()}
      onPointerCancel={() => cancel()}
      onContextMenu={(event) => { if (enabled && !isInteractive(event.target) && !window.getSelection()?.toString()) { event.preventDefault(); setOpen(true); } }}
    >
      {children}
      {reactions.length > 0 && <div className={`mt-1.5 flex flex-wrap gap-1 ${open ? "pointer-events-none" : ""}`} aria-label="Message reactions" data-testid={`reactions-${messageId}`}>
        {reactions.filter((reaction) => reaction.count > 0).map((reaction) => (
          <button type="button" key={reaction.emoji} disabled={!enabled || reactionMutation.isPending} onClick={() => react(reaction.emoji)}
            aria-pressed={reaction.reacted} aria-label={`${reaction.emoji}, ${reaction.count} reactions${reaction.reacted ? ", your reaction" : ""}`}
            className={`rounded-full border px-2 py-0.5 text-xs ${reaction.reacted ? "border-primary bg-primary/10" : "border-border bg-background/80"}`}
            data-testid={`reaction-${messageId}-${reaction.emoji}`}>
            {reaction.emoji} <span className="tabular-nums">{reaction.count}</span>
          </button>
        ))}
      </div>}
      {(enabled || footer) && <div className="flex min-h-7 items-center gap-2">
      {footer}
      {enabled && <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label="Message actions" className="ml-auto h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
            data-testid={`button-message-actions-${messageId}`} data-ticket-no-longpress>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64" data-testid={`menu-message-actions-${messageId}`}
          onCloseAutoFocus={(event) => {
            if (deleteAfterClose.current) {
              deleteAfterClose.current = false;
              event.preventDefault();
              onDelete(messageId);
            }
          }}>
          <div className="grid grid-cols-6 gap-1 p-2" role="group" aria-label="Add a reaction">
            {TICKET_REACTION_EMOJIS.map((emoji: string) => {
              const reaction = TICKET_REACTIONS.find((item) => item.emoji === emoji);
              const selected = reactions.some((item) => item.emoji === emoji && item.reacted);
              return <DropdownMenuItem key={emoji} asChild disabled={reactionMutation.isPending}
                onSelect={() => { react(emoji); setOpen(false); }}>
                <button type="button" title={`React ${reaction?.label ?? emoji}`} aria-label={`React ${reaction?.label ?? emoji}`} aria-pressed={selected}
                  className="h-9 w-9 justify-center rounded p-0 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{emoji}</button>
              </DropdownMenuItem>;
            })}
          </div>
          {!!message && <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void copy(); }} data-testid={`button-copy-message-${messageId}`}><Copy className="mr-2 h-4 w-4" />Copy message</DropdownMenuItem>}
          {canDelete && <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => { deleteAfterClose.current = true; setOpen(false); }} data-testid={`button-delete-message-${messageId}`}><Trash2 className="mr-2 h-4 w-4" />Delete for everyone</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>}
      </div>}
    </div>
  );
}

function optimisticReactions(reactions: TicketReaction[], active: string | undefined, nextEmoji: string | null) {
  const counts = new Map(reactions.map((reaction) => [reaction.emoji, reaction.count]));
  if (active && active !== nextEmoji) counts.set(active, Math.max(0, (counts.get(active) ?? 0) - 1));
  if (nextEmoji && active !== nextEmoji) counts.set(nextEmoji, (counts.get(nextEmoji) ?? 0) + 1);
  return Array.from(counts, ([emoji, count]) => ({ emoji, count, reacted: emoji === nextEmoji }));
}
