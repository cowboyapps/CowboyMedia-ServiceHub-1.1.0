// Lightweight Telegram-style markdown for community chat.
//
// Messages are stored as the raw shorthand text (single source of truth) and
// parsed into an inline node tree at render time. NO HTML is ever stored or
// parsed — the client renders the node tree with React elements, so there is
// no injection surface.
//
// Supported (single line-level, inline only):
//   **bold**   *italic*   ~~strikethrough~~   `inline code`
//   bare URLs (http/https) → links
//   @mentions → highlighted pills
//
// Code spans are atomic: no formatting or mentions inside them.

export type ChatInlineNode =
  | { type: "text"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; href: string; text: string }
  | { type: "mention"; username: string }
  | { type: "bold"; children: ChatInlineNode[] }
  | { type: "italic"; children: ChatInlineNode[] }
  | { type: "strike"; children: ChatInlineNode[] };

const MENTION_RE = /@([a-zA-Z0-9_\-]+)/;
const URL_RE = /https?:\/\/[^\s<>"'`]+/;

interface Matcher {
  type: "code" | "bold" | "strike" | "italic" | "link" | "mention";
  re: RegExp;
}

// Order matters only for ties at the same index: earlier entries win. Bold
// (**) must be tried before italic (*) so "**x**" isn't read as italic "*x*".
const MATCHERS: Matcher[] = [
  { type: "code", re: /`([^`\n]+)`/ },
  { type: "bold", re: /\*\*([^*\n](?:[^\n]*?[^*\n])?)\*\*/ },
  { type: "strike", re: /~~([^~\n](?:[^\n]*?[^~\n])?)~~/ },
  { type: "italic", re: /\*([^*\s\n](?:[^*\n]*?[^*\s\n])?)\*/ },
  { type: "link", re: URL_RE },
  { type: "mention", re: MENTION_RE },
];

// Trailing punctuation that shouldn't be swallowed into a bare URL.
function trimUrl(url: string): string {
  let u = url;
  while (/[.,;:!?)\]}]$/.test(u)) {
    // keep balanced closing paren, e.g. wikipedia links like .../Foo_(bar)
    if (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) >= (u.match(/\)/g)?.length ?? 0)) break;
    u = u.slice(0, -1);
  }
  return u;
}

export function parseChatMarkdown(text: string, depth = 0): ChatInlineNode[] {
  const nodes: ChatInlineNode[] = [];
  let rest = text;
  while (rest.length > 0) {
    let best: { m: RegExpExecArray; matcher: Matcher } | null = null;
    for (const matcher of MATCHERS) {
      // At depth > 0 (inside bold/italic/strike) still allow everything —
      // recursion is bounded below.
      const m = matcher.re.exec(rest);
      if (m && (best === null || m.index < best.m.index)) {
        best = { m, matcher };
      }
    }
    if (!best || depth >= 3) {
      nodes.push({ type: "text", text: rest });
      break;
    }
    const { m, matcher } = best;
    if (m.index > 0) {
      nodes.push({ type: "text", text: rest.slice(0, m.index) });
    }
    switch (matcher.type) {
      case "code":
        nodes.push({ type: "code", text: m[1] });
        rest = rest.slice(m.index + m[0].length);
        break;
      case "bold":
      case "strike":
      case "italic":
        nodes.push({ type: matcher.type, children: parseChatMarkdown(m[1], depth + 1) });
        rest = rest.slice(m.index + m[0].length);
        break;
      case "link": {
        const href = trimUrl(m[0]);
        nodes.push({ type: "link", href, text: href });
        rest = rest.slice(m.index + href.length);
        break;
      }
      case "mention":
        nodes.push({ type: "mention", username: m[1] });
        rest = rest.slice(m.index + m[0].length);
        break;
    }
  }
  return nodes;
}

/** True when the raw text contains any formatting/mention/link markup worth parsing. */
export function hasChatMarkup(text: string): boolean {
  return /[*`~@]|https?:\/\//.test(text);
}

/**
 * Strip formatting markers for plain-text surfaces (push notification
 * previews, reply-quote snippets). Mentions and URLs pass through as-is.
 */
export function stripChatFormatting(text: string): string {
  const walk = (ns: ChatInlineNode[]): string =>
    ns
      .map((n) => {
        switch (n.type) {
          case "text":
          case "code":
            return n.text;
          case "link":
            return n.href;
          case "mention":
            return `@${n.username}`;
          default:
            return walk(n.children);
        }
      })
      .join("");
  return walk(parseChatMarkdown(text));
}
