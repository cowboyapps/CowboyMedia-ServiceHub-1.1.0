import { useRef, useState } from "react";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  LifeBuoy,
  ChevronRight,
  ExternalLink,
  AlertCircle,
  Link2Off,
  ServerCog,
  CreditCard,
  Shield,
  User as UserIcon,
  Send,
  ArrowLeft,
  Paperclip,
  X,
  Download,
  AlertTriangle,
} from "lucide-react";

function SectionIcon({ icon: Icon, tone }: { icon: typeof LifeBuoy; tone: string }) {
  return (
    <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${tone}`}>
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

function RowSkeletons({ rows = 2 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3.5">
          <Skeleton className="h-8 w-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Shared, read-on-demand presentation of WHMCS support tickets. Driven entirely
// by the locked payloads from the customer routes (/api/whmcs-tickets[...]) and
// admin routes (/api/admin/users/:id/whmcs/tickets[...]) so both call sites
// render an identical view. These are mirrored from WHMCS — they are clearly
// labelled "Billing & account support" and kept fully separate from native
// ServiceHub tickets. Every absent/empty/error state renders cleanly.

export type TicketStatusKey =
  | "open"
  | "answered"
  | "customer_reply"
  | "in_progress"
  | "on_hold"
  | "closed"
  | "other";

export interface WhmcsTicketSummary {
  id: number;
  tid: string;
  subject: string;
  status: string;
  statusKey: TicketStatusKey;
  department: string;
  priority: string;
  date: string | null;
  lastReply: string | null;
}

export interface WhmcsTicketsListData {
  configured: boolean;
  enabled: boolean;
  linked: boolean;
  unreachable: boolean;
  tickets: WhmcsTicketSummary[];
  portalUrl: string | null;
}

export type ReplyAuthorType = "client" | "staff" | "other";

export type AttachmentOwnerType = "reply" | "ticket";

export interface WhmcsAttachment {
  filename: string;
  index: number;
  type: AttachmentOwnerType;
  relatedId: number;
}

export interface WhmcsReply {
  id: string;
  authorName: string;
  authorType: ReplyAuthorType;
  date: string | null;
  message: string;
  attachments: WhmcsAttachment[];
}

export interface WhmcsTicketDetail {
  id: number;
  tid: string;
  subject: string;
  status: string;
  statusKey: TicketStatusKey;
  department: string;
  priority: string;
  date: string | null;
  ownerClientId: number;
  messages: WhmcsReply[];
  viewUrl: string | null;
}

const STATUS_LABEL: Record<TicketStatusKey, string> = {
  open: "Open",
  answered: "Answered",
  customer_reply: "Customer Reply",
  in_progress: "In Progress",
  on_hold: "On Hold",
  closed: "Closed",
  other: "—",
};

export function ticketStatusLabel(t: { statusKey: TicketStatusKey; status: string }): string {
  if (t.statusKey === "other") return t.status || "—";
  return STATUS_LABEL[t.statusKey];
}

export function ticketBadgeClass(key: TicketStatusKey): string {
  switch (key) {
    case "open":
    case "customer_reply":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30";
    case "answered":
      return "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30";
    case "in_progress":
      return "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30";
    case "on_hold":
      return "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30";
    case "closed":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function formatTicketDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(`${value}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function EmptyState({
  icon: Icon,
  title,
  description,
  testid,
}: {
  icon: typeof LifeBuoy;
  title: string;
  description: string;
  testid: string;
}) {
  return (
    <div className="text-center py-10" data-testid={testid}>
      <Icon className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{description}</p>
    </div>
  );
}

/**
 * Returns the empty/loading state element when the list can't be shown, or null
 * when there are real tickets to render. Lets the customer page hide the whole
 * section (return null) while the admin panel shows an inline message.
 */
function listGuard(
  data: WhmcsTicketsListData | undefined,
  isLoading: boolean,
  isAdmin: boolean,
): { kind: "render" } | { kind: "hide" } | { kind: "node"; node: JSX.Element } {
  if (isLoading) {
    return {
      kind: "node",
      node: (
        <div className="px-5 py-8" data-testid="whmcs-tickets-loading">
          <RowSkeletons rows={2} />
        </div>
      ),
    };
  }
  if (!data) {
    return isAdmin
      ? {
          kind: "node",
          node: (
            <EmptyState
              icon={AlertCircle}
              title="Support tickets unavailable"
              description="We couldn't load WHMCS tickets right now. Please try again later."
              testid="whmcs-tickets-state-error"
            />
          ),
        }
      : { kind: "hide" };
  }
  if (!data.configured || !data.enabled || !data.linked) {
    // Customer: hide the section entirely. Admin: show why it's empty.
    if (!isAdmin) return { kind: "hide" };
    const [title, description] =
      !data.configured || !data.enabled
        ? ["Support tickets not available", "WHMCS isn't configured or is currently disabled."]
        : ["No billing account linked", "This customer isn't linked to a WHMCS client yet. Link them above to see their billing tickets."];
    return {
      kind: "node",
      node: <EmptyState icon={!data.linked ? Link2Off : CreditCard} title={title} description={description} testid="whmcs-tickets-state-empty" />,
    };
  }
  if (data.unreachable) {
    return {
      kind: "node",
      node: (
        <EmptyState
          icon={ServerCog}
          title="Temporarily unavailable"
          description="We couldn't reach the billing system right now. Please try again in a few minutes."
          testid="whmcs-tickets-state-unreachable"
        />
      ),
    };
  }
  return { kind: "render" };
}

interface TicketListProps {
  data: WhmcsTicketsListData | undefined;
  isLoading: boolean;
  context?: "customer" | "admin";
  onOpen: (id: number) => void;
  /** Ids of tickets with an unseen staff reply — render a "New reply" badge. */
  newReplyIds?: Set<number>;
}

/**
 * The list of a client's WHMCS tickets. On the customer page this lives inside a
 * clearly-labelled "Billing & account support" card; in the admin panel it's a
 * section under the customer's billing link. Returns null (renders nothing) for
 * the hidden customer states so native tickets stay the focus.
 */
export function WhmcsTicketList({ data, isLoading, context = "customer", onOpen, newReplyIds }: TicketListProps) {
  const isAdmin = context === "admin";
  const guard = listGuard(data, isLoading, isAdmin);
  if (guard.kind === "hide") return null;

  const renderContent = () => {
    if (guard.kind === "node") {
      return <div className="px-5 py-8 border-t border-border">{guard.node}</div>;
    }

    const tickets = data!.tickets;
    if (tickets.length === 0) {
      return (
        <div className="px-5 py-8 border-t border-border flex justify-center">
          <EmptyState
            icon={LifeBuoy}
            title="No billing tickets"
            description={isAdmin ? "No billing tickets for this customer." : "You don't have any billing or account support tickets."}
            testid="whmcs-tickets-none"
          />
        </div>
      );
    }

    return (
      <div className="divide-y divide-border border-t border-border" data-testid="whmcs-tickets-list">
        {tickets.map((t) => {
          const hasNewReply = !!newReplyIds?.has(t.id);
          return (
            <div
              key={t.id}
              className={`flex items-center justify-between gap-3 px-5 py-3.5 hover-elevate tap-interactive cursor-pointer ${hasNewReply ? "bg-primary/[0.03]" : ""}`}
              onClick={() => onOpen(t.id)}
              data-testid={`card-whmcs-ticket-${t.id}`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${hasNewReply ? "bg-primary/20 text-primary" : "bg-muted text-muted-foreground"}`}>
                  <LifeBuoy className="w-4 h-4" />
                </div>
                <div className="min-w-0 space-y-1">
                  <h3 className={`text-sm truncate ${hasNewReply ? "font-bold" : "font-medium"}`} data-testid={`text-whmcs-ticket-subject-${t.id}`}>{t.subject}</h3>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span className="font-mono text-[11px] opacity-70">#{t.tid}</span>
                    <span>·</span>
                    <Badge variant="outline" className={`h-5 text-[10px] px-1.5 font-medium ${ticketBadgeClass(t.statusKey)}`} data-testid={`badge-whmcs-ticket-status-${t.id}`}>
                      {ticketStatusLabel(t)}
                    </Badge>
                    {hasNewReply && (
                      <>
                        <span>·</span>
                        <span className="text-[10px] font-semibold text-primary uppercase tracking-wide flex items-center gap-1" data-testid={`badge-whmcs-ticket-new-${t.id}`}>
                          <Send className="w-2.5 h-2.5" /> New reply
                        </span>
                      </>
                    )}
                    {t.department && (
                      <>
                        <span>·</span>
                        <span>{t.department}</span>
                      </>
                    )}
                    <span>·</span>
                    <span>{t.lastReply ? `Last reply ${formatTicketDate(t.lastReply)}` : `Opened ${formatTicketDate(t.date)}`}</span>
                  </div>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden">
      <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <SectionIcon icon={CreditCard} tone="bg-amber-500/10 text-amber-600 dark:text-amber-500" />
          <div>
            <h2 className="text-sm font-semibold">Billing & Account Support</h2>
            <p className="text-xs text-muted-foreground">Mirrored from the billing portal</p>
          </div>
        </div>
        {data?.portalUrl && (
          <a href={data.portalUrl} target="_blank" rel="noopener noreferrer" data-testid="link-whmcs-tickets-portal">
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs w-full sm:w-auto">
              <ExternalLink className="w-3.5 h-3.5" />
              Open Portal
            </Button>
          </a>
        )}
      </div>
      {renderContent()}
    </div>
  );
}

/** Max files per reply — mirror of the server cap (WHMCS_REPLY_MAX_ATTACHMENTS). */
const MAX_REPLY_ATTACHMENTS = 5;

/**
 * Max bytes per attachment — mirror of the server's multer cap (25MB in
 * server/routes.ts). The server stays the source of truth; this only lets the
 * composer warn the customer before they hit send.
 */
const MAX_REPLY_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** Human-readable file size, e.g. "4.2 MB" / "812 KB". */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

interface TicketThreadProps {
  ticket: WhmcsTicketDetail | undefined;
  isLoading: boolean;
  isError?: boolean;
  context?: "customer" | "admin";
  onReply: (message: string, files: File[]) => void;
  replyPending: boolean;
  onBack?: () => void;
  /** Hint shown above the composer (e.g. admin staff-reply attribution note). */
  replyHint?: string;
  /** Build a download URL for an existing attachment (call-site supplies the base path). */
  buildAttachmentUrl?: (a: WhmcsAttachment) => string;
}

/** The full thread for one WHMCS ticket plus an inline reply composer. */
export function WhmcsTicketThread({
  ticket,
  isLoading,
  isError,
  context = "customer",
  onReply,
  replyPending,
  onBack,
  replyHint,
  buildAttachmentUrl,
}: TicketThreadProps) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Keep the reply composer visible above the on-screen keyboard on mobile.
  const keyboardInset = useKeyboardInset();

  const addFiles = (incoming: FileList | null) => {
    if (!incoming || incoming.length === 0) return;
    setFiles((prev) => [...prev, ...Array.from(incoming)].slice(0, MAX_REPLY_ATTACHMENTS));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  if (isLoading) {
    return (
      <div className="rounded-xl border border-card-border bg-card overflow-hidden" data-testid="whmcs-thread-loading">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <div className="px-5 py-6">
          <RowSkeletons rows={3} />
        </div>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="rounded-xl border border-card-border bg-card overflow-hidden p-6 space-y-4">
        {onBack && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onBack} data-testid="button-whmcs-thread-back">
            <ArrowLeft className="w-4 h-4" /> Back to tickets
          </Button>
        )}
        <EmptyState
          icon={AlertCircle}
          title="Ticket unavailable"
          description="We couldn't load this ticket. It may have been closed, or the billing system is unreachable."
          testid="whmcs-thread-error"
        />
      </div>
    );
  }

  const isClosed = ticket.statusKey === "closed";

  const hasOversizeFile = files.some((f) => f.size > MAX_REPLY_ATTACHMENT_BYTES);

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || replyPending || hasOversizeFile) return;
    onReply(trimmed, files);
    setDraft("");
    setFiles([]);
  };

  return (
    <div className="rounded-xl border border-card-border bg-card overflow-hidden flex flex-col" style={{ minHeight: "50vh" }} data-testid={`whmcs-thread-${ticket.id}`}>
      <div className="px-5 py-4 border-b border-border flex flex-col gap-3">
        {onBack && (
          <div>
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2 h-7" onClick={onBack} data-testid="button-whmcs-thread-back">
              <ArrowLeft className="w-4 h-4" /> Back to tickets
            </Button>
          </div>
        )}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 space-y-1">
            <h2 className="text-base sm:text-lg font-bold truncate" data-testid="text-whmcs-thread-subject">{ticket.subject}</h2>
            <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
              <Badge variant="outline" className={`h-5 text-[10px] px-1.5 font-medium ${ticketBadgeClass(ticket.statusKey)}`} data-testid="badge-whmcs-thread-status">
                {ticketStatusLabel(ticket)}
              </Badge>
              <span>·</span>
              <span className="font-mono text-[11px]">#{ticket.tid}</span>
              {ticket.department && (
                <>
                  <span>·</span>
                  <span>{ticket.department}</span>
                </>
              )}
              {ticket.date && (
                <>
                  <span>·</span>
                  <span>Opened {formatTicketDate(ticket.date)}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-amber-50 dark:bg-amber-950/20 border-b border-amber-100 dark:border-amber-900/30 px-5 py-2.5 text-xs text-amber-800 dark:text-amber-400 flex items-center gap-2 font-medium" data-testid="whmcs-thread-banner">
        <CreditCard className="w-4 h-4 shrink-0" />
        This is a billing &amp; account support ticket. It is separate from your native service tickets.
      </div>

      <div className="flex-1 p-5 space-y-6 overflow-y-auto" data-testid="whmcs-thread-messages">
        {ticket.messages.map((m) => {
          const isStaff = m.authorType === "staff";
          return (
            <div key={m.id} className={`flex gap-2 ${!isStaff ? "flex-row-reverse" : ""}`} data-testid={`whmcs-message-${m.id}`}>
              <div className="flex-shrink-0 mt-0.5">
                <Avatar className="w-8 h-8 sm:w-10 sm:h-10 border border-border shadow-sm">
                  <AvatarFallback className={`text-[13px] font-medium ${!isStaff ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                    {isStaff ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
                  </AvatarFallback>
                </Avatar>
              </div>
              <div className={`max-w-[85%] sm:max-w-[70%] min-w-0 space-y-0.5 ${!isStaff ? "items-end text-right" : ""}`}>
                <div className={`text-xs ${!isStaff ? "text-right" : ""}`}>
                  <span className="font-medium">{m.authorName}</span>
                  {isStaff && <span className="ml-1.5 text-[10px] text-muted-foreground">CowboyMedia Support</span>}
                </div>
                <div
                  className={`rounded-2xl p-3 sm:p-4 text-[15px] leading-relaxed whitespace-pre-wrap overflow-hidden shadow-sm border ${
                    !isStaff
                      ? "bg-primary border-transparent text-primary-foreground rounded-tr-sm"
                      : "bg-card border-card-border text-card-foreground rounded-tl-sm"
                  }`}
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  {m.message || <span className="opacity-60 italic">(no message)</span>}
                </div>
                {m.attachments.length > 0 && (
                  <div className={`flex flex-wrap gap-1.5 mt-2 ${!isStaff ? "justify-end" : ""}`} data-testid={`whmcs-message-attachments-${m.id}`}>
                    {m.attachments.map((a) => {
                      const url = buildAttachmentUrl?.(a);
                      const key = `${a.type}-${a.relatedId}-${a.index}`;
                      const inner = (
                        <>
                          <Paperclip className="w-3 h-3 shrink-0" />
                          <span className="truncate max-w-[180px]">{a.filename}</span>
                          {url && <Download className="w-3 h-3 shrink-0 opacity-70" />}
                        </>
                      );
                      return url ? (
                        <a
                          key={key}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground hover-elevate transition-colors"
                          data-testid={`link-whmcs-attachment-${key}`}
                        >
                          {inner}
                        </a>
                      ) : (
                        <span
                          key={key}
                          className="inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1.5 text-xs text-muted-foreground"
                          data-testid={`text-whmcs-attachment-${key}`}
                        >
                          {inner}
                        </span>
                      );
                    })}
                  </div>
                )}
                <p className={`text-[10px] text-muted-foreground mt-1 ${!isStaff ? "text-right" : ""}`}>
                  {formatTicketDate(m.date)}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {isClosed ? (
        <div className="bg-muted/30 border-t border-border px-5 py-4 text-sm text-muted-foreground text-center" data-testid="whmcs-thread-closed">
          This ticket is closed.
          {ticket.viewUrl && (
            <>
              {" "}
              <a href={ticket.viewUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline underline-offset-4 font-medium" data-testid="link-whmcs-thread-reopen">
                Reopen it in the billing portal
              </a>
            </>
          )}
        </div>
      ) : (
        <div
          className="border-t border-border bg-background/50 p-4 sm:p-5"
          style={keyboardInset > 0 ? { paddingBottom: Math.max(20, keyboardInset) } : undefined}
          data-testid="whmcs-thread-composer"
        >
          {replyHint && <p className="text-xs text-muted-foreground mb-3">{replyHint}</p>}
          <div className="rounded-xl border border-input bg-background overflow-hidden focus-within:ring-1 focus-within:ring-ring focus-within:border-ring transition-shadow">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => {
                setTimeout(() => e.target.scrollIntoView({ block: "center", behavior: "smooth" }), 250);
              }}
              placeholder={context === "admin" ? "Reply to this customer's billing ticket…" : "Type your reply..."}
              className="min-h-[100px] border-0 focus-visible:ring-0 resize-none rounded-none shadow-none"
              data-testid="input-whmcs-reply"
            />
            {files.length > 0 && (
              <div className="px-3 py-2 border-t border-border bg-muted/20 flex flex-wrap gap-1.5" data-testid="whmcs-reply-attachments">
                {files.map((f, i) => {
                  const oversize = f.size > MAX_REPLY_ATTACHMENT_BYTES;
                  return (
                    <span
                      key={`${f.name}-${i}`}
                      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${
                        oversize
                          ? "border-destructive/50 bg-destructive/10 text-destructive"
                          : "border-border bg-background text-foreground shadow-sm"
                      }`}
                      data-testid={`chip-whmcs-reply-attachment-${i}`}
                    >
                      {oversize ? (
                        <AlertTriangle className="w-3 h-3 shrink-0" />
                      ) : (
                        <Paperclip className="w-3 h-3 shrink-0" />
                      )}
                      <span className="truncate max-w-[160px] font-medium">{f.name}</span>
                      <span
                        className={oversize ? "shrink-0 font-medium" : "shrink-0 text-muted-foreground"}
                        data-testid={`text-whmcs-reply-attachment-size-${i}`}
                      >
                        ({formatFileSize(f.size)})
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        disabled={replyPending}
                        className={`ml-0.5 rounded-full p-0.5 hover:bg-muted ${oversize ? "hover:opacity-70" : "text-muted-foreground hover:text-foreground"}`}
                        aria-label={`Remove ${f.name}`}
                        data-testid={`button-whmcs-remove-attachment-${i}`}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}
            {hasOversizeFile && (
              <div
                className="px-3 py-2 border-t border-destructive/20 bg-destructive/5 flex items-center gap-1.5 text-xs text-destructive font-medium"
                data-testid="text-whmcs-reply-oversize-warning"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                Each file must be {formatFileSize(MAX_REPLY_ATTACHMENT_BYTES)} or smaller. Remove the flagged file(s) to send.
              </div>
            )}
            <div className="px-3 py-2 border-t border-border bg-muted/10 flex items-center justify-between">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-muted-foreground hover:text-foreground"
                onClick={() => fileInputRef.current?.click()}
                disabled={replyPending || files.length >= MAX_REPLY_ATTACHMENTS}
                data-testid="button-whmcs-attach"
              >
                <Paperclip className="w-4 h-4" />
                <span className="hidden sm:inline">Attach Files</span>
              </Button>
              <Button 
                onClick={submit} 
                disabled={replyPending || !draft.trim() || hasOversizeFile} 
                size="sm"
                className="h-8 gap-1.5 rounded-full px-4" 
                data-testid="button-whmcs-reply-send"
              >
                {replyPending ? (
                  <span className="flex items-center gap-1.5"><Skeleton className="w-3 h-3 rounded-full animate-pulse" /> Sending...</span>
                ) : (
                  <>Send Reply <Send className="w-3.5 h-3.5" /></>
                )}
              </Button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
            data-testid="input-whmcs-reply-file"
          />
        </div>
      )}
    </div>
  );
}
