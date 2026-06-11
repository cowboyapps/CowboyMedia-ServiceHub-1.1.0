import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";

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

export interface WhmcsReply {
  id: string;
  authorName: string;
  authorType: ReplyAuthorType;
  date: string | null;
  message: string;
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
        <div className="space-y-2" data-testid="whmcs-tickets-loading">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
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
}

/**
 * The list of a client's WHMCS tickets. On the customer page this lives inside a
 * clearly-labelled "Billing & account support" card; in the admin panel it's a
 * section under the customer's billing link. Returns null (renders nothing) for
 * the hidden customer states so native tickets stay the focus.
 */
export function WhmcsTicketList({ data, isLoading, context = "customer", onOpen }: TicketListProps) {
  const isAdmin = context === "admin";
  const guard = listGuard(data, isLoading, isAdmin);
  if (guard.kind === "hide") return null;
  if (guard.kind === "node") return guard.node;

  const tickets = data!.tickets;
  if (tickets.length === 0) {
    return (
      <p className="text-sm text-muted-foreground px-1 py-3" data-testid="whmcs-tickets-none">
        {isAdmin ? "No billing tickets for this customer." : "You don't have any billing or account support tickets."}
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="whmcs-tickets-list">
      {data!.portalUrl && (
        <div className="flex justify-end">
          <a href={data!.portalUrl} target="_blank" rel="noopener noreferrer" data-testid="link-whmcs-tickets-portal">
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="w-3.5 h-3.5" />
              Open in billing portal
            </Button>
          </a>
        </div>
      )}
      {tickets.map((t) => (
        <Card
          key={t.id}
          className="hover-elevate tap-interactive cursor-pointer"
          onClick={() => onOpen(t.id)}
          data-testid={`card-whmcs-ticket-${t.id}`}
        >
          <CardContent className="flex items-start justify-between gap-3 p-3.5">
            <div className="flex items-start gap-3 min-w-0">
              <LifeBuoy className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="min-w-0 space-y-1">
                <h3 className="font-semibold text-sm truncate" data-testid={`text-whmcs-ticket-subject-${t.id}`}>{t.subject}</h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={ticketBadgeClass(t.statusKey)} data-testid={`badge-whmcs-ticket-status-${t.id}`}>
                    {ticketStatusLabel(t)}
                  </Badge>
                  {t.department && <Badge variant="secondary" className="text-xs">{t.department}</Badge>}
                  <span className="text-xs text-muted-foreground">#{t.tid}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.lastReply ? `Last reply ${formatTicketDate(t.lastReply)}` : `Opened ${formatTicketDate(t.date)}`}
                </p>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0 mt-1" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

interface TicketThreadProps {
  ticket: WhmcsTicketDetail | undefined;
  isLoading: boolean;
  isError?: boolean;
  context?: "customer" | "admin";
  onReply: (message: string) => void;
  replyPending: boolean;
  onBack?: () => void;
  /** Hint shown above the composer (e.g. admin staff-reply attribution note). */
  replyHint?: string;
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
}: TicketThreadProps) {
  const [draft, setDraft] = useState("");

  if (isLoading) {
    return (
      <div className="space-y-3" data-testid="whmcs-thread-loading">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 rounded-lg" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="space-y-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={onBack} data-testid="button-whmcs-thread-back">
            <ArrowLeft className="w-4 h-4" /> Back
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

  const submit = () => {
    const trimmed = draft.trim();
    if (!trimmed || replyPending) return;
    onReply(trimmed);
    setDraft("");
  };

  return (
    <div className="space-y-4" data-testid={`whmcs-thread-${ticket.id}`}>
      <div className="space-y-2">
        {onBack && (
          <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={onBack} data-testid="button-whmcs-thread-back">
            <ArrowLeft className="w-4 h-4" /> Back to tickets
          </Button>
        )}
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold truncate" data-testid="text-whmcs-thread-subject">{ticket.subject}</h2>
            <p className="text-xs text-muted-foreground">
              Ticket #{ticket.tid}
              {ticket.department ? ` · ${ticket.department}` : ""}
              {ticket.date ? ` · Opened ${formatTicketDate(ticket.date)}` : ""}
            </p>
          </div>
          <Badge variant="outline" className={ticketBadgeClass(ticket.statusKey)} data-testid="badge-whmcs-thread-status">
            {ticketStatusLabel(ticket)}
          </Badge>
        </div>
      </div>

      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground flex items-center gap-2" data-testid="whmcs-thread-banner">
        <CreditCard className="w-3.5 h-3.5 shrink-0" />
        This is a billing &amp; account support ticket from our billing system, separate from your support tickets here.
      </div>

      <div className="space-y-3" data-testid="whmcs-thread-messages">
        {ticket.messages.map((m) => {
          const isStaff = m.authorType === "staff";
          return (
            <div key={m.id} className={`flex gap-2 ${isStaff ? "" : "flex-row-reverse"}`} data-testid={`whmcs-message-${m.id}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isStaff ? "bg-primary/10 text-primary" : "bg-accent text-accent-foreground"}`}>
                {isStaff ? <Shield className="w-4 h-4" /> : <UserIcon className="w-4 h-4" />}
              </div>
              <div className={`max-w-[85%] min-w-0 space-y-1 ${isStaff ? "" : "items-end"}`}>
                <div className={`flex items-center gap-1.5 text-xs ${isStaff ? "" : "justify-end"}`}>
                  <span className="font-medium">{m.authorName}</span>
                  {isStaff && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Support</span>}
                </div>
                <div
                  className={`rounded-lg p-3 text-sm whitespace-pre-wrap overflow-hidden ${isStaff ? "bg-accent" : "bg-primary text-primary-foreground"}`}
                  style={{ overflowWrap: "anywhere", wordBreak: "break-word" }}
                >
                  {m.message || <span className="opacity-60">(no message)</span>}
                </div>
                <p className={`text-[10px] text-muted-foreground ${isStaff ? "" : "text-right"}`}>{formatTicketDate(m.date)}</p>
              </div>
            </div>
          );
        })}
      </div>

      {isClosed ? (
        <div className="rounded-md border px-3 py-3 text-sm text-muted-foreground text-center" data-testid="whmcs-thread-closed">
          This ticket is closed.
          {ticket.viewUrl && (
            <>
              {" "}
              <a href={ticket.viewUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline" data-testid="link-whmcs-thread-reopen">
                Reopen it in the billing portal
              </a>
              .
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 border-t pt-3" data-testid="whmcs-thread-composer">
          {replyHint && <p className="text-xs text-muted-foreground">{replyHint}</p>}
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={context === "admin" ? "Reply to this customer's billing ticket…" : "Write a reply…"}
            className="min-h-[90px]"
            data-testid="input-whmcs-reply"
          />
          <div className="flex justify-end">
            <Button onClick={submit} disabled={replyPending || !draft.trim()} className="gap-1.5" data-testid="button-whmcs-reply-send">
              <Send className="w-4 h-4" />
              {replyPending ? "Sending…" : "Send reply"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
