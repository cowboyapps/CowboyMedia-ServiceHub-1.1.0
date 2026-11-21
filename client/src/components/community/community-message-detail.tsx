import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CommunityPhoto } from "@/components/community/community-photo";
import type { CommunityMessage } from "@shared/schema";
import { ChatMessageContent } from "@/components/chat-message-content";

export function CommunityMessageDetail({ message, onClose }: { message: CommunityMessage | null; onClose: () => void }) {
  return (
    <Dialog open={!!message} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[88dvh] w-[calc(100vw-1.5rem)] overflow-y-auto sm:max-w-lg" data-testid="dialog-community-message-detail">
        <DialogHeader>
          <DialogTitle>Message detail</DialogTitle>
        </DialogHeader>
        {message && (
          <article className="space-y-3">
            <div>
              <p className="text-sm font-semibold">{message.chatUsername}</p>
              <time className="text-xs text-muted-foreground" dateTime={String(message.createdAt)}>
                {format(new Date(message.createdAt), "MMMM d, yyyy · h:mm a")}
              </time>
            </div>
            {message.content && <ChatMessageContent content={message.content} className="whitespace-pre-wrap break-words text-sm leading-relaxed" />}
            {message.imageUrl && <CommunityPhoto src={message.imageUrl} messageId={`detail-${message.id}`} />}
            {message.kbArticleSlug && <a href={`/knowledge/${encodeURIComponent(message.kbArticleSlug)}`}
              target="_blank" rel="noopener noreferrer" className="block text-sm font-medium text-primary underline">
              Open shared Knowledge Base article
            </a>}
            {!message.content && !message.imageUrl && !message.kbArticleSlug && <p className="text-sm text-muted-foreground">This message has no text or photo.</p>}
          </article>
        )}
      </DialogContent>
    </Dialog>
  );
}
