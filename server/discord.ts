import { storage } from "./storage";

function stripHtmlPreserveBreaks(html: string): string {
  let s = String(html ?? "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/&amp;/g, "&");
  s = s.replace(/&lt;/g, "<");
  s = s.replace(/&gt;/g, ">");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function escapeMd(text: string): string {
  // Escape Discord markdown control chars so user content doesn't break formatting
  return String(text ?? "").replace(/([\\*_`~|>])/g, "\\$1");
}

function truncate(text: string, max = 800): string {
  const t = text ?? "";
  return t.length > max ? t.substring(0, max) + "..." : t;
}

const DISCORD_MAX_LEN = 2000;
// Hard caps for header fields so a pathological title/service-name can't blow past 2000 on its own.
const MAX_TITLE_LEN = 240;
const MAX_SERVICE_NAME_LEN = 120;

function clampTitle(s: string): string {
  return truncate(String(s ?? ""), MAX_TITLE_LEN);
}

function clampServiceName(s: string): string {
  return truncate(String(s ?? ""), MAX_SERVICE_NAME_LEN);
}

async function postToDiscord(webhookUrl: string, content: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // Final safety net: Discord rejects any single webhook message > 2000 chars.
    // Per-composer chunking handles long bodies; this guards against pathological
    // titles / service names that would otherwise blow past the limit on their own.
    const safeContent = content.length > DISCORD_MAX_LEN
      ? content.slice(0, DISCORD_MAX_LEN - 1) + "…"
      : content;
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: safeContent,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `Discord API ${res.status}: ${body}`;
      console.error("[Discord]", err);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[Discord] send error:", e?.message || e);
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

export type DiscordCategory = "alert" | "service_update" | "news";

export async function sendDiscordMessage(text: string, category?: DiscordCategory): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getDiscordSettings();
  if (!settings || !settings.enabled) return { ok: false, error: "Discord notifications disabled" };
  if (!settings.webhookUrl) return { ok: false, error: "No webhook URL configured" };
  if (category === "alert" && settings.sendAlerts === false) return { ok: false, error: "Alerts disabled for Discord" };
  if (category === "service_update" && settings.sendServiceUpdates === false) return { ok: false, error: "Service updates disabled for Discord" };
  if (category === "news" && settings.sendNews === false) return { ok: false, error: "News disabled for Discord" };
  return postToDiscord(settings.webhookUrl, text);
}

export async function sendDiscordTestMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getDiscordSettings();
  if (!settings?.webhookUrl) return { ok: false, error: "No webhook URL configured" };
  return postToDiscord(settings.webhookUrl, text);
}

export function fireDiscord(text: string, category?: DiscordCategory): void {
  sendDiscordMessage(text, category).catch((e) => console.error("[Discord] fire error:", e));
}

export function fireDiscordMany(texts: string[], category?: DiscordCategory): void {
  (async () => {
    for (const t of texts) {
      const r = await sendDiscordMessage(t, category);
      if (!r.ok) break;
    }
  })().catch((e) => console.error("[Discord] fire-many error:", e));
}

const impactEmoji: Record<string, string> = {
  outage: "🔴",
  degraded: "🟡",
  maintenance: "🛠",
  operational: "🟢",
};

const impactLabels: Record<string, string> = {
  outage: "Outage",
  degraded: "Degraded Performance",
  maintenance: "Maintenance",
  operational: "Operational",
};

const statusLabels: Record<string, string> = {
  investigating: "Investigating",
  identified: "Identified",
  monitoring: "Monitoring",
  resolved: "Resolved",
};

export function composeAlertCreated(opts: {
  serviceName: string;
  impact: string;
  severity?: string;
  title: string;
  description: string;
}): string {
  const emoji = impactEmoji[opts.impact] || "🚨";
  const impactLabel = impactLabels[opts.impact] || opts.impact;
  return [
    `🚨 **SERVICE ALERT — ${escapeMd(clampServiceName(opts.serviceName))}**`,
    `${emoji} **Impact:** ${escapeMd(impactLabel)}`,
    opts.severity ? `**Severity:** ${escapeMd(opts.severity)}` : "",
    ``,
    `**${escapeMd(clampTitle(opts.title))}**`,
    `_${escapeMd(truncate(opts.description))}_`,
  ].filter(Boolean).join("\n");
}

export function composeAlertUpdate(opts: {
  serviceName: string;
  title: string;
  status: string;
  message: string;
  impact?: string | null;
}): string {
  const statusLabel = statusLabels[opts.status] || opts.status;
  const header = opts.status === "resolved"
    ? `✅ **SERVICE ALERT RESOLVED — ${escapeMd(clampServiceName(opts.serviceName))}**`
    : `🔄 **SERVICE ALERT UPDATE — ${escapeMd(clampServiceName(opts.serviceName))}**`;
  const lines = [
    header,
    `**Status:** ${escapeMd(statusLabel)}`,
  ];
  if (opts.impact && opts.impact !== "no_change" && opts.status !== "resolved") {
    lines.push(`**Impact:** ${escapeMd(impactLabels[opts.impact] || opts.impact)}`);
  }
  lines.push("");
  lines.push(`**${escapeMd(clampTitle(opts.title))}**`);
  lines.push(`_${escapeMd(truncate(opts.message))}_`);
  return lines.join("\n");
}

export function composeAlertResolved(opts: {
  serviceName: string;
  title: string;
  resolveMessage: string;
}): string {
  return [
    `✅ **SERVICE ALERT RESOLVED — ${escapeMd(clampServiceName(opts.serviceName))}**`,
    ``,
    `**${escapeMd(clampTitle(opts.title))}**`,
    `_${escapeMd(truncate(opts.resolveMessage))}_`,
  ].join("\n");
}

function splitForDiscord(body: string, headerLen: number): string[] {
  const firstBudget = DISCORD_MAX_LEN - headerLen - 8;
  const restBudget = DISCORD_MAX_LEN - 64;
  const chunks: string[] = [];
  let remaining = body;
  let budget = firstBudget;
  while (remaining.length > budget) {
    const slice = remaining.slice(0, budget);
    let cut = slice.lastIndexOf("\n\n");
    if (cut < budget * 0.5) {
      const sentenceCut = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("!\n"),
        slice.lastIndexOf("?\n"),
      );
      if (sentenceCut >= budget * 0.5) cut = sentenceCut + 1;
    }
    if (cut < budget * 0.5) {
      const wsCut = slice.lastIndexOf(" ");
      if (wsCut > 0) cut = wsCut;
    }
    if (cut <= 0) cut = budget;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
    budget = restBudget;
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export function composeAlertPostmortem(opts: {
  serviceName: string;
  title: string;
  bodyHtml: string;
}): string[] {
  const plain = stripHtmlPreserveBreaks(opts.bodyHtml);
  const escapedTitle = escapeMd(clampTitle(opts.title));
  const escapedService = escapeMd(clampServiceName(opts.serviceName));
  const firstHeader = `📝 **POSTMORTEM — ${escapedService}**\n\n**${escapedTitle}**\n`;
  const contHeader = `📝 **POSTMORTEM (continued)**\n\n`;
  const escaped = escapeMd(plain);
  const firstHeaderLen = firstHeader.length + 2; // _ wrapper
  const bodyChunks = splitForDiscord(escaped, firstHeaderLen);
  if (bodyChunks.length === 0) return [`${firstHeader}_ _`];
  return bodyChunks.map((chunk, i) =>
    i === 0 ? `${firstHeader}_${chunk}_` : `${contHeader}_${chunk}_`
  );
}

export function composeServiceUpdate(opts: {
  serviceName: string;
  title: string;
  description: string;
}): string {
  return [
    `📢 **SERVICE UPDATE — ${escapeMd(clampServiceName(opts.serviceName))}**`,
    ``,
    `**${escapeMd(clampTitle(opts.title))}**`,
    `_${escapeMd(truncate(opts.description))}_`,
  ].join("\n");
}

export function composeNews(opts: {
  title: string;
  content: string;
}): string[] {
  const plain = stripHtmlPreserveBreaks(opts.content);
  const escapedTitle = escapeMd(clampTitle(opts.title));
  const firstHeader = `📰 **NEWS**\n\n**${escapedTitle}**\n`;
  const contHeader = `📰 **NEWS (continued)**\n\n`;
  const escaped = escapeMd(plain);
  const firstHeaderLen = firstHeader.length + 2;
  const bodyChunks = splitForDiscord(escaped, firstHeaderLen);
  if (bodyChunks.length === 0) return [`${firstHeader}_ _`];
  return bodyChunks.map((chunk, i) =>
    i === 0 ? `${firstHeader}_${chunk}_` : `${contHeader}_${chunk}_`
  );
}
