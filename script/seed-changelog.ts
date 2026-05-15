// One-time seed: parse the legacy CHANGELOG.md and import each `## Version X`
// section as a published changelog_entries row so /whats-new keeps showing
// full history after we stop bundling the markdown file.
//
// Idempotent — skips versions that already exist. Safe to call on every boot.
// Called from server/index.ts immediately after seedEmailTemplates().

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { storage } from "../server/storage";
import { renderChangelogToHtml } from "../shared/changelog-render";

type Section = { version: string; heading: string; body: string; publishedAt: Date };

// Parse the markdown into one Section per `## Version X — <date>` heading.
// We capture the heading line so the rendered HTML still shows the version
// title at the top of each entry on /whats-new.
export function parseChangelogMarkdown(md: string): Section[] {
  const lines = md.split(/\r?\n/);
  const sections: Section[] = [];
  let current: { heading: string; body: string[]; version: string; publishedAt: Date } | null = null;
  const headingRe = /^##\s+Version\s+([0-9]+(?:\.[0-9A-Za-z-]+)*)\s*(?:[—-]+\s*(.+))?$/i;

  const flush = () => {
    if (current) {
      sections.push({
        version: current.version,
        heading: current.heading,
        body: current.body.join("\n").trim(),
        publishedAt: current.publishedAt,
      });
    }
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    const m = line.match(headingRe);
    if (m) {
      flush();
      const dateStr = (m[2] || "").trim();
      const parsed = dateStr ? Date.parse(dateStr.replace(/\s+/g, " ")) : NaN;
      current = {
        version: m[1],
        heading: line,
        body: [],
        publishedAt: Number.isFinite(parsed) ? new Date(parsed) : new Date(),
      };
      continue;
    }
    if (current) {
      // Skip horizontal rules between sections.
      if (line.startsWith("---")) continue;
      current.body.push(raw);
    }
  }
  flush();
  return sections;
}

export async function seedChangelogEntries(): Promise<{ inserted: number; skipped: number }> {
  const path = join(process.cwd(), "CHANGELOG.md");
  if (!existsSync(path)) return { inserted: 0, skipped: 0 };
  const md = readFileSync(path, "utf-8");
  const sections = parseChangelogMarkdown(md);
  let inserted = 0;
  let skipped = 0;
  for (const s of sections) {
    const existing = await storage.getChangelogEntry(s.version);
    if (existing) { skipped++; continue; }
    // Body only — the Version heading is rendered by the frontend
    // (whats-new-page.tsx and the welcome popup) for every entry, so
    // including it here would duplicate it.
    const html = renderChangelogToHtml(s.body);
    await storage.createChangelogEntry({
      version: s.version,
      title: "",
      bodyHtml: html,
      status: "published",
      publishedAt: s.publishedAt,
      publishedBy: null,
    });
    inserted++;
  }
  return { inserted, skipped };
}
