// Pure helpers shared between server (route) and tests for the
// "agent appends a bullet to the current APP_VERSION's draft" workflow.
//
// The agent should never rewrite an entire body — instead it sends one
// bullet at a time, scoped to a heading bucket. The server merges that
// bullet into the existing bodyHtml (creating the heading if missing),
// then re-sanitizes the result through the existing news-content
// sanitizer before persisting.
//
// Output style matches what TipTap (the admin's RichTextEditor) emits and
// what the existing sanitizer allows: plain `<h3>`, `<ul>`, `<li>` with
// no class/style attributes. That way the rendered output in the popup
// preview, the customer popup body, and the /whats-new page all look
// identical whether the bullet was hand-typed or agent-appended.

export const BULLET_HEADINGS = ["New", "Improved", "Fixed"] as const;
export type BulletHeading = (typeof BULLET_HEADINGS)[number];

export function isBulletHeading(value: unknown): value is BulletHeading {
  return typeof value === "string" && (BULLET_HEADINGS as readonly string[]).includes(value);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Append a single bullet under the given heading inside the bodyHtml.
 *
 * - If a `<h3>{heading}</h3>` followed by a `<ul>` already exists, the new
 *   `<li>` is appended to the end of that list.
 * - If no such section exists, a fresh `<h3>{heading}</h3><ul><li>…</li></ul>`
 *   is appended to the end of the body.
 * - The bullet text is HTML-escaped — the agent only ever writes plain
 *   text bullets, never HTML markup.
 * - Empty/whitespace-only bullets are a no-op (returns body unchanged).
 *
 * Heading match is case-insensitive on the heading word and tolerates
 * surrounding whitespace inside the `<h3>` tag.
 */
export function appendBulletToBody(
  bodyHtml: string,
  heading: BulletHeading,
  bullet: string,
): string {
  const body = (bodyHtml ?? "").trim();
  const safeBullet = escapeHtml((bullet ?? "").trim());
  if (!safeBullet) return body;

  const re = new RegExp(
    `(<h3\\b[^>]*>\\s*${heading}\\s*<\\/h3>\\s*<ul\\b[^>]*>)([\\s\\S]*?)(<\\/ul>)`,
    "i",
  );
  if (re.test(body)) {
    return body.replace(re, (_m, open: string, items: string, close: string) => {
      // Strip a single trailing whitespace/newline run inside the <ul> so
      // the new <li> tucks in cleanly instead of leaving a dangling gap.
      const trimmedItems = items.replace(/\s+$/, "");
      return `${open}${trimmedItems}<li>${safeBullet}</li>${close}`;
    });
  }

  const section = `<h3>${heading}</h3><ul><li>${safeBullet}</li></ul>`;
  return body ? `${body}${section}` : section;
}

/**
 * Cheap bullet count for the "N bullets so far" status line in the
 * Changelog tab. Counts `<li>` opens, ignoring attributes — good enough
 * for a status hint, and resilient to sanitized body shapes.
 */
export function countBulletsInBody(bodyHtml: string | null | undefined): number {
  if (!bodyHtml) return 0;
  const matches = bodyHtml.match(/<li\b/gi);
  return matches ? matches.length : 0;
}
