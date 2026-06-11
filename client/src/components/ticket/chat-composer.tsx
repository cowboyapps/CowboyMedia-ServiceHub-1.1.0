import * as React from "react";
import { useState, useRef, useEffect, useMemo, useCallback, useLayoutEffect, useImperativeHandle, forwardRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Paperclip, X, Send, Lock, Sparkles, Loader2, AlertTriangle, FileText, Film, BookOpen } from "lucide-react";
import { QuickResponsePicker } from "@/components/quick-response-picker";
import { KbArticlePickerDialog, type KbArticleRef } from "@/components/kb-article-picker-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  findUnfilledPlaceholders,
  walkPlaceholderOverlay,
  suggestKnownVariable,
  PLACEHOLDER_VARIABLE_LABELS,
  PLACEHOLDER_EMPTY_REASONS,
} from "@shared/quick-response-vars";

/**
 * Max bytes per attachment — mirror of the server's multer cap (25MB in
 * server/routes.ts). The server stays the source of truth; this only lets the
 * composer warn the customer before they hit send.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Human-readable file size, e.g. "4.2 MB" / "812 KB". */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type ComposerSendPayload = {
  text: string;
  file: File | null;
  kb: KbArticleRef | null;
  internal: boolean;
};

export interface ChatComposerHandle {
  clear: () => void;
  focus: () => void;
}

type Suggestion = { id: string; title: string; message: string };

type PlaceholderContext = {
  customer_name: string | null;
  ticket_subject: string | null;
  admin_name: string | null;
};

interface ChatComposerProps {
  ticketId: string;
  canReply: boolean;
  ticketClosed: boolean;
  disabledReason: string | null;
  adminUnclaimed: boolean;
  ticketClaimedByOther: boolean;
  isAdmin: boolean;
  userId: string | undefined;
  userFullName: string | undefined | null;
  placeholderContext: PlaceholderContext;
  suggestions?: Suggestion[];
  aiStatus?: { enabled: boolean };
  internalNotesCount: number;
  onRequestSend: (payload: ComposerSendPayload) => void;
  onTyping: () => void;
  onOpenInternalNotes: () => void;
  onClaimTicket: () => void;
  claimPending: boolean;
}

export const ChatComposer = forwardRef<ChatComposerHandle, ChatComposerProps>(function ChatComposer(props, ref) {
  const {
    ticketId,
    canReply,
    ticketClosed,
    disabledReason,
    adminUnclaimed,
    ticketClaimedByOther,
    isAdmin,
    userId,
    userFullName,
    placeholderContext,
    suggestions,
    aiStatus,
    internalNotesCount,
    onRequestSend,
    onTyping,
    onOpenInternalNotes,
    onClaimTicket,
    claimPending,
  } = props;

  const { toast } = useToast();

  const [message, setMessage] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [kbArticle, setKbArticle] = useState<KbArticleRef | null>(null);
  const [kbPickerOpen, setKbPickerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<"reply" | "internal">("reply");
  const [aiSuggestCollapsed, setAiSuggestCollapsed] = useState(false);
  const [openTokenKey, setOpenTokenKey] = useState<string | null>(null);

  const messageInputRef = useRef<HTMLTextAreaElement>(null);
  const placeholderOverlayRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset on ticket change
  useEffect(() => {
    setMessage("");
    setImageFile(null);
    setKbArticle(null);
    setKbPickerOpen(false);
    setComposerMode("reply");
    setAiSuggestCollapsed(false);
    setOpenTokenKey(null);
  }, [ticketId]);

  // Auto-grow textarea once per frame instead of doing layout thrash on every keystroke.
  useLayoutEffect(() => {
    const el = messageInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxPx = Math.round(window.innerHeight * 0.5);
    el.style.height = Math.min(el.scrollHeight, maxPx) + "px";
  }, [message]);

  // Keep the placeholder overlay scroll in sync with the textarea scroll.
  const syncPlaceholderOverlayScroll = useCallback(() => {
    const ta = messageInputRef.current;
    const overlay = placeholderOverlayRef.current;
    if (!ta || !overlay) return;
    overlay.scrollTop = ta.scrollTop;
    overlay.scrollLeft = ta.scrollLeft;
  }, []);

  useEffect(() => {
    syncPlaceholderOverlayScroll();
  }, [message, syncPlaceholderOverlayScroll]);

  useImperativeHandle(ref, () => ({
    clear: () => {
      setMessage("");
      setImageFile(null);
      setKbArticle(null);
      // The useLayoutEffect on [message] will shrink the textarea back next frame,
      // but also reset focus + height eagerly so the next send feels snappy.
      requestAnimationFrame(() => {
        const el = messageInputRef.current;
        if (el) {
          el.style.height = "auto";
          el.focus();
        }
      });
    },
    focus: () => {
      messageInputRef.current?.focus();
    },
  }), []);

  const applySuggestion = useCallback((text: string): boolean => {
    if (message.trim() && !window.confirm("Replace your current draft with this response?")) return false;
    setMessage(text);
    requestAnimationFrame(() => {
      messageInputRef.current?.focus();
    });
    return true;
  }, [message]);

  const aiDraftMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tickets/${ticketId}/ai-draft`);
      return (await res.json()) as { draft: string; remaining: number };
    },
    onSuccess: (data) => {
      applySuggestion(data.draft);
      toast({ title: "AI draft ready", description: "Edit before sending." });
    },
    onError: (err: any) => {
      toast({ title: "AI draft failed", description: err?.message || "Try again later.", variant: "destructive" });
    },
  });

  const replaceTokenRange = useCallback((start: number, end: number, replacement: string, caretAfter: "end" | "select") => {
    setMessage((prev) => prev.slice(0, start) + replacement + prev.slice(end));
    setOpenTokenKey(null);
    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (!el) return;
      el.focus();
      if (caretAfter === "select") {
        el.setSelectionRange(start, start + replacement.length);
      } else {
        const pos = start + replacement.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }, []);

  const jumpToToken = useCallback((start: number, end: number) => {
    setOpenTokenKey(null);
    requestAnimationFrame(() => {
      const el = messageInputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  }, []);

  const showPlaceholderOverlay = isAdmin;

  const overlayParts = useMemo(() => {
    if (!showPlaceholderOverlay || !message) return [];
    return walkPlaceholderOverlay(message, placeholderContext);
  }, [showPlaceholderOverlay, message, placeholderContext]);

  const hasPlaceholderHighlights = useMemo(
    () => overlayParts.some((p) => p.kind === "missing-token" || p.kind === "unknown-token"),
    [overlayParts],
  );

  useEffect(() => {
    if (!hasPlaceholderHighlights) setOpenTokenKey(null);
  }, [hasPlaceholderHighlights]);

  const draftUnfilledPlaceholders = useMemo(() => {
    if (!isAdmin) return [];
    const trimmed = message.trim();
    if (!trimmed) return [];
    return Array.from(new Set(findUnfilledPlaceholders(trimmed, placeholderContext)));
  }, [isAdmin, message, placeholderContext]);

  const isInternal = isAdmin && composerMode === "internal" && canReply;

  const attachmentOversize = !!imageFile && imageFile.size > MAX_ATTACHMENT_BYTES;

  const handleSend = useCallback(() => {
    const msgText = message.trim();
    const imgFile = imageFile;
    const kb = kbArticle;
    const internal = isAdmin && composerMode === "internal";
    if (internal) {
      if (!msgText) return;
      onRequestSend({ text: msgText, file: null, kb: null, internal: true });
      return;
    }
    if (imgFile && imgFile.size > MAX_ATTACHMENT_BYTES) return;
    if (!msgText && !imgFile && !kb) return;
    onRequestSend({ text: msgText, file: imgFile, kb, internal: false });
  }, [message, imageFile, kbArticle, isAdmin, composerMode, onRequestSend]);

  return (
    <div
      className={`border-t flex-shrink-0 ${isInternal ? "bg-amber-50/40 dark:bg-amber-950/20" : "bg-card"}`}
      data-testid="composer-container"
    >
      {isAdmin && canReply && (
        <div className="flex items-center gap-1 px-2 sm:px-3 pt-2">
          <Button
            type="button"
            size="sm"
            variant={composerMode === "reply" ? "secondary" : "ghost"}
            className="h-7 px-2.5 text-xs"
            onClick={() => setComposerMode("reply")}
            data-testid="tab-composer-reply"
          >
            Reply
          </Button>
          <Button
            type="button"
            size="sm"
            variant={composerMode === "internal" ? "secondary" : "ghost"}
            className={`h-7 px-2.5 text-xs gap-1 ${composerMode === "internal" ? "border border-amber-400 dark:border-amber-700 text-amber-800 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-950/50" : "text-amber-800 dark:text-amber-300"}`}
            onClick={() => setComposerMode("internal")}
            data-testid="tab-composer-internal"
          >
            <Lock className="w-3 h-3" />
            Internal note{internalNotesCount > 0 ? ` (${internalNotesCount})` : ""}
          </Button>
          {composerMode === "internal" && internalNotesCount > 0 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground ml-auto"
              onClick={onOpenInternalNotes}
              data-testid="button-open-internal-notes"
            >
              View all
            </Button>
          )}
        </div>
      )}
      {disabledReason && (
        <div className="px-3 pt-2 flex items-center justify-between gap-2" data-testid="text-composer-disabled-reason">
          <span className="text-xs text-muted-foreground">{disabledReason}</span>
          {adminUnclaimed && !ticketClaimedByOther && (
            <Button
              type="button"
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={onClaimTicket}
              disabled={claimPending}
              data-testid="button-claim-ticket-inline"
            >
              <Lock className="w-3 h-3 mr-1" />
              {claimPending ? "Claiming..." : "Claim to reply"}
            </Button>
          )}
        </div>
      )}
      <div className="p-2 sm:p-3">
        {isAdmin && canReply && composerMode === "reply" && ((suggestions && suggestions.length > 0) || aiStatus?.enabled) && (
          <div className="mb-2" data-testid="row-suggestions">
            {aiSuggestCollapsed && suggestions && suggestions.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[11px] rounded-full text-muted-foreground"
                onClick={() => setAiSuggestCollapsed(false)}
                data-testid="button-expand-suggestions"
              >
                <Sparkles className="w-3 h-3 mr-1" />
                {suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"}
              </Button>
            ) : (
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 overflow-x-auto flex-1 min-w-0 pb-0.5" style={{ scrollbarWidth: "thin" }}>
                  <TooltipProvider delayDuration={300}>
                    {suggestions?.map((s) => (
                      <Tooltip key={s.id}>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            className="h-6 px-2 text-[11px] rounded-full flex-shrink-0"
                            onClick={() => applySuggestion(s.message)}
                            data-testid={`chip-suggestion-${s.id}`}
                          >
                            {s.title}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs whitespace-pre-wrap text-xs">
                          {s.message}
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </TooltipProvider>
                </div>
                {aiStatus?.enabled && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px] rounded-full flex-shrink-0"
                    onClick={() => aiDraftMutation.mutate()}
                    disabled={aiDraftMutation.isPending}
                    data-testid="button-ai-suggest"
                  >
                    {aiDraftMutation.isPending ? (
                      <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 mr-1" />
                    )}
                    AI
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {imageFile && (
          <>
            <div
              className={`flex items-center gap-2 mb-2 p-2 rounded-md ${attachmentOversize ? "border border-destructive/50 bg-destructive/10 text-destructive" : "bg-accent"}`}
              data-testid="chip-attachment"
            >
              {attachmentOversize ? <AlertTriangle className="w-4 h-4 flex-shrink-0" /> :
                imageFile.type.startsWith("video/") ? <Film className="w-4 h-4 flex-shrink-0" /> :
                  imageFile.type.startsWith("image/") ? <Paperclip className="w-4 h-4 flex-shrink-0" /> :
                    <FileText className="w-4 h-4 flex-shrink-0" />}
              <span className="text-xs truncate flex-1">{imageFile.name}</span>
              <span
                className={`text-xs flex-shrink-0 ${attachmentOversize ? "" : "text-muted-foreground"}`}
                data-testid="text-attachment-size"
              >
                ({formatFileSize(imageFile.size)})
              </span>
              <Button size="icon" variant="ghost" onClick={() => setImageFile(null)} data-testid="button-remove-image">
                <X className="w-3 h-3" />
              </Button>
            </div>
            {attachmentOversize && (
              <p
                className="flex items-center gap-1.5 mb-2 text-[11px] text-destructive"
                data-testid="text-attachment-oversize-warning"
              >
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                This file must be {formatFileSize(MAX_ATTACHMENT_BYTES)} or smaller. Remove it to send.
              </p>
            )}
          </>
        )}
        {kbArticle && (
          <div className="flex items-center gap-2 mb-2 p-2 bg-accent rounded-md" data-testid="chip-selected-kb">
            <BookOpen className="w-4 h-4 flex-shrink-0 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium truncate">{kbArticle.title}</p>
              {kbArticle.categoryName && (
                <p className="text-[10px] text-muted-foreground truncate">{kbArticle.categoryName}</p>
              )}
            </div>
            <Button size="icon" variant="ghost" onClick={() => setKbArticle(null)} data-testid="button-remove-kb">
              <X className="w-3 h-3" />
            </Button>
          </div>
        )}
        {draftUnfilledPlaceholders.length > 0 && (
          <div
            className="flex items-start gap-1.5 mb-2 text-[11px] text-amber-700 dark:text-amber-400"
            data-testid="hint-unfilled-placeholders"
          >
            <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
            <span>
              This draft still has unfilled placeholders:{" "}
              {draftUnfilledPlaceholders.map((token, i) => (
                <span key={`${token}-${i}`}>
                  {i > 0 && ", "}
                  <code className="px-1 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 font-mono">
                    {token}
                  </code>
                </span>
              ))}
            </span>
          </div>
        )}
        <div className="flex items-end gap-1.5 sm:gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="*/*"
            className="hidden"
            onChange={(e) => setImageFile(e.target.files?.[0] || null)}
          />
          {!isInternal && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="flex-shrink-0 h-9 w-9"
              onClick={() => fileInputRef.current?.click()}
              disabled={!canReply}
              data-testid="button-attach-image"
            >
              <Paperclip className="w-4 h-4" />
            </Button>
          )}
          {!isInternal && (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="flex-shrink-0 h-9 w-9"
              onClick={() => setKbPickerOpen(true)}
              disabled={!canReply}
              data-testid="button-attach-kb"
              title="Link a knowledge base article"
            >
              <BookOpen className="w-4 h-4" />
            </Button>
          )}
          {isAdmin && userId && !isInternal && canReply && (
            <QuickResponsePicker
              adminId={userId}
              context={{
                customer_name: placeholderContext.customer_name,
                ticket_subject: placeholderContext.ticket_subject,
                admin_name: placeholderContext.admin_name,
              }}
              onInsert={applySuggestion}
            />
          )}
          <div className="relative flex-1">
            {showPlaceholderOverlay && hasPlaceholderHighlights && (
              <div
                ref={placeholderOverlayRef}
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 overflow-hidden rounded-md border border-transparent px-3 py-2 text-sm leading-5 text-transparent whitespace-pre-wrap break-words"
                data-testid="overlay-placeholder-highlights"
              >
                {overlayParts.map((part, i) => {
                  if (part.kind === "text") {
                    return <span key={i}>{part.value}</span>;
                  }
                  if (part.kind === "filled-token") {
                    return <span key={i}>{part.raw}</span>;
                  }
                  const tokenKey = `${i}-${part.start}`;
                  const isMissing = part.kind === "missing-token";
                  const variable = isMissing ? part.variable : undefined;
                  const label = variable
                    ? PLACEHOLDER_VARIABLE_LABELS[variable] ?? variable
                    : null;
                  const reason = variable
                    ? PLACEHOLDER_EMPTY_REASONS[variable] ?? null
                    : null;
                  const liveValue = (() => {
                    if (!variable) return "";
                    const v = (placeholderContext as Record<string, unknown>)[variable];
                    return v == null ? "" : String(v).trim();
                  })();
                  const suggestion = !isMissing
                    ? suggestKnownVariable(part.raw)
                    : null;
                  return (
                    <Popover
                      key={tokenKey}
                      open={openTokenKey === tokenKey}
                      onOpenChange={(o) => setOpenTokenKey(o ? tokenKey : null)}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="pointer-events-auto rounded bg-amber-200/70 dark:bg-amber-900/50 underline decoration-amber-600 decoration-2 underline-offset-2 text-transparent cursor-pointer p-0 m-0 border-0 align-baseline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                          data-testid={`overlay-placeholder-token-${i}`}
                          aria-label={
                            isMissing
                              ? `Fix unfilled placeholder ${part.raw}`
                              : `Fix unknown placeholder ${part.raw}`
                          }
                        >
                          {part.raw}
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        side="top"
                        className="w-64 p-0 pointer-events-auto"
                        data-testid={`popover-placeholder-${i}`}
                      >
                        <div className="p-3 space-y-1">
                          <div
                            className="text-xs font-mono break-all"
                            data-testid={`text-placeholder-token-${i}`}
                          >
                            {part.raw}
                          </div>
                          {isMissing ? (
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid={`text-placeholder-explanation-${i}`}
                            >
                              {liveValue
                                ? `${label} is now available — insert it below.`
                                : `${label} is empty. ${reason ?? ""}`}
                            </p>
                          ) : (
                            <p
                              className="text-xs text-muted-foreground"
                              data-testid={`text-placeholder-explanation-${i}`}
                            >
                              {suggestion ? (
                                <>Did you mean <code className="px-1 py-0.5 rounded bg-accent font-mono">{`{{${suggestion}}}`}</code>?</>
                              ) : (
                                <>Unknown placeholder — replace it with a value or remove it.</>
                              )}
                            </p>
                          )}
                        </div>
                        <div className="border-t flex flex-col">
                          {isMissing && liveValue && (
                            <button
                              type="button"
                              className="px-3 py-2 text-left text-sm hover:bg-accent"
                              onClick={() =>
                                replaceTokenRange(part.start, part.end, liveValue, "end")
                              }
                              data-testid={`button-placeholder-insert-${i}`}
                            >
                              Insert "{liveValue}"
                            </button>
                          )}
                          {!isMissing && suggestion && (
                            <button
                              type="button"
                              className="px-3 py-2 text-left text-sm hover:bg-accent"
                              onClick={() =>
                                replaceTokenRange(
                                  part.start,
                                  part.end,
                                  `{{${suggestion}}}`,
                                  "select",
                                )
                              }
                              data-testid={`button-placeholder-replace-${i}`}
                            >
                              Use <code className="px-1 py-0.5 rounded bg-accent font-mono">{`{{${suggestion}}}`}</code>
                            </button>
                          )}
                          <button
                            type="button"
                            className="px-3 py-2 text-left text-sm hover:bg-accent text-destructive"
                            onClick={() =>
                              replaceTokenRange(part.start, part.end, "", "end")
                            }
                            data-testid={`button-placeholder-remove-${i}`}
                          >
                            Remove placeholder
                          </button>
                          <button
                            type="button"
                            className="px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => jumpToToken(part.start, part.end)}
                            data-testid={`button-placeholder-edit-${i}`}
                          >
                            Edit manually
                          </button>
                        </div>
                      </PopoverContent>
                    </Popover>
                  );
                })}
                {message.endsWith("\n") && "\u200b"}
              </div>
            )}
            <Textarea
              ref={messageInputRef}
              value={message}
              onChange={(e) => {
                const val = e.target.value;
                setMessage(val);
                if (val.trim()) onTyping();
                if (isAdmin) {
                  if (val.length === 0 && aiSuggestCollapsed) {
                    setAiSuggestCollapsed(false);
                  } else if (val.length > 0 && !aiSuggestCollapsed) {
                    setAiSuggestCollapsed(true);
                  }
                }
              }}
              onFocus={() => {
                if (isAdmin && !aiSuggestCollapsed) setAiSuggestCollapsed(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              onScroll={syncPlaceholderOverlayScroll}
              placeholder={
                !canReply
                  ? (ticketClosed ? "Ticket is closed" : "Claim ticket to reply")
                  : isInternal
                    ? "Write a private note for other admins..."
                    : "Type a message..."
              }
              disabled={!canReply}
              className={`relative w-full min-h-[80px] resize-none text-base sm:text-sm py-2 leading-5 whitespace-pre-wrap break-words ${isInternal ? "bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-700" : "bg-transparent"}`}
              style={{ maxHeight: "50dvh" }}
              rows={4}
              data-testid="input-message"
            />
          </div>
          <Button
            type="button"
            size="icon"
            className={`flex-shrink-0 h-9 w-9 self-end ${isInternal ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}`}
            disabled={
              !canReply ||
              (isInternal
                ? !message.trim()
                : (attachmentOversize || (!message.trim() && !imageFile && !kbArticle)))
            }
            onClick={handleSend}
            data-testid="button-send-message"
            title={isInternal ? "Save internal note" : "Send message"}
          >
            {isInternal ? <Lock className="w-4 h-4" /> : <Send className="w-4 h-4" />}
          </Button>
        </div>
      </div>
      <KbArticlePickerDialog
        open={kbPickerOpen}
        onOpenChange={setKbPickerOpen}
        onSelect={(article) => { setKbArticle(article); setKbPickerOpen(false); }}
      />
    </div>
  );
});
