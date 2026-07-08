// Shared HTML → plain-text helpers for content authored with the rich text
// editor. Fan-out channels that can't render HTML (Telegram, Discord embeds,
// email template variables, web push bodies) must strip through here so every
// channel renders the same readable plain text. Legacy plain-text content
// passes through unchanged (no tags to strip, entities untouched only when
// absent — plain text containing e.g. "&" is unaffected).

export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content ?? "");
}

// Strips tags while preserving paragraph/line-break structure, so multi-line
// rich content stays readable in plain-text channels.
export function stripHtmlPreserveBreaks(html: string): string {
  let s = String(html ?? "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

// Single-line variant for compact contexts (push bodies, list previews,
// activity-log summaries): breaks collapse to a separator.
export function htmlToPlainTextInline(html: string): string {
  return stripHtmlPreserveBreaks(html).replace(/\n+/g, " — ").replace(/\s+/g, " ").trim();
}
