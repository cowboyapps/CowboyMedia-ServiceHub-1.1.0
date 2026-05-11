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

/** Regex source for matching `{{variable}}` tokens in template/message text. */
export const PLACEHOLDER_TOKEN_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;

/** Human-friendly labels for the recognized quick-response variables. */
export const PLACEHOLDER_VARIABLE_LABELS: Record<string, string> = {
  customer_name: "Customer name",
  ticket_subject: "Ticket subject",
  admin_name: "Your full name",
};

/** Reasons shown when a known variable resolves to an empty value at send time. */
export const PLACEHOLDER_EMPTY_REASONS: Record<string, string> = {
  customer_name: "This customer has no full name on file.",
  ticket_subject: "This ticket has no subject set.",
  admin_name: "Your account has no full name set.",
};

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
  return template.replace(PLACEHOLDER_TOKEN_RE, (match, key: string) => {
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
  PLACEHOLDER_TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER_TOKEN_RE.exec(template)) !== null) {
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
export type PlaceholderOverlayPart =
  | { kind: "text"; value: string }
  | { kind: "filled-token"; raw: string; variable: string; value: string; start: number; end: number }
  | { kind: "missing-token"; raw: string; variable: string; start: number; end: number; currentValue: string }
  | { kind: "unknown-token"; raw: string; start: number; end: number };

/**
 * Walk a draft message and split it into overlay parts that track the
 * exact `[start, end)` offsets of every `{{...}}` placeholder. The textarea
 * overlay in the ticket reply composer uses these offsets to position
 * highlights/popovers and to splice replacements in the right place.
 *
 * Pure helper: no React, no DOM, safe to call repeatedly.
 */
export function walkPlaceholderOverlay(
  text: string,
  ctx: QuickResponseVarContext,
): PlaceholderOverlayPart[] {
  const out: PlaceholderOverlayPart[] = [];
  if (!text) return out;
  const re = new RegExp(PLACEHOLDER_TOKEN_RE.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: "text", value: text.slice(last, m.index) });
    }
    const raw = m[0];
    const key = m[1];
    const start = m.index;
    const end = m.index + raw.length;
    const isKnown = (QUICK_RESPONSE_VARIABLES as readonly string[]).includes(key);
    if (!isKnown) {
      out.push({ kind: "unknown-token", raw, start, end });
    } else {
      const ctxV = (ctx as Record<string, unknown>)[key];
      const v = ctxV == null ? "" : String(ctxV).trim();
      if (v.length === 0) {
        out.push({ kind: "missing-token", raw, variable: key, start, end, currentValue: v });
      } else {
        out.push({ kind: "filled-token", raw, variable: key, value: v, start, end });
      }
    }
    last = end;
  }
  if (last < text.length) {
    out.push({ kind: "text", value: text.slice(last) });
  }
  return out;
}

export function findUnfilledPlaceholders(
  text: string,
  ctx: QuickResponseVarContext,
): string[] {
  return tokenizeQuickResponseTemplate(text, ctx)
    .filter((s) => s.kind === "missing" || s.kind === "unknown")
    .map((s) => (s as { raw: string }).raw);
}

/**
 * Find any `{{...}}` tokens in a template whose variable name is NOT one of
 * the documented quick-response variables. Used at template-save time to warn
 * admins about typos like `{{customername}}` before the template is shared.
 * The returned list is de-duplicated and preserves first-occurrence order.
 */
export function findUnknownPlaceholders(template: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const seg of tokenizeQuickResponseTemplate(template, {})) {
    if (seg.kind !== "unknown") continue;
    if (seen.has(seg.raw)) continue;
    seen.add(seg.raw);
    out.push(seg.raw);
  }
  return out;
}
