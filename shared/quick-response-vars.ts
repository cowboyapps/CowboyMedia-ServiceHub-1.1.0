export type QuickResponseVarContext = {
  customer_name?: string | null;
  ticket_subject?: string | null;
  admin_name?: string | null;
};

export const QUICK_RESPONSE_VARIABLES = [
  "customer_name",
  "ticket_subject",
  "admin_name",
] as const;

export type QuickResponseVariable = (typeof QUICK_RESPONSE_VARIABLES)[number];

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

export const QUICK_RESPONSE_RECENT_MAX = 5;

export function nextRecentList(
  current: readonly string[],
  insertedId: string,
  max: number = QUICK_RESPONSE_RECENT_MAX,
): string[] {
  return [insertedId, ...current.filter((id) => id !== insertedId)].slice(0, max);
}

export type QuickResponseInsertEffects = {
  bumpUsage: (id: string) => void;
  saveRecent: (next: string[]) => void;
  closePicker: () => void;
};

export function recordQuickResponseInsertion(
  opts: { inserted: boolean; id: string; recent: readonly string[] } & QuickResponseInsertEffects,
): void {
  if (!opts.inserted) return;
  opts.bumpUsage(opts.id);
  opts.saveRecent(nextRecentList(opts.recent, opts.id));
  opts.closePicker();
}

export function applyQuickResponseVariables(
  template: string,
  ctx: QuickResponseVarContext,
): string {
  if (!template) return "";
  return template.replace(PLACEHOLDER_RE, (match, key: string) => {
    if (!(QUICK_RESPONSE_VARIABLES as readonly string[]).includes(key)) {
      return match;
    }
    const raw = (ctx as Record<string, unknown>)[key];
    if (raw === undefined || raw === null) return match;
    const value = String(raw).trim();
    if (value.length === 0) return match;
    return value;
  });
}
