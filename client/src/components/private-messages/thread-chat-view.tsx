import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, isToday, isYesterday } from "date-fns";
import { ArrowDown, ArrowLeft, BookOpen, Check, CheckCheck, Paperclip, Send, Shield, User as UserIcon, X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { uploadPrivateMessage } from "@/lib/private-message-upload";
import { PRIVATE_UPLOAD_LIMIT_LABEL, privateUploadError } from "@shared/private-message-uploads";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { LiveConnectionBanner } from "@/components/live-connection-banner";
import { useToast } from "@/hooks/use-toast";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { useTicketComposerSize } from "@/hooks/use-ticket-composer-size";
import { useReconnectingWebSocket } from "@/hooks/use-reconnecting-websocket";
import { useTicketConversationScroll } from "@/hooks/use-ticket-conversation-scroll";
import { MessageBody } from "@/components/ticket/message-body";
import { MessageActions, type TicketReaction } from "@/components/ticket/message-actions";
import { EditTicketMessageDialog } from "@/components/ticket/edit-message-dialog";
import { AttachmentViewer, TicketAttachment, type TicketMedia } from "@/components/ticket/attachment-viewer";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { serverActionErrorMessage } from "@/lib/server-error";

type PrivateThreadMessage = {
  id: string;
  threadId: string;
  senderId: string;
  senderName?: string;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deliveredAt?: string | null;
  readAt?: string | null;
  clientMessageId: string | null;
  reactions: TicketReaction[];
  attachment: { name: string; kind: "image" | "video" | "file"; contentType: string } | null;
  imageUrl?: string | null;
  kbArticleSlug?: string | null;
  kbArticle?: KbArticleRef | null;
};

type ThreadInfo = {
  subject: string;
  adminName: string;
  customerName: string;
};

const EMPTY_OPTIMISTIC: Array<{ id: string; senderId: string }> = [];

function uuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === "x" ? r : (r & 3 | 8)).toString(16);
  });
}

async function responseError(response: Response, fallback: string) {
  if (response.status === 413) return PRIVATE_UPLOAD_LIMIT_LABEL;
  const body = await response.text().catch(() => "");
  if (body) {
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) return String(parsed.message);
      if (parsed.error) return String(parsed.error);
    } catch {
      return /<[^>]+>/.test(body)
        ? `The upload server rejected the request (${response.status}). Your draft has not been cleared; please try again.`
        : body.slice(0, 400);
    }
  }
  return `${fallback} (${response.status})`;
}

function dateLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function privateMedia(threadId: string, message: PrivateThreadMessage): TicketMedia | null {
  if (!message.attachment) return null;
  return {
    ticketId: threadId,
    messageId: message.id,
    name: message.attachment.name,
    kind: message.attachment.kind,
    contentType: message.attachment.contentType,
    endpoint: `/api/message-threads/${encodeURIComponent(threadId)}/messages/${encodeURIComponent(message.id)}/attachment`,
  };
}

export function ThreadChatView({ threadId, onBack }: { threadId: string; onBack: () => void }) {
  const { user, isAdmin, hasPermission } = useAuth();
  const { toast } = useToast();
  const keyboardInset = useKeyboardInset();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [article, setArticle] = useState<KbArticleRef | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [editing, setEditing] = useState<PrivateThreadMessage | null>(null);
  const [deleting, setDeleting] = useState<PrivateThreadMessage | null>(null);
  const [viewingMedia, setViewingMedia] = useState<TicketMedia | null>(null);
  const [clientMessageId, setClientMessageId] = useState(uuid);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composerRootRef = useRef<HTMLDivElement>(null);
  const composerToolsRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const visibleIds = useRef(new Set<string>());
  const queuedReadIds = useRef(new Set<string>());
  const markedReadIds = useRef(new Set<string>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTypingSent = useRef(0);
  const failedPayload = useRef<{ body: string; file: File | null; kbSlug: string | null } | null>(null);
  const sendGuard = useRef(false);
  const hasOpenedOnce = useRef(false);
  const key = useMemo(() => ["/api/message-threads", threadId, "messages"], [threadId]);
  const messageBase = `/api/message-threads/${encodeURIComponent(threadId)}/messages`;

  const { data: thread } = useQuery<ThreadInfo>({ queryKey: ["/api/message-threads", threadId] });
  const { data: messages, isLoading, isError, refetch } = useQuery<PrivateThreadMessage[]>({
    queryKey: key,
    refetchInterval: 5000,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });
  const { scrollContainerRef, contentRef, requestFollow, jumpToLatest, showLatest, hasNewMessages } = useTicketConversationScroll({
    conversationId: threadId,
    enabled: true,
    messages,
    optimisticMessages: EMPTY_OPTIMISTIC,
    actorId: user?.id,
  });
  useTicketComposerSize(composerRootRef, composerToolsRef, inputRef, body);

  useEffect(() => {
    if (viewingMedia && messages && !messages.some(item => item.id === viewingMedia.messageId)) setViewingMedia(null);
    if (editing && messages && !messages.some(item => item.id === editing.id)) setEditing(null);
    if (deleting && messages && !messages.some(item => item.id === deleting.id)) setDeleting(null);
  }, [messages, viewingMedia, editing, deleting]);

  const flushVisibleReads = useCallback(() => {
    if (document.visibilityState !== "visible" || !user?.id) return;
    for (const id of queuedReadIds.current) {
      if (!visibleIds.current.has(id)) queuedReadIds.current.delete(id);
    }
    const ids = Array.from(queuedReadIds.current).filter(id => visibleIds.current.has(id)).slice(0, 100);
    if (!ids.length) return;
    ids.forEach(id => queuedReadIds.current.delete(id));
    apiRequest("PATCH", `/api/message-threads/${encodeURIComponent(threadId)}/read`, { messageIds: ids })
      .then(() => {
        ids.forEach(id => markedReadIds.current.add(id));
        void queryClient.invalidateQueries({ queryKey: ["/api/message-threads/unread-count"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
        void queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
        if (queuedReadIds.current.size) {
          if (flushTimer.current) clearTimeout(flushTimer.current);
          flushTimer.current = setTimeout(flushVisibleReads, 0);
        }
      })
      .catch(() => ids.forEach(id => { markedReadIds.current.delete(id); queuedReadIds.current.add(id); }));
  }, [threadId, user?.id]);

  const observeVisibleMessages = useCallback(() => {
    observerRef.current?.disconnect();
    visibleIds.current.clear();
    const root = scrollContainerRef.current;
    if (!root || !messages || document.visibilityState !== "visible") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.readMessageId;
        if (!id) continue;
        if (entry.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0) {
          visibleIds.current.add(id);
          if (!markedReadIds.current.has(id)) queuedReadIds.current.add(id);
        } else {
          visibleIds.current.delete(id);
          queuedReadIds.current.delete(id);
        }
      }
      if (flushTimer.current) clearTimeout(flushTimer.current);
      flushTimer.current = setTimeout(flushVisibleReads, 350);
    }, { root, threshold: [0, 0.01] });
    observerRef.current = observer;
    root.querySelectorAll<HTMLElement>("[data-read-message-id]").forEach(node => observer.observe(node));
  }, [messages, flushVisibleReads, scrollContainerRef]);

  useEffect(() => {
    observeVisibleMessages();
    return () => observerRef.current?.disconnect();
  }, [observeVisibleMessages]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        observeVisibleMessages();
        void refetch();
      } else {
        observerRef.current?.disconnect();
        visibleIds.current.clear();
        queuedReadIds.current.clear();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [observeVisibleMessages, refetch]);

  useEffect(() => () => {
    if (flushTimer.current) clearTimeout(flushTimer.current);
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, []);

  const wsStatus = useReconnectingWebSocket({
    path: "/ws",
    wsRef,
    deps: [threadId, user?.id],
    onOpen: ws => {
      if (user?.id) ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
      if (hasOpenedOnce.current) void queryClient.invalidateQueries({ queryKey: key });
      hasOpenedOnce.current = true;
    },
    onMessage: event => {
      try {
        const data = JSON.parse(event.data);
        if (data.threadId === threadId && ["thread_message", "thread_message_edited", "thread_message_deleted", "thread_reactions_updated"].includes(data.type)) {
          void queryClient.invalidateQueries({ queryKey: key });
          void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
          if (data.type === "thread_message") setTypingUser(null);
        }
        if (data.type === "thread_typing" && data.threadId === threadId && data.userId !== user?.id) {
          setTypingUser(data.userName);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTypingUser(null), 3000);
        }
        if ((data.type === "thread_messages_read" && data.readBy !== user?.id) ||
          (data.type === "thread_messages_delivered" && data.deliveredTo !== user?.id)) {
          if (data.threadId === threadId) void queryClient.invalidateQueries({ queryKey: key });
        }
      } catch { /* Ignore malformed frames; polling will reconcile. */ }
    },
    onVisible: ws => {
      if (user?.id) ws.send(JSON.stringify({ type: "viewing_thread", threadId, userId: user.id }));
      void queryClient.invalidateQueries({ queryKey: key });
      observeVisibleMessages();
    },
    onBeforeUnmount: ws => {
      if (user?.id) ws.send(JSON.stringify({ type: "left_thread", threadId, userId: user.id }));
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (payload: { body: string; file: File | null; kbSlug: string | null; clientMessageId: string }) => {
      const form = new FormData();
      form.append("body", payload.body);
      form.append("clientMessageId", payload.clientMessageId);
      if (payload.file) form.append("image", payload.file);
      if (payload.kbSlug) form.append("kbArticleSlug", payload.kbSlug);
      setUploadProgress(0);
      const response = await uploadPrivateMessage(messageBase, form, setUploadProgress);
      if (!response.ok) throw new Error(await responseError(response, "Couldn't send your message"));
      const result = await response.json();
      return (result.message ?? result) as PrivateThreadMessage;
    },
    onSuccess: saved => {
      sendGuard.current = false;
      failedPayload.current = null;
      queryClient.setQueryData<PrivateThreadMessage[]>(key, previous => {
        if (!previous) return [saved];
        return [...previous.filter(item => item.id !== saved.id && (!saved.clientMessageId || item.clientMessageId !== saved.clientMessageId)), saved];
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
      setBody("");
      setFile(null);
      setArticle(null);
      setClientMessageId(uuid());
      if (fileInputRef.current) fileInputRef.current.value = "";
      requestFollow();
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
        input.focus({ preventScroll: true });
      });
    },
    onError: (error, payload) => {
      sendGuard.current = false;
      failedPayload.current = { body: payload.body, file: payload.file, kbSlug: payload.kbSlug };
      toast({ title: "Failed to send message", description: serverActionErrorMessage(error, "Couldn't send your message. Please try again."), variant: "destructive" });
    },
    onSettled: () => setUploadProgress(null),
  });

  const send = useCallback(() => {
    if (sendMutation.isPending || sendGuard.current) return;
    const cleanBody = body.trim();
    if (!cleanBody && !file && !article) return;
    const rejection = file ? privateUploadError(file) : null;
    if (rejection) {
      toast({ title: "Attachment is too large", description: rejection, variant: "destructive" });
      return;
    }
    const kbSlug = isAdmin ? article?.slug ?? null : null;
    const previousFailure = failedPayload.current;
    const sameFailedPayload = !!previousFailure && previousFailure.body === cleanBody && previousFailure.file === file && previousFailure.kbSlug === kbSlug;
    const id = previousFailure && !sameFailedPayload ? uuid() : clientMessageId;
    if (id !== clientMessageId) setClientMessageId(id);
    sendGuard.current = true;
    sendMutation.mutate({ body: cleanBody, file, kbSlug, clientMessageId: id });
  }, [sendMutation, body, file, article, isAdmin, clientMessageId, toast]);

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const response = await apiRequest("DELETE", `${messageBase}/${encodeURIComponent(id)}`);
      return response;
    },
    onSuccess: async (_result, id) => {
      setDeleting(null);
      if (viewingMedia?.messageId === id) setViewingMedia(null);
      await queryClient.invalidateQueries({ queryKey: key });
      await queryClient.invalidateQueries({ queryKey: ["/api/message-threads"] });
    },
    onError: error => toast({ title: "Couldn't delete message", description: serverActionErrorMessage(error, "Please try again."), variant: "destructive" }),
  });

  const typing = () => {
    const now = Date.now();
    if (now - lastTypingSent.current < 2000) return;
    lastTypingSent.current = now;
    const socket = wsRef.current;
    if (socket?.readyState === WebSocket.OPEN && user?.id && user.fullName) {
      socket.send(JSON.stringify({ type: "thread_typing", threadId, userId: user.id, userName: user.fullName }));
    }
  };

  const onFile = (selected?: File) => {
    if (!selected) return;
    const rejection = privateUploadError(selected);
    if (rejection) {
      toast({ title: "Attachment is too large", description: rejection, variant: "destructive" });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(selected);
  };

  const preserveComposerFocus = (event: ReactPointerEvent | ReactMouseEvent) => {
    if (document.activeElement === inputRef.current) event.preventDefault();
  };

  const canDelete = isAdmin && hasPermission("messages.manage");
  const otherName = isAdmin ? thread?.customerName : thread?.adminName;

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-card-border bg-card" style={{ paddingBottom: keyboardInset || undefined, overscrollBehavior: "none" }} data-testid="thread-chat-view">
      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-5">
        <Button variant="ghost" size="icon" aria-label="Back to messages" className="-ml-2 h-9 w-9 shrink-0" onClick={onBack} data-testid="button-thread-back"><ArrowLeft className="h-4 w-4" /></Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold" data-testid="text-thread-subject">{thread?.subject || "Loading conversation"}</p>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            {isAdmin ? <UserIcon className="h-3 w-3" /> : <Shield className="h-3 w-3" />}
            <span className="truncate">{otherName || ""}</span>
          </div>
        </div>
      </header>
      <LiveConnectionBanner status={wsStatus} className="mx-2 mt-2" />
      <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5" data-testid="thread-message-list">
        <div ref={contentRef} className="space-y-1">
          {isLoading ? <div className="space-y-4" aria-label="Loading messages">{[0, 1, 2].map(i => <Skeleton key={i} className={`h-14 rounded-2xl ${i % 2 ? "ml-auto w-2/3" : "w-3/4"}`} />)}</div> :
            isError ? <div className="mx-auto max-w-sm py-12 text-center"><p className="text-sm text-muted-foreground">Messages couldn’t load.</p><Button className="mt-3" variant="outline" onClick={() => void refetch()}>Try again</Button></div> :
            (messages ?? []).length === 0 ? <div className="flex min-h-48 items-center justify-center text-center"><div><p className="text-sm font-medium">Start the conversation</p><p className="mt-1 text-xs text-muted-foreground">Your messages will appear here.</p></div></div> :
            (messages ?? []).map((msg, index, list) => {
              const own = msg.senderId === user?.id;
              const when = new Date(msg.createdAt);
              const previous = index ? new Date(list[index - 1].createdAt) : null;
              const separator = !previous || dateLabel(previous) !== dateLabel(when);
              const media = privateMedia(threadId, msg);
              return <div key={msg.id}>
                {!own && !msg.readAt && <span className="block h-px w-full" data-read-message-id={msg.id} aria-hidden="true" />}
                {separator && <div className="my-4 flex items-center gap-3" data-testid={`date-separator-${msg.id}`}><span className="h-px flex-1 bg-border" /><span className="text-[11px] font-medium text-muted-foreground">{dateLabel(when)}</span><span className="h-px flex-1 bg-border" /></div>}
                <div className={`mb-1 flex ${own ? "justify-end" : "justify-start"}`} data-testid={`message-${msg.id}`}>
                  <div className={`min-w-0 max-w-[88%] sm:max-w-[74%] ${own ? "items-end" : "items-start"}`}>
                    {!own && <p className="mb-1 px-1 text-[11px] font-medium text-muted-foreground">{msg.senderName}</p>}
                    <MessageActions ticketId={threadId} apiBase={messageBase} queryKey={key} messageId={msg.id} message={msg.body || ""} reactions={msg.reactions ?? []} enabled={!sendMutation.isPending} canDelete={canDelete} onDelete={() => setDeleting(msg)} onEdit={own ? () => setEditing(msg) : undefined} footer={<p className={`flex items-center gap-1 text-[10px] text-muted-foreground ${own ? "justify-end" : ""}`}>
                      {format(when, "h:mm a")}
                      {msg.editedAt && <span className="ml-1" data-testid={`message-edited-${msg.id}`} aria-label="Message edited">edited</span>}
                      {own && <span className="ml-1 inline-flex items-center gap-0.5" aria-label={msg.readAt ? "Read by recipient" : msg.deliveredAt ? "Delivered" : "Sent"}>
                        {msg.readAt ? <CheckCheck className="h-3 w-3 text-primary" /> : <Check className="h-3 w-3" />}{msg.readAt ? "Read" : msg.deliveredAt ? "Delivered" : "Sent"}
                      </span>}
                    </p>}>
                      <div className={`rounded-2xl border px-3 py-2.5 text-[14px] leading-relaxed shadow-sm ${own ? "border-primary bg-primary text-primary-foreground" : "border-card-border bg-card text-card-foreground"}`} style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}>
                        {msg.body && <MessageBody id={msg.id} message={msg.body} />}
                        {media && <TicketAttachment media={media} onOpen={setViewingMedia} />}
                        {msg.kbArticle && <a href={`/knowledge/${msg.kbArticle.slug}`} className="mt-2 flex items-center gap-2 rounded-lg border border-current/15 bg-background/20 p-2 text-xs underline"><BookOpen className="h-4 w-4 shrink-0" /><span className="truncate">{msg.kbArticle.title}</span></a>}
                      </div>
                    </MessageActions>
                  </div>
                </div>
              </div>;
            })}
        </div>
      </div>
      {showLatest && <div className="absolute bottom-[5.4rem] left-1/2 z-10 -translate-x-1/2">
        <Button size="sm" variant="secondary" className="rounded-full shadow-md" onClick={jumpToLatest} data-testid="button-new-messages-pill"><ArrowDown className="mr-1 h-3.5 w-3.5" />{hasNewMessages ? "New messages" : "Latest"}</Button>
      </div>}
      <footer ref={composerRootRef} className="shrink-0 border-t border-border bg-card px-3 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2.5 sm:px-4">
        <div ref={composerToolsRef}>
        {sendMutation.isPending && <p role="status" className="mb-1 text-xs text-muted-foreground">
          {uploadProgress === 100 ? "Saving message…" : file && uploadProgress !== null ? `Uploading ${uploadProgress}%` : "Sending message…"}
        </p>}
        {typingUser && <p className="mb-1.5 px-1 text-xs text-muted-foreground">{typingUser} is typing…</p>}
        {(file || article) && <div className="mb-2 flex min-w-0 items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
          {file ? <Paperclip className="h-3.5 w-3.5 shrink-0" /> : <BookOpen className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{file?.name || article?.title}</span>
          <Button size="icon" variant="ghost" className="h-6 w-6 shrink-0" disabled={sendMutation.isPending} aria-label="Remove attachment" onClick={() => { setFile(null); setArticle(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>{sendMutation.isPending ? null : <X className="h-3.5 w-3.5" />}</Button>
        </div>}
        {file && <p className="mb-1 text-[11px] text-muted-foreground">{PRIVATE_UPLOAD_LIMIT_LABEL}</p>}
        </div>
        <div className="flex items-end gap-1.5">
          <input ref={fileInputRef} type="file" className="hidden" onChange={event => onFile(event.target.files?.[0])} data-testid="input-thread-file" />
          <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Attach file" title="Attach a file" disabled={sendMutation.isPending} onPointerDown={preserveComposerFocus} onMouseDown={preserveComposerFocus} onClick={() => fileInputRef.current?.click()} data-testid="button-attach-thread-image"><Paperclip className="h-4 w-4" /></Button>
          {isAdmin && <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0" aria-label="Attach knowledge article" title="Link a knowledge base article" disabled={sendMutation.isPending} onPointerDown={preserveComposerFocus} onMouseDown={preserveComposerFocus} onClick={() => setPickerOpen(true)} data-testid="button-attach-thread-kb"><BookOpen className="h-4 w-4" /></Button>}
          <Textarea ref={inputRef} value={body} readOnly={sendMutation.isPending} rows={1} placeholder="Type a message…" className="max-h-[120px] min-h-9 flex-1 resize-none py-2 text-sm" data-testid="input-thread-message"
            onChange={event => { setBody(event.target.value); if (event.target.value.trim()) typing(); }}
            onCompositionEnd={() => { if (body.trim()) typing(); }} />
          <Button type="button" size="icon" className="h-9 w-9 shrink-0" aria-label="Send message" disabled={sendMutation.isPending || (!body.trim() && !file && !article)} onPointerDown={preserveComposerFocus} onMouseDown={preserveComposerFocus} onClick={send} data-testid="button-send-thread-message"><Send className="h-4 w-4" /></Button>
        </div>
        {isAdmin && <KbArticlePickerDialog open={pickerOpen} onOpenChange={setPickerOpen} onSelect={selected => { setArticle(selected); setPickerOpen(false); }} />}
      </footer>
      {editing && <EditTicketMessageDialog ticketId={threadId} apiBase={messageBase} queryKey={key} privateMessage message={{ id: editing.id, message: editing.body, imageUrl: editing.imageUrl, kbArticleSlug: editing.kbArticleSlug ?? editing.kbArticle?.slug }} onClose={() => setEditing(null)} />}
      <AlertDialog open={!!deleting} onOpenChange={open => { if (!open && !removeMutation.isPending) setDeleting(null); }}>
        <AlertDialogContent data-testid="dialog-delete-private-message">
          <AlertDialogHeader><AlertDialogTitle>Delete for everyone?</AlertDialogTitle><AlertDialogDescription>This message will be removed for everyone in this conversation. This can’t be undone.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={removeMutation.isPending} onClick={event => { event.preventDefault(); if (deleting) removeMutation.mutate(deleting.id); }} data-testid="button-confirm-delete-private-message">{removeMutation.isPending ? "Deleting…" : "Delete message"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AttachmentViewer media={viewingMedia} onClose={() => setViewingMedia(null)} />
    </div>
  );
}
