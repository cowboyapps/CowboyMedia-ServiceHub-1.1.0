export type MessagePart =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string; label: string; internal?: boolean };

/** Presentation-only link recognition; the stored message is never rewritten. */
export function splitMessageLinks(value: string): MessagePart[] {
  const parts: MessagePart[] = [];
  const expression = /https?:\/\/[^\s<>"']+|(?<![\w/])\/(?:tickets(?:\/[A-Za-z0-9_-]+)?|knowledge(?:\/[A-Za-z0-9_-]+)?|services(?:\/[A-Za-z0-9_-]+)?|alerts(?:\/[A-Za-z0-9_-]+)?|news(?:\/[A-Za-z0-9_-]+)?|messages(?:\/[A-Za-z0-9_-]+)?|settings|billing|my-services|downloads|community|admin)(?:[?#][^\s<>"']*)?/gi;
  let cursor = 0;
  for (const match of value.matchAll(expression)) {
    const start = match.index ?? 0;
    const raw = match[0];
    let urlText = raw.replace(/[,.!;]+$/g, "");
    // Parentheses are valid in URLs. Strip only unmatched sentence wrappers,
    // not a balanced path or a query/fragment ending in '?' or ':'.
    while (urlText.endsWith(")") &&
      (urlText.match(/\)/g)?.length ?? 0) > (urlText.match(/\(/g)?.length ?? 0)) {
      urlText = urlText.slice(0, -1);
    }
    if (start > cursor) parts.push({ type: "text", value: value.slice(cursor, start) });
    try {
      if (urlText.startsWith("/")) {
        parts.push({ type: "link", value: urlText, href: urlText, label: urlText, internal: true });
        const punctuation = raw.slice(urlText.length);
        if (punctuation) parts.push({ type: "text", value: punctuation });
        cursor = start + raw.length;
        continue;
      }
      const url = new URL(urlText);
      if (url.protocol === "http:" || url.protocol === "https:") {
        const path = `${url.pathname}${url.search}${url.hash}`;
        parts.push({ type: "link", value: urlText, href: url.href, label: `${url.protocol}//${url.host}${path === "/" ? "" : path}` });
      } else {
        parts.push({ type: "text", value: urlText });
      }
    } catch {
      parts.push({ type: "text", value: urlText });
    }
    const punctuation = raw.slice(urlText.length);
    if (punctuation) parts.push({ type: "text", value: punctuation });
    cursor = start + raw.length;
  }
  if (cursor < value.length) parts.push({ type: "text", value: value.slice(cursor) });
  return parts.length ? parts : [{ type: "text", value }];
}
