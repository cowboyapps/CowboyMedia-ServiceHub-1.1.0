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

export type QuickResponsePreviewSegment =
  | { kind: "text"; value: string }
  | { kind: "filled"; variable: string; value: string }
  | { kind: "missing"; variable: string; raw: string }
  | { kind: "unknown"; raw: string };

/**
 * Break a quick-response template into segments showing which placeholders
 * resolve against the given context and which are missing. Used to render a
 * live preview where unfilled `{{variable}}` slots are visually highlighted.
 */
export function tokenizeQuickResponseTemplate(
  template: string,
  ctx: QuickResponseVarContext,
): QuickResponsePreviewSegment[] {
  const segments: QuickResponsePreviewSegment[] = [];
  if (!template) return segments;
  let lastIndex = 0;
  PLACEHOLDER_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_RE.exec(template)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: template.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    const key = match[1];
    if (!(QUICK_RESPONSE_VARIABLES as readonly string[]).includes(key)) {
      segments.push({ kind: "unknown", raw });
    } else {
      const ctxVal = (ctx as Record<string, unknown>)[key];
      const value =
        ctxVal === undefined || ctxVal === null ? "" : String(ctxVal).trim();
      if (value.length === 0) {
        segments.push({ kind: "missing", variable: key, raw });
      } else {
        segments.push({ kind: "filled", variable: key, value });
      }
    }
    lastIndex = match.index + raw.length;
  }
  if (lastIndex < template.length) {
    segments.push({ kind: "text", value: template.slice(lastIndex) });
  }
  return segments;
}

export function quickResponseHasMissingVariables(
  template: string,
  ctx: QuickResponseVarContext,
): boolean {
  return tokenizeQuickResponseTemplate(template, ctx).some((s) => s.kind === "missing");
}

/**
 * Find any unfilled `{{...}}` placeholder tokens left in an outgoing message.
 * Returns the list of raw tokens (e.g. `"{{customer_name}}"`) for both known
 * variables that have no value in the given context and unknown `{{...}}`
 * tokens that don't match any documented variable. Used to warn admins before
 * a reply is sent with literal placeholders still in the body.
 */
export function findUnfilledPlaceholders(
  text: string,
  ctx: QuickResponseVarContext,
): string[] {
  return tokenizeQuickResponseTemplate(text, ctx)
    .filter((s) => s.kind === "missing" || s.kind === "unknown")
    .map((s) => (s as { raw: string }).raw);
}
