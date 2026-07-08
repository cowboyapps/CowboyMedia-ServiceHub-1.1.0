// Wraps search matches in <mark> by walking text nodes of already sanitized
// HTML, so highlighting never splits or corrupts tags. Browser/jsdom only
// (needs DOMParser).

export function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export const HIGHLIGHT_MARK_CLASS = "bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-sm px-0.5";

export function highlightHtml(sanitizedHtml: string, query: string): string {
  if (!query) return sanitizedHtml;
  const re = new RegExp(escapeRegExp(query), "gi");
  const doc = new DOMParser().parseFromString(sanitizedHtml, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) textNodes.push(n as Text);
  for (const node of textNodes) {
    const text = node.nodeValue || "";
    if (!re.test(text)) { re.lastIndex = 0; continue; }
    re.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) frag.appendChild(doc.createTextNode(text.slice(last, m.index)));
      const mark = doc.createElement("mark");
      mark.className = HIGHLIGHT_MARK_CLASS;
      mark.textContent = m[0];
      frag.appendChild(mark);
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) frag.appendChild(doc.createTextNode(text.slice(last)));
    node.parentNode?.replaceChild(frag, node);
  }
  return doc.body.innerHTML;
}
