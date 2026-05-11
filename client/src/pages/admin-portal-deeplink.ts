import type { User } from "@shared/schema";

export interface AdminPortalQuery {
  tab: string | null;
  chat: string | null;
  monitor: string | null;
  ticket: string | null;
  section: string | null;
  user: string | null;
}

const EMPTY: AdminPortalQuery = {
  tab: null,
  chat: null,
  monitor: null,
  ticket: null,
  section: null,
  user: null,
};

export function parseAdminPortalQuery(search: string | null | undefined): AdminPortalQuery {
  if (!search) return { ...EMPTY };
  const sp = new URLSearchParams(search);
  return {
    tab: sp.get("tab"),
    chat: sp.get("chat"),
    monitor: sp.get("monitor"),
    ticket: sp.get("ticket"),
    section: sp.get("section"),
    user: sp.get("user"),
  };
}

export function shouldCleanInitialUrl(q: AdminPortalQuery): boolean {
  return Boolean(q.tab || q.chat || q.monitor || q.section || q.user);
}

export function computeInitialActiveSection(opts: {
  tabParam: string | null;
  hasDashboardView: boolean;
}): string | null {
  const t = opts.tabParam;
  if (t && t !== "support-tickets") return t;
  if (!t && opts.hasDashboardView) return "overview";
  return null;
}

export type InitialUserAction =
  | { kind: "wait" }
  | { kind: "noop" }
  | { kind: "open"; target: User };

export function computeInitialUserAction(opts: {
  initialUserId: string | null | undefined;
  users: User[] | null | undefined;
  didFocus: boolean;
}): InitialUserAction {
  if (opts.didFocus) return { kind: "noop" };
  if (!opts.initialUserId) return { kind: "noop" };
  if (!opts.users) return { kind: "wait" };
  const target = opts.users.find((u) => u.id === opts.initialUserId);
  if (!target) return { kind: "noop" };
  return { kind: "open", target };
}
