import {
  normalizeListField,
  getClientTickets,
  getTicket,
  type WhmcsRawFetch,
} from "./whmcs";
import { normalizeWhmcsDate } from "./whmcs-billing";

// Read-on-demand WHMCS support-ticket assembler (Task #334). ServiceHub NEVER
// stores WHMCS tickets — they are mirrored on view only, kept completely
// separate from native ServiceHub tickets so native behaviour is untouched.
// The pure functions here turn raw WHMCS results into locked shapes shared by
// the customer self routes and the admin customer-detail routes. They never
// touch the network — the async orchestrators at the bottom fetch + cache and
// delegate shaping to these pure builders.

// --- Pure helpers (unit-tested without network) ---

export type TicketStatusKey =
  | "open"
  | "answered"
  | "customer_reply"
  | "in_progress"
  | "on_hold"
  | "closed"
  | "other";

/**
 * Map a raw WHMCS ticket status string to a stable key. WHMCS ships these
 * defaults: Open, Answered, Customer-Reply, In Progress, On Hold, Closed.
 * Anything custom (admins can add statuses) collapses to "other" so the UI
 * still renders it (via the raw label) without a code change.
 */
export function normalizeTicketStatus(raw: any): TicketStatusKey {
  const s = String(raw ?? "").trim().toLowerCase();
  switch (s) {
    case "open":
      return "open";
    case "answered":
      return "answered";
    case "customer-reply":
    case "customer reply":
      return "customer_reply";
    case "in progress":
      return "in_progress";
    case "on hold":
      return "on_hold";
    case "closed":
      return "closed";
    default:
      return "other";
  }
}

/** A closed WHMCS ticket — used to split open vs. closed lists in the UI. */
export function isClosedStatus(key: TicketStatusKey): boolean {
  return key === "closed";
}

/** Outbound deep link to view a single ticket in the WHMCS client area. */
export function buildTicketViewUrl(baseUrl: string | null, id: number): string | null {
  if (!baseUrl || !id) return null;
  return `${baseUrl}/viewticket.php?tid=${id}`;
}

/** Outbound link to the WHMCS client-area support tickets list. */
export function buildTicketsPortalUrl(baseUrl: string | null): string | null {
  if (!baseUrl) return null;
  return `${baseUrl}/supporttickets.php`;
}

export interface ParsedTicketSummary {
  /** Numeric ticket id (tblTickets.id) — required by GetTicket / AddTicketReply. */
  id: number;
  /** Human ticket number ("tid", e.g. "832910") shown to the user. */
  tid: string;
  subject: string;
  status: string;
  statusKey: TicketStatusKey;
  department: string;
  priority: string;
  /** When the ticket was opened (YYYY-MM-DD) or null. */
  date: string | null;
  /** Last activity timestamp (YYYY-MM-DD) or null. */
  lastReply: string | null;
}

/** Map a raw WHMCS GetTickets record into our normalized summary shape. */
export function parseTicketSummary(raw: any): ParsedTicketSummary {
  const id = Number(raw?.id ?? raw?.ticketid ?? 0);
  const status = String(raw?.status ?? "").trim();
  return {
    id,
    tid: String(raw?.tid ?? "").trim() || String(id),
    subject: String(raw?.subject ?? "").trim() || "(no subject)",
    status,
    statusKey: normalizeTicketStatus(status),
    department: String(raw?.deptname ?? raw?.department ?? "").trim(),
    priority: String(raw?.priority ?? "").trim(),
    date: normalizeWhmcsDate(raw?.date),
    lastReply: normalizeWhmcsDate(raw?.lastreply),
  };
}

export type ReplyAuthorType = "client" | "staff" | "other";

export interface ParsedReply {
  /** Stable id for React keys: real replyid when present, else a synthesized one. */
  id: string;
  authorName: string;
  authorType: ReplyAuthorType;
  date: string | null;
  message: string;
}

/**
 * Decide whether a ticket message came from staff or the client. WHMCS marks
 * messages a few different ways depending on version/action: `requestor_type`
 * ("Owner"/"Member" = client, "Operator"/"Admin" = staff), or a non-empty
 * `admin` field (the staff member's name) on staff replies.
 */
export function deriveReplyAuthorType(raw: any): ReplyAuthorType {
  const requestor = String(raw?.requestor_type ?? "").trim().toLowerCase();
  if (requestor === "operator" || requestor === "admin") return "staff";
  if (requestor === "owner" || requestor === "member") return "client";
  if (String(raw?.admin ?? "").trim()) return "staff";
  return requestor ? "other" : "client";
}

/** Map a raw WHMCS reply record (and the opening message) into our shape. */
export function parseReply(raw: any, index: number): ParsedReply {
  const authorType = deriveReplyAuthorType(raw);
  const adminName = String(raw?.admin ?? "").trim();
  const name = String(raw?.name ?? "").trim();
  const authorName =
    authorType === "staff"
      ? adminName || name || "Support"
      : name || "You";
  const replyId = raw?.replyid ?? raw?.id;
  return {
    id: replyId ? String(replyId) : `msg-${index}`,
    authorName,
    authorType,
    date: normalizeWhmcsDate(raw?.date),
    message: String(raw?.message ?? "").trim(),
  };
}

export interface ParsedTicketDetail {
  id: number;
  tid: string;
  subject: string;
  status: string;
  statusKey: TicketStatusKey;
  department: string;
  priority: string;
  date: string | null;
  /** Owning WHMCS client id (tblTickets.userid) — used for ownership checks. */
  ownerClientId: number;
  messages: ParsedReply[];
  viewUrl: string | null;
}

/**
 * Shape a raw WHMCS GetTicket result into the locked ticket-detail shape.
 * Pure: takes the already-fetched result so it's testable without network.
 * Returns null when the read failed or carried no ticket id, so callers can
 * cleanly map that to "unreachable" / 404.
 *
 * The opening post is folded into the message thread: modern WHMCS includes it
 * as the first `replies.reply` entry, but older shapes carry it only as the
 * top-level `message`. We synthesize an opening message from the top-level
 * fields when the replies array is empty so the first post is never lost.
 */
export function buildTicketDetail(result: WhmcsRawFetch, baseUrl: string | null): ParsedTicketDetail | null {
  if (!result.ok || !result.data) return null;
  const d = result.data;
  const id = Number(d?.id ?? d?.ticketid ?? 0);
  if (!id) return null;

  const replies = normalizeListField(d?.replies, "reply");
  const messages: ParsedReply[] = replies.length
    ? replies.map((r, i) => parseReply(r, i))
    : [
        parseReply(
          {
            requestor_type: "Owner",
            name: d?.name,
            admin: d?.admin,
            date: d?.date,
            message: d?.message,
          },
          0,
        ),
      ];

  const status = String(d?.status ?? "").trim();
  return {
    id,
    tid: String(d?.tid ?? "").trim() || String(id),
    subject: String(d?.subject ?? "").trim() || "(no subject)",
    status,
    statusKey: normalizeTicketStatus(status),
    department: String(d?.deptname ?? d?.department ?? "").trim(),
    priority: String(d?.priority ?? "").trim(),
    date: normalizeWhmcsDate(d?.date),
    ownerClientId: Number(d?.userid ?? 0),
    messages,
    viewUrl: buildTicketViewUrl(baseUrl, id),
  };
}

export interface TicketsListData {
  tickets: ParsedTicketSummary[];
  portalUrl: string | null;
  /** True only when WHMCS was wholly unreachable. */
  unreachable: boolean;
}

/** Shape a raw GetTickets result into the sorted ticket list. */
export function buildTicketsList(result: WhmcsRawFetch, baseUrl: string | null): TicketsListData {
  if (!result.ok) {
    return { tickets: [], portalUrl: buildTicketsPortalUrl(baseUrl), unreachable: true };
  }
  const tickets = normalizeListField(result.data?.tickets, "ticket")
    .map(parseTicketSummary)
    .filter((t) => t.id > 0)
    // Most recent activity first (lastReply desc, falling back to opened date).
    .sort((a, b) => {
      const ka = a.lastReply ?? a.date ?? "";
      const kb = b.lastReply ?? b.date ?? "";
      if (ka === kb) return b.id - a.id;
      if (!ka) return 1;
      if (!kb) return -1;
      return kb.localeCompare(ka);
    });
  return { tickets, portalUrl: buildTicketsPortalUrl(baseUrl), unreachable: false };
}

// --- Async orchestrators + small in-memory cache (not network-free) ---

const LIST_TTL_MS = 60_000;
interface ListCacheEntry {
  at: number;
  data: TicketsListData;
}
const listCache = new Map<number, ListCacheEntry>();

/**
 * Fetch + assemble a client's ticket list, with a short per-client TTL cache to
 * cap outbound WHMCS calls under repeated views. Keyed by clientId (per-user
 * UNIQUE, so no cross-user leak). Never throws (the fetcher is no-throw) and
 * never caches a full outage so a transient failure isn't pinned for the TTL.
 */
export async function loadTicketsList(clientId: number, baseUrl: string | null): Promise<TicketsListData> {
  const now = Date.now();
  const cached = listCache.get(clientId);
  if (cached && now - cached.at < LIST_TTL_MS) return cached.data;

  const result = await getClientTickets(clientId);
  const data = buildTicketsList(result, baseUrl);
  if (!data.unreachable) listCache.set(clientId, { at: now, data });
  return data;
}

/**
 * Fetch + assemble one ticket's full thread. NOT cached — a ticket is viewed
 * far less often than the list and must be fresh right after a reply. Returns
 * null when WHMCS is unreachable or the ticket doesn't exist.
 */
export async function loadTicketDetail(ticketId: number, baseUrl: string | null): Promise<ParsedTicketDetail | null> {
  const result = await getTicket(ticketId);
  return buildTicketDetail(result, baseUrl);
}

/** Drop the cached ticket list for a client after they post a reply. */
export function bustTicketsListCache(clientId: number): void {
  listCache.delete(clientId);
}
