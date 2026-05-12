import { versionAnchor } from "./version";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineMd(s: string): string {
  let out = escapeHtml(s);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  return out;
}

function extractVersionFromHeading(heading: string): string | null {
  const m = heading.match(/Version\s+([0-9]+(?:\.[0-9A-Za-z-]+)*)/i);
  return m ? m[1] : null;
}

export function renderChangelogToHtml(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList = false;
  const closeList = () => {
    if (inList) {
      out.push("</ul>");
      inList = false;
    }
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) {
      closeList();
      continue;
    }
    if (line.startsWith("---")) {
      closeList();
      out.push('<hr class="my-6 border-border" />');
      continue;
    }
    if (line.startsWith("## ")) {
      closeList();
      const heading = line.slice(3).trim();
      const v = extractVersionFromHeading(heading);
      const id = v ? versionAnchor(v) : "";
      out.push(
        `<h2${id ? ` id="${id}"` : ""} class="text-2xl font-bold mt-8 mb-3 scroll-mt-20">${inlineMd(heading)}</h2>`,
      );
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3 class="text-lg font-semibold mt-5 mb-2">${inlineMd(line.slice(4).trim())}</h3>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeList();
      out.push(`<h1 class="text-3xl font-bold mb-4">${inlineMd(line.slice(2).trim())}</h1>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul class="list-disc pl-6 space-y-1 my-2 text-sm leading-relaxed">');
        inList = true;
      }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeList();
    out.push(`<p class="my-2 text-sm leading-relaxed">${inlineMd(line.trim())}</p>`);
  }
  closeList();
  return out.join("\n");
}
