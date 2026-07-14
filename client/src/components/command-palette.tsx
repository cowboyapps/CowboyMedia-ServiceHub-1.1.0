import { useEffect, useState, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/components/ui/command";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import {
  MessageSquare,
  BookOpen,
  Newspaper,
  Activity,
  Users,
  AlertTriangle,
  Plus,
  FileText,
  Shield,
  ArrowRight,
  Clock,
} from "lucide-react";

const RECENT_VISITS_KEY_PREFIX = "command-palette-recent-visits:";
const RECENT_VISITS_MAX = 20;
const RECENT_VISITS_SHOWN = 5;

export interface RecentVisit {
  key: string;
  kind: ResultGroupKey;
  title: string;
  url: string;
  ts: number;
}

// Scope recents per authenticated user so titles/URLs from one account
// never leak to another account that signs in on the same browser
// (e.g. admin → customer, or customer A → customer B). Without a userId
// the helpers are no-ops.
function storageKeyFor(userId: string | null | undefined): string | null {
  if (!userId) return null;
  return `${RECENT_VISITS_KEY_PREFIX}${userId}`;
}

export function readRecentVisits(userId: string | null | undefined): RecentVisit[] {
  const key = storageKeyFor(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is RecentVisit =>
        v && typeof v.key === "string" && typeof v.title === "string" && typeof v.url === "string",
    );
  } catch {
    return [];
  }
}

export function recordRecentVisit(userId: string | null | undefined, visit: Omit<RecentVisit, "ts">): void {
  const key = storageKeyFor(userId);
  if (!key) return;
  try {
    const existing = readRecentVisits(userId).filter((v) => v.key !== visit.key);
    const next = [{ ...visit, ts: Date.now() }, ...existing].slice(0, RECENT_VISITS_MAX);
    localStorage.setItem(key, JSON.stringify(next));
  } catch {}
}

// Strip recents the current user is not permitted to see — defends
// against a stored URL whose visibility changed (e.g. an admin who
// later got their adminRoleId revoked still has admin URLs in their
// own recents key).
function filterRecentsForRole(recents: RecentVisit[], isAdmin: boolean): RecentVisit[] {
  return recents.filter((r) => {
    if (!isAdmin && r.kind === "users") return false;
    if (!isAdmin && r.url.startsWith("/admin")) return false;
    return true;
  });
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

export function isQuickActionMode(query: string): boolean {
  const trimmed = query.trim();
  return trimmed.length === 0 || trimmed.startsWith(">");
}

export function quickActionNeedle(query: string): string {
  const t = query.trim();
  if (t.startsWith(">")) return t.slice(1).trim().toLowerCase();
  return "";
}

interface QuickAction {
  id: string;
  label: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface GroupMeta {
  heading: string;
  icon: React.ComponentType<{ className?: string }>;
  testIdPrefix: string;
}

const GROUP_META: Record<ResultGroupKey, GroupMeta> = {
  tickets: { heading: "Tickets", icon: MessageSquare, testIdPrefix: "command-ticket" },
  articles: { heading: "Knowledge base", icon: BookOpen, testIdPrefix: "command-article" },
  news: { heading: "News", icon: Newspaper, testIdPrefix: "command-news" },
  services: { heading: "Services", icon: Activity, testIdPrefix: "command-service" },
  alerts: { heading: "Alerts", icon: AlertTriangle, testIdPrefix: "command-alert" },
  users: { heading: "Users", icon: Users, testIdPrefix: "command-user" },
};

export const QUICK_ACTIONS: QuickAction[] = [
  { id: "qa-new-ticket", label: "New ticket", url: "/tickets?new=1", icon: Plus },
  { id: "qa-open-tickets", label: "Open tickets", url: "/tickets?status=open", icon: MessageSquare, adminOnly: true },
  { id: "qa-claimed-tickets", label: "My claimed tickets", url: "/tickets?claimedBy=me", icon: MessageSquare, adminOnly: true },
  { id: "qa-unclaimed-tickets", label: "Unclaimed tickets", url: "/tickets?claimedBy=unclaimed&status=open", icon: MessageSquare, adminOnly: true },
  { id: "qa-new-kb", label: "New KB article", url: "/admin?tab=knowledge&new=1", icon: FileText, adminOnly: true },
  { id: "qa-admin", label: "Open admin portal", url: "/admin", icon: Shield, adminOnly: true },
];

export function filterQuickActions(actions: QuickAction[], isAdmin: boolean, query: string): QuickAction[] {
  const needle = quickActionNeedle(query);
  return actions
    .filter((a) => (a.adminOnly ? isAdmin : true))
    .filter((a) => (needle ? a.label.toLowerCase().includes(needle) : true));
}

export type ResultGroupKey =
  | "tickets"
  | "articles"
  | "news"
  | "services"
  | "alerts"
  | "users";

/**
 * Returns the non-empty result groups in the order the palette renders
 * them. Used by the component and asserted by tests so the visible
 * output stays in sync with what the backend returned (no client-side
 * cmdk re-filtering — see CommandDialog `shouldFilter={false}`).
 */
export function buildVisibleGroups(
  results: SearchResults,
  isAdmin: boolean,
): { key: ResultGroupKey; items: SearchResult[] }[] {
  const order: ResultGroupKey[] = ["tickets", "articles", "news", "services", "alerts", "users"];
  return order
    .filter((key) => {
      if (key === "users" && !isAdmin) return false;
      return results[key].length > 0;
    })
    .map((key) => ({ key, items: results[key] }));
}

/**
 * Decides what should happen for a global keypress while the palette is
 * mounted. Returns "open" / "close" / "toggle" / null.
 *  - Cmd/Ctrl+K toggles
 *  - Esc closes (when open)
 */
export function paletteKeyAction(
  e: { key: string; metaKey?: boolean; ctrlKey?: boolean },
  isOpen: boolean,
): "toggle" | "close" | null {
  const isMod = !!e.metaKey || !!e.ctrlKey;
  if ((e.key === "k" || e.key === "K") && isMod) return "toggle";
  if (e.key === "Escape" && isOpen) return "close";
  return null;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 200);
  const [, setLocation] = useLocation();
  const { user, isAdmin } = useAuth();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = paletteKeyAction(e, open);
      if (action === "toggle") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (action === "close") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    function onTrigger() {
      setOpen(true);
    }
    window.addEventListener("open-command-palette", onTrigger);
    return () => window.removeEventListener("open-command-palette", onTrigger);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const trimmed = debounced.trim();
  const showQuickActions = isQuickActionMode(debounced);
  const enabled = !!user && open && !showQuickActions && trimmed.length > 0;

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ["/api/search", { q: trimmed, limit: 5 }],
    queryFn: async () => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(trimmed)}&limit=5`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`${res.status}`);
      return res.json();
    },
    enabled,
    staleTime: 30_000,
  });

  const results = data ?? EMPTY;
  const quickActions = useMemo(
    () => filterQuickActions(QUICK_ACTIONS, isAdmin, debounced),
    [isAdmin, debounced],
  );

  const navigate = (url: string, record?: { kind: ResultGroupKey; id: string; title: string }) => {
    setOpen(false);
    if (record && user?.id) {
      recordRecentVisit(user.id, {
        key: `${record.kind}:${record.id}`,
        kind: record.kind,
        title: record.title,
        url,
      });
    }
    if (url.startsWith("http")) {
      window.location.href = url;
      return;
    }
    setLocation(url);
  };

  const [recents, setRecents] = useState<RecentVisit[]>([]);
  useEffect(() => {
    if (open && user?.id) {
      setRecents(filterRecentsForRole(readRecentVisits(user.id), isAdmin));
    } else if (!open) {
      setRecents([]);
    }
  }, [open, user?.id, isAdmin]);

  const visibleGroups = useMemo(
    () => buildVisibleGroups(results, isAdmin),
    [results, isAdmin],
  );
  const totalResults = visibleGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} commandProps={{ shouldFilter: false }}>
      <CommandInput
        placeholder="Search tickets, articles, services… (use > for actions)"
        value={query}
        onValueChange={setQuery}
        data-testid="input-command-palette"
      />
      <CommandList>
        {showQuickActions ? (
          <>
            {debounced.trim().length === 0 && recents.length > 0 && (
              <CommandGroup heading="Recent">
                {recents.slice(0, RECENT_VISITS_SHOWN).map((r) => (
                  <CommandItem
                    key={r.key}
                    value={`recent-${r.key}`}
                    onSelect={() => navigate(r.url, { kind: r.kind, id: r.key.split(":").slice(1).join(":"), title: r.title })}
                    data-testid={`command-recent-${r.key}`}
                  >
                    <Clock className="text-muted-foreground" />
                    <span className="truncate">{r.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            <CommandGroup heading="Quick actions">
              {quickActions.length === 0 ? (
                <CommandEmpty>No actions match.</CommandEmpty>
              ) : (
                quickActions.map((a) => (
                  <CommandItem
                    key={a.id}
                    value={a.id}
                    onSelect={() => navigate(a.url)}
                    data-testid={`command-action-${a.id}`}
                  >
                    <a.icon className="text-muted-foreground" />
                    <span>{a.label}</span>
                    <ArrowRight className="ml-auto opacity-50" />
                  </CommandItem>
                ))
              )}
            </CommandGroup>
          </>
        ) : isFetching && totalResults === 0 ? (
          <div className="p-3 space-y-2" data-testid="command-skeleton">
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-6 w-2/3" />
          </div>
        ) : trimmed.length === 0 ? null : totalResults === 0 ? (
          <CommandEmpty data-testid="command-empty">No results.</CommandEmpty>
        ) : (
          visibleGroups.map((group, i) => (
            <div key={group.key}>
              {i > 0 && <CommandSeparator />}
              <ResultGroup
                heading={GROUP_META[group.key].heading}
                items={group.items}
                icon={GROUP_META[group.key].icon}
                onSelect={(url, item) => navigate(url, { kind: group.key, id: item.id, title: item.title })}
                testIdPrefix={GROUP_META[group.key].testIdPrefix}
              />
            </div>
          ))
        )}
      </CommandList>
    </CommandDialog>
  );
}

interface ResultGroupProps {
  heading: string;
  items: SearchResult[];
  icon: React.ComponentType<{ className?: string }>;
  onSelect: (url: string, item: SearchResult) => void;
  testIdPrefix: string;
}

function ResultGroup({ heading, items, icon: Icon, onSelect, testIdPrefix }: ResultGroupProps) {
  return (
    <CommandGroup heading={heading}>
      {items.map((item) => (
        <CommandItem
          key={item.id}
          value={`${testIdPrefix}-${item.id}-${item.title}`}
          onSelect={() => onSelect(item.url, item)}
          data-testid={`${testIdPrefix}-${item.id}`}
        >
          <Icon className="text-muted-foreground" />
          <div className="flex flex-col min-w-0 flex-1">
            <span className="truncate">{item.title}</span>
            {item.snippet && (
              <span className="text-xs text-muted-foreground truncate">
                {item.snippet}
              </span>
            )}
          </div>
        </CommandItem>
      ))}
    </CommandGroup>
  );
}
