import type { Request, Response } from "express";
import "express-session";
import type {
  Service,
  ServiceAlert,
  NewsStory,
  Ticket,
  User,
  KbArticle,
} from "@shared/schema";

export interface SearchStorage {
  getUser(id: string): Promise<User | undefined>;
  getAllServices(): Promise<Service[]>;
  getAllAlerts(): Promise<ServiceAlert[]>;
  getAllNews(): Promise<NewsStory[]>;
  getAllUsers(): Promise<User[]>;
  getAllTickets(): Promise<Ticket[]>;
  getTicketsByCustomer(customerId: string): Promise<Ticket[]>;
  searchKbArticles(
    query: string,
    opts: { limit?: number; publishedOnly?: boolean },
  ): Promise<KbArticle[]>;
}

export interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
}

export interface SearchResults {
  tickets: SearchResult[];
  articles: SearchResult[];
  news: SearchResult[];
  services: SearchResult[];
  users: SearchResult[];
  alerts: SearchResult[];
}

const EMPTY: SearchResults = {
  tickets: [],
  articles: [],
  news: [],
  services: [],
  users: [],
  alerts: [],
};

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function snippetAround(text: string, needle: string, max = 120): string {
  const t = text || "";
  if (!t) return "";
  if (!needle) return t.length > max ? t.slice(0, max) + "…" : t;
  const idx = t.toLowerCase().indexOf(needle);
  if (idx < 0) return t.length > max ? t.slice(0, max) + "…" : t;
  const start = Math.max(0, idx - 30);
  const end = Math.min(t.length, idx + needle.length + (max - 30));
  return (start > 0 ? "…" : "") + t.slice(start, end) + (end < t.length ? "…" : "");
}

function ilike(haystack: string | null | undefined, needle: string): boolean {
  if (!haystack) return false;
  return haystack.toLowerCase().includes(needle);
}

export interface RunSearchOpts {
  limit?: number;
  /**
   * Category ids the admin can access. "*" means master_admin / all access.
   * Ignored for customers.
   */
  accessibleTicketCategoryIds?: string[] | "*";
}

export async function runSearch(
  rawQuery: string,
  user: Pick<User, "id" | "role">,
  storage: SearchStorage,
  opts: RunSearchOpts = {},
): Promise<SearchResults> {
  const q = (rawQuery || "").trim();
  if (!q) return { ...EMPTY };
  const needle = q.toLowerCase();
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));
  const isAdmin = user.role === "admin" || user.role === "master_admin";
  const isMaster = user.role === "master_admin";

  // ---- Users (admin-only) ----
  let userResults: SearchResult[] = [];
  let allUsers: User[] = [];
  if (isAdmin) {
    allUsers = await storage.getAllUsers();
    userResults = allUsers
      .filter(
        (u) =>
          ilike(u.fullName, needle) ||
          ilike(u.username, needle) ||
          ilike(u.email, needle),
      )
      .slice(0, limit)
      .map((u) => ({
        id: u.id,
        title: u.fullName || u.username,
        snippet: `${u.username} · ${u.email}`,
        url: "/admin",
      }));
  }

  // ---- Tickets ----
  let allTickets: Ticket[] = [];
  if (isAdmin) {
    allTickets = await storage.getAllTickets();
    if (!isMaster) {
      const access = opts.accessibleTicketCategoryIds;
      if (Array.isArray(access)) {
        allTickets = allTickets.filter(
          (t) => !t.categoryId || access.includes(t.categoryId),
        );
      }
      // Show only tickets unclaimed or claimed by this admin.
      allTickets = allTickets.filter(
        (t) => !t.claimedBy || t.claimedBy === user.id,
      );
    }
  } else {
    allTickets = await storage.getTicketsByCustomer(user.id);
  }
  // Build a customerId -> name map for admin search (so name matches work).
  let customersById = new Map<string, User>();
  if (isAdmin) {
    if (allUsers.length === 0) allUsers = await storage.getAllUsers();
    for (const u of allUsers) customersById.set(u.id, u);
  }
  const ticketResults: SearchResult[] = allTickets
    .filter((t) => {
      if (ilike(t.subject, needle)) return true;
      if (ilike(t.description, needle)) return true;
      if (isAdmin) {
        const cust = customersById.get(t.customerId);
        if (cust && (ilike(cust.fullName, needle) || ilike(cust.username, needle))) {
          return true;
        }
      }
      return false;
    })
    .slice(0, limit)
    .map((t) => ({
      id: t.id,
      title: t.subject,
      snippet: snippetAround(t.description, needle),
      url: `/tickets/${t.id}`,
    }));

  // ---- KB articles ----
  let articleResults: SearchResult[] = [];
  try {
    const articles = await storage.searchKbArticles(q, {
      limit,
      publishedOnly: !isAdmin,
    });
    articleResults = articles.slice(0, limit).map((a) => ({
      id: a.id,
      title: a.title,
      snippet: a.summary || snippetAround(stripHtml(a.bodyHtml), needle),
      url: `/knowledge/${a.slug}`,
    }));
  } catch {
    articleResults = [];
  }

  // ---- News ----
  const news = await storage.getAllNews();
  const newsResults: SearchResult[] = news
    .filter((n) => ilike(n.title, needle) || ilike(stripHtml(n.content), needle))
    .slice(0, limit)
    .map((n) => ({
      id: n.id,
      title: n.title,
      snippet: snippetAround(stripHtml(n.content), needle),
      url: `/news/${n.id}`,
    }));

  // ---- Services ----
  const services = await storage.getAllServices();
  const serviceResults: SearchResult[] = services
    .filter((s) => ilike(s.name, needle) || ilike(s.description, needle))
    .slice(0, limit)
    .map((s) => ({
      id: s.id,
      title: s.name,
      snippet: s.description || s.status,
      url: `/services/${s.id}`,
    }));

  // ---- Alerts ----
  const alerts = await storage.getAllAlerts();
  const alertResults: SearchResult[] = alerts
    .filter((a) => ilike(a.title, needle) || ilike(a.description, needle))
    .slice(0, limit)
    .map((a) => ({
      id: a.id,
      title: a.title,
      snippet: snippetAround(a.description, needle),
      url: `/alerts/${a.id}`,
    }));

  return {
    tickets: ticketResults,
    articles: articleResults,
    news: newsResults,
    services: serviceResults,
    users: userResults,
    alerts: alertResults,
  };
}

export interface SearchHandlerDeps {
  storage: SearchStorage;
  getAccessibleTicketCategoryIds: (userId: string) => Promise<string[] | "*">;
}

export function createSearchHandler(deps: SearchHandlerDeps) {
  return async function search(req: Request, res: Response) {
    try {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await deps.storage.getUser(req.session.userId);
      if (!user) return res.status(401).json({ message: "Unauthorized" });
      const q = typeof req.query.q === "string" ? req.query.q : "";
      const limit = Math.min(
        Math.max(parseInt(String(req.query.limit ?? "5"), 10) || 5, 1),
        20,
      );
      const isAdmin = user.role === "admin" || user.role === "master_admin";
      const isMaster = user.role === "master_admin";
      let access: string[] | "*" | undefined;
      if (isAdmin && !isMaster) {
        access = await deps.getAccessibleTicketCategoryIds(user.id);
      } else if (isMaster) {
        access = "*";
      }
      const results = await runSearch(q, user, deps.storage, {
        limit,
        accessibleTicketCategoryIds: access,
      });
      res.json(results);
    } catch (e: any) {
      res.status(500).json({ message: e?.message || "Search failed" });
    }
  };
}
