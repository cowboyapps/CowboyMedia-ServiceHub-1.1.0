import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, Copy, Trash2, Pencil, Reply, Pin, PinOff } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ReactionGroup = { emoji: string; userIds: string[] };
type Props = {
  id: string;
  content: string;
  reactions: ReactionGroup[];
  userId: string;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canPin: boolean;
  pinned: boolean;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReact: (emoji: string) => void;
  children?: ReactNode;
};

const PIN_QUERY_KEY = ["/api/community-chat/pin"];

export function CommunityMessageActions({
  id, content, reactions, userId, canReply, canEdit, canDelete, canPin, pinned,
  onReply, onEdit, onDelete, onReact, children,
}: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const cancelled = useRef(false);
  const afterClose = useRef<"reply" | "edit" | "delete" | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      toast({ title: "Message copied" });
      setOpen(false);
    } catch {
      toast({ title: "Couldn’t copy message", description: "Select the text and copy it.", variant: "destructive" });
    }
  };
  const pin = async () => {
    try {
      const response = pinned
        ? await apiRequest("DELETE", "/api/community-chat/pin")
        : await apiRequest("PUT", "/api/community-chat/pin", { messageId: id });
      if (!response.ok) throw new Error();
      await queryClient.invalidateQueries({ queryKey: PIN_QUERY_KEY });
      toast({ title: pinned ? "Pinned message removed" : "Message pinned" });
      setOpen(false);
    } catch {
      toast({ title: "Couldn’t update pinned message", variant: "destructive" });
    }
  };
  const isInteractive = (target: EventTarget | null) => target instanceof Element &&
    !!target.closest("a,button,input,textarea,select,[contenteditable=true],[data-no-longpress]");
  const begin = (x: number, y: number, target: EventTarget | null) => {
    if (isInteractive(target) || window.getSelection()?.toString()) return;
    if (timer.current) clearTimeout(timer.current);
    cancelled.current = false;
    start.current = { x, y };
    timer.current = setTimeout(() => {
      if (!cancelled.current && !window.getSelection()?.toString()) setOpen(true);
    }, 600);
  };
  const move = (x: number, y: number) => {
    if (start.current && Math.hypot(x - start.current.x, y - start.current.y) > 10) cancelled.current = true;
    if (cancelled.current && timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  return (
    <div className="relative w-fit min-w-0 max-w-[85%] sm:max-w-[70%]" data-testid={`message-actions-${id}`}
      onPointerDown={(event) => begin(event.clientX, event.clientY, event.target)}
      onPointerMove={(event) => move(event.clientX, event.clientY)}
      onPointerUp={cancel} onPointerCancel={cancel}
      onContextMenu={(event) => {
        if (!isInteractive(event.target) && !window.getSelection()?.toString()) {
          event.preventDefault();
          setOpen(true);
        }
      }}>
      {children}
      <div className="flex min-h-8 items-center gap-2" data-no-longpress>
        <div className="flex flex-wrap gap-1" aria-label="Message reactions">
          {reactions.map((reaction) => (
            <button type="button" key={reaction.emoji} onClick={() => onReact(reaction.emoji)}
              aria-label={`${reaction.emoji}, ${reaction.userIds.length} reactions${reaction.userIds.includes(userId) ? ", your reaction" : ""}`}
              aria-pressed={reaction.userIds.includes(userId)}
              className={`rounded-full border px-2 py-0.5 text-xs ${reaction.userIds.includes(userId) ? "border-primary bg-primary/10" : "border-border bg-background/80"}`}
              data-testid={`reaction-badge-${reaction.emoji}`}>
              {reaction.emoji} <span className="tabular-nums">{reaction.userIds.length}</span>
            </button>
          ))}
        </div>
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon" aria-label="Message actions"
              className="ml-auto h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
              data-testid={`button-react-${id}`} data-no-longpress>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52" data-testid={`menu-message-actions-${id}`}
            onCloseAutoFocus={(event) => {
              if (!afterClose.current) return;
              event.preventDefault();
              const action = afterClose.current;
              afterClose.current = null;
              if (action === "reply") onReply();
              else if (action === "edit") onEdit();
              else onDelete();
            }}>
            <div className="grid grid-cols-4 gap-1 p-2" role="group" aria-label="Add a reaction">
              {["👍", "❤️", "😂", "😮", "😢", "🔥", "🎉", "👎"].map((emoji) => (
                <DropdownMenuItem key={emoji} asChild onSelect={() => { onReact(emoji); setOpen(false); }}>
                  <button type="button" aria-label={`React ${emoji}`} data-testid={`button-emoji-${emoji}`} className="h-9 justify-center rounded p-0 text-lg">{emoji}</button>
                </DropdownMenuItem>
              ))}
            </div>
            {canReply && <DropdownMenuItem onSelect={() => { afterClose.current = "reply"; setOpen(false); }} data-testid="button-reply">
              <Reply className="mr-2 h-4 w-4" />Reply
            </DropdownMenuItem>}
            {!!content && <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void copy(); }} data-testid={`button-copy-message-${id}`}>
              <Copy className="mr-2 h-4 w-4" />Copy message
            </DropdownMenuItem>}
            {canEdit && <DropdownMenuItem onSelect={() => { afterClose.current = "edit"; setOpen(false); }} data-testid={`button-edit-${id}`}>
              <Pencil className="mr-2 h-4 w-4" />Edit message
            </DropdownMenuItem>}
            {canDelete && <DropdownMenuItem className="text-destructive focus:text-destructive"
              onSelect={() => { afterClose.current = "delete"; setOpen(false); }} data-testid={`button-delete-${id}`}>
              <Trash2 className="mr-2 h-4 w-4" />Delete message
            </DropdownMenuItem>}
            {canPin && <DropdownMenuItem onSelect={(event) => { event.preventDefault(); void pin(); }} data-testid={`button-${pinned ? "unpin" : "pin"}-message-${id}`}>
              {pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
              {pinned ? "Unpin message" : "Pin message"}
            </DropdownMenuItem>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
