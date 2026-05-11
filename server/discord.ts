import { storage } from "./storage";
import { logError } from "./error-log";

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
  return String(text ?? "").replace(/([\\*_`~|>])/g, "\\$1");
}

function truncate(text: string, max: number): string {
  const t = text ?? "";
  return t.length > max ? t.substring(0, max - 1) + "…" : t;
}

const DISCORD_MAX_BODY_LEN = 2000;
const MAX_TITLE_LEN = 240;
const MAX_SERVICE_NAME_LEN = 120;
const MAX_FIELD_VALUE = 1024;

function clampTitle(s: string): string {
  return truncate(String(s ?? ""), MAX_TITLE_LEN);
}

function clampServiceName(s: string): string {
  return truncate(String(s ?? ""), MAX_SERVICE_NAME_LEN);
}

function safeUrl(u?: string | null): string | undefined {
  if (!u) return undefined;
  const s = String(u).trim();
  if (!/^https?:\/\//i.test(s)) return undefined;
  return s;
}

const COLOR = {
  outage: 0xED4245,
  degraded: 0xFAA61A,
  maintenance: 0x5865F2,
  operational: 0x57F287,
  resolved: 0x57F287,
  investigating: 0xED4245,
  identified: 0xFAA61A,
  monitoring: 0x5865F2,
  news: 0x3B82F6,
  service_update: 0x5865F2,
  info: 0x57F287,
} as const;

export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: { text: string };
  timestamp?: string;
};

export type DiscordPayload = { embeds: DiscordEmbed[] };

async function postToDiscord(webhookUrl: string, payload: DiscordPayload): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        allowed_mentions: { parse: [] },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `Discord API ${res.status}: ${body}`;
      console.error("[Discord]", err);
      logError("discord", err, { severity: "warn", summary: `Discord API ${res.status}`, extra: { status: res.status, body: body.slice(0, 1000) } });
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[Discord] send error:", e?.message || e);
    logError("discord", e, { severity: "error", summary: "Discord send error" });
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

export type DiscordCategory = "alert" | "service_update" | "news";

export async function sendDiscordMessage(payload: DiscordPayload, category?: DiscordCategory, overrideWebhookUrl?: string | null): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getDiscordSettings();
  if (!settings || !settings.enabled) return { ok: false, error: "Discord notifications disabled" };
  if (category === "alert" && settings.sendAlerts === false) return { ok: false, error: "Alerts disabled for Discord" };
  if (category === "service_update" && settings.sendServiceUpdates === false) return { ok: false, error: "Service updates disabled for Discord" };
  if (category === "news" && settings.sendNews === false) return { ok: false, error: "News disabled for Discord" };
  const webhookUrl = (overrideWebhookUrl && overrideWebhookUrl.trim()) || settings.webhookUrl;
  if (!webhookUrl) return { ok: false, error: "No webhook URL configured" };
  return postToDiscord(webhookUrl, payload);
}

export async function sendDiscordTestMessage(payload: DiscordPayload): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getDiscordSettings();
  if (!settings?.webhookUrl) return { ok: false, error: "No webhook URL configured" };
  return postToDiscord(settings.webhookUrl, payload);
}

export function fireDiscord(payload: DiscordPayload, category?: DiscordCategory, overrideWebhookUrl?: string | null): void {
  sendDiscordMessage(payload, category, overrideWebhookUrl).catch((e) => {
    console.error("[Discord] fire error:", e);
    logError("discord", e, { severity: "error", summary: "Discord fire error" });
  });
}

export function fireDiscordMany(payloads: DiscordPayload[], category?: DiscordCategory, overrideWebhookUrl?: string | null): void {
  (async () => {
    for (const p of payloads) {
      const r = await sendDiscordMessage(p, category, overrideWebhookUrl);
      if (!r.ok) break;
    }
  })().catch((e) => {
    console.error("[Discord] fire-many error:", e);
    logError("discord", e, { severity: "error", summary: "Discord fire-many error" });
  });
}

export function composeDiscordTest(): DiscordPayload {
  return {
    embeds: [{
      title: "✅ Test message from ServiceHub",
      description: "If you can see this, Discord notifications are wired up correctly.",
      color: COLOR.info,
    }],
  };
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

function impactColor(impact?: string | null, fallback: number = COLOR.info): number {
  if (!impact) return fallback;
  return (COLOR as Record<string, number>)[impact] ?? fallback;
}

function clampDescription(s: string): string {
  return truncate(s, DISCORD_MAX_BODY_LEN);
}

function alertUrl(baseUrl: string | undefined, alertId: string | undefined): string | undefined {
  if (!baseUrl || !alertId) return undefined;
  return safeUrl(`${baseUrl.replace(/\/$/, "")}/alerts/${encodeURIComponent(alertId)}`);
}

function newsUrl(baseUrl: string | undefined, newsId: string | undefined): string | undefined {
  if (!baseUrl || !newsId) return undefined;
  return safeUrl(`${baseUrl.replace(/\/$/, "")}/news/${encodeURIComponent(newsId)}`);
}

function serviceUpdatesUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) return undefined;
  return safeUrl(`${baseUrl.replace(/\/$/, "")}/service-updates`);
}

export function composeAlertCreated(opts: {
  serviceName: string;
  impact: string;
  severity?: string;
  title: string;
  description: string;
  alertId?: string;
  baseUrl?: string;
}): DiscordPayload {
  const emoji = impactEmoji[opts.impact] || "🚨";
  const impactLabel = impactLabels[opts.impact] || opts.impact;
  const fields: DiscordEmbed["fields"] = [
    { name: "Service", value: truncate(opts.serviceName || "Service", MAX_FIELD_VALUE), inline: true },
    { name: "Impact", value: `${emoji} ${impactLabel}`, inline: true },
  ];
  if (opts.severity) fields.push({ name: "Severity", value: truncate(opts.severity, MAX_FIELD_VALUE), inline: true });
  return {
    embeds: [{
      title: truncate(`🚨 Service Alert — ${clampTitle(opts.title)}`, 256),
      description: clampDescription(opts.description || ""),
      url: alertUrl(opts.baseUrl, opts.alertId),
      color: impactColor(opts.impact, COLOR.outage),
      fields,
      footer: { text: clampServiceName(opts.serviceName) },
      timestamp: new Date().toISOString(),
    }],
  };
}

export function composeAlertUpdate(opts: {
  serviceName: string;
  title: string;
  status: string;
  message: string;
  impact?: string | null;
  alertId?: string;
  baseUrl?: string;
}): DiscordPayload {
  const isResolved = opts.status === "resolved";
  const statusLabel = statusLabels[opts.status] || opts.status;
  const headerEmoji = isResolved ? "✅" : "🔄";
  const headerLabel = isResolved ? "Service Alert Resolved" : "Service Alert Update";
  const fields: DiscordEmbed["fields"] = [
    { name: "Service", value: truncate(opts.serviceName || "Service", MAX_FIELD_VALUE), inline: true },
    { name: "Status", value: statusLabel, inline: true },
  ];
  if (opts.impact && opts.impact !== "no_change" && !isResolved) {
    fields.push({ name: "Impact", value: `${impactEmoji[opts.impact] || ""} ${impactLabels[opts.impact] || opts.impact}`.trim(), inline: true });
  }
  const color = isResolved
    ? COLOR.resolved
    : (opts.impact && opts.impact !== "no_change" ? impactColor(opts.impact, COLOR.investigating) : (COLOR as Record<string, number>)[opts.status] ?? COLOR.investigating);
  return {
    embeds: [{
      title: truncate(`${headerEmoji} ${headerLabel} — ${clampTitle(opts.title)}`, 256),
      description: clampDescription(opts.message || ""),
      url: alertUrl(opts.baseUrl, opts.alertId),
      color,
      fields,
      footer: { text: clampServiceName(opts.serviceName) },
      timestamp: new Date().toISOString(),
    }],
  };
}

export function composeAlertResolved(opts: {
  serviceName: string;
  title: string;
  resolveMessage: string;
  alertId?: string;
  baseUrl?: string;
}): DiscordPayload {
  return {
    embeds: [{
      title: truncate(`✅ Service Alert Resolved — ${clampTitle(opts.title)}`, 256),
      description: clampDescription(opts.resolveMessage || ""),
      url: alertUrl(opts.baseUrl, opts.alertId),
      color: COLOR.resolved,
      fields: [
        { name: "Service", value: truncate(opts.serviceName || "Service", MAX_FIELD_VALUE), inline: true },
        { name: "Status", value: "Resolved", inline: true },
      ],
      footer: { text: clampServiceName(opts.serviceName) },
      timestamp: new Date().toISOString(),
    }],
  };
}

function splitDescription(body: string, max: number = DISCORD_MAX_BODY_LEN): string[] {
  if (body.length <= max) return body.length > 0 ? [body] : [""];
  const chunks: string[] = [];
  let remaining = body;
  while (remaining.length > max) {
    const slice = remaining.slice(0, max);
    let cut = slice.lastIndexOf("\n\n");
    if (cut < max * 0.5) {
      const sentenceCut = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf(".\n"),
        slice.lastIndexOf("!\n"),
        slice.lastIndexOf("?\n"),
      );
      if (sentenceCut >= max * 0.5) cut = sentenceCut + 1;
    }
    if (cut < max * 0.5) {
      const wsCut = slice.lastIndexOf(" ");
      if (wsCut > 0) cut = wsCut;
    }
    if (cut <= 0) cut = max;
    chunks.push(remaining.slice(0, cut).trimEnd());
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

export function composeServiceUpdate(opts: {
  serviceName: string;
  title: string;
  description: string;
  baseUrl?: string;
}): DiscordPayload {
  return {
    embeds: [{
      title: truncate(`📢 Service Update — ${clampTitle(opts.title)}`, 256),
      description: clampDescription(opts.description || ""),
      url: serviceUpdatesUrl(opts.baseUrl),
      color: COLOR.service_update,
      fields: [
        { name: "Service", value: truncate(opts.serviceName || "Service", MAX_FIELD_VALUE), inline: true },
      ],
      footer: { text: clampServiceName(opts.serviceName) },
      timestamp: new Date().toISOString(),
    }],
  };
}

export function composeNews(opts: {
  title: string;
  content: string;
  newsId?: string;
  baseUrl?: string;
}): DiscordPayload[] {
  const plain = stripHtmlPreserveBreaks(opts.content);
  const chunks = splitDescription(plain);
  const url = newsUrl(opts.baseUrl, opts.newsId);
  return chunks.map((chunk, i) => ({
    embeds: [{
      title: truncate(
        i === 0 ? `📰 ${clampTitle(opts.title)}` : `📰 ${clampTitle(opts.title)} (continued)`,
        256,
      ),
      description: chunk || "—",
      url,
      color: COLOR.news,
      footer: { text: "News" },
      ...(i === 0 ? { timestamp: new Date().toISOString() } : {}),
    }],
  }));
}
