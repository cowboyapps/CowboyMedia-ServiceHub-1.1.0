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
} from "lucide-react";

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

  const navigate = (url: string) => {
    setOpen(false);
    if (url.startsWith("http")) {
      window.location.href = url;
      return;
    }
    setLocation(url);
  };

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
                onSelect={navigate}
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
  onSelect: (url: string) => void;
  testIdPrefix: string;
}

function ResultGroup({ heading, items, icon: Icon, onSelect, testIdPrefix }: ResultGroupProps) {
  return (
    <CommandGroup heading={heading}>
      {items.map((item) => (
        <CommandItem
          key={item.id}
          value={`${testIdPrefix}-${item.id}-${item.title}`}
          onSelect={() => onSelect(item.url)}
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
