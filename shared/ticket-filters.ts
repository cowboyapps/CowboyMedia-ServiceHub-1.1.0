export type TicketStatusFilter = "open" | "closed" | "all";
export type TicketClaimFilter = "any" | "me" | "unclaimed" | string;
export type TicketPriorityFilter = "any" | "low" | "medium" | "high";

export interface TicketFilters {
  status: TicketStatusFilter;
  categoryId: string | null;
  claimedBy: TicketClaimFilter;
  priority: TicketPriorityFilter;
}

export const DEFAULT_TICKET_FILTERS: TicketFilters = {
  status: "open",
  categoryId: null,
  claimedBy: "any",
  priority: "any",
};

function parseStatus(v: string | null): TicketStatusFilter {
  if (v === "open" || v === "closed" || v === "all") return v;
  return "open";
}

function parseClaim(v: string | null): TicketClaimFilter {
  if (!v) return "any";
  if (v === "me" || v === "unclaimed" || v === "any") return v;
  return v;
}

function parsePriority(v: string | null): TicketPriorityFilter {
  if (v === "low" || v === "medium" || v === "high") return v;
  return "any";
}

export function parseTicketFiltersFromSearch(search: string): TicketFilters {
  const sp = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    status: parseStatus(sp.get("status")),
    categoryId: sp.get("category") || null,
    claimedBy: parseClaim(sp.get("claimedBy")),
    priority: parsePriority(sp.get("priority")),
  };
}

export function buildTicketFilterSearch(filters: TicketFilters): string {
  const sp = new URLSearchParams();
  if (filters.status !== DEFAULT_TICKET_FILTERS.status) sp.set("status", filters.status);
  if (filters.categoryId) sp.set("category", filters.categoryId);
  if (filters.claimedBy && filters.claimedBy !== "any") sp.set("claimedBy", filters.claimedBy);
  if (filters.priority && filters.priority !== "any") sp.set("priority", filters.priority);
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export interface FilterableTicket {
  status: string;
  priority: string;
  categoryId: string | null;
  claimedBy: string | null;
}

export function applyTicketFilters<T extends FilterableTicket>(
  tickets: T[],
  filters: TicketFilters,
  currentUserId: string | null,
): T[] {
  return tickets.filter((t) => {
    if (filters.status !== "all" && t.status !== filters.status) return false;
    if (filters.categoryId && t.categoryId !== filters.categoryId) return false;
    if (filters.priority !== "any" && t.priority !== filters.priority) return false;
    if (filters.claimedBy === "me") {
      if (!currentUserId || t.claimedBy !== currentUserId) return false;
    } else if (filters.claimedBy === "unclaimed") {
      if (t.claimedBy) return false;
    } else if (filters.claimedBy !== "any") {
      if (t.claimedBy !== filters.claimedBy) return false;
    }
    return true;
  });
}

export function filtersAreActive(filters: TicketFilters): boolean {
  return (
    filters.status !== DEFAULT_TICKET_FILTERS.status ||
    filters.categoryId !== null ||
    filters.claimedBy !== "any" ||
    filters.priority !== "any"
  );
}
