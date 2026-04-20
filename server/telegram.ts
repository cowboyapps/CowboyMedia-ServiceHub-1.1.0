import { storage } from "./storage";

function escapeHtml(text: string): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function stripHtml(html: string): string {
  return String(html ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
}

function stripHtmlPreserveBreaks(html: string): string {
  let s = String(html ?? "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|h[1-6]|li|blockquote|tr)>/gi, "\n\n");
  s = s.replace(/<li[^>]*>/gi, "• ");
  s = s.replace(/<[^>]*>/g, "");
  s = s.replace(/&nbsp;/gi, " ");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/[ \t]*\n[ \t]*/g, "\n");
  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

function truncate(text: string, max = 800): string {
  const t = text ?? "";
  return t.length > max ? t.substring(0, max) + "..." : t;
}

async function postToTelegram(chatId: string, text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN not configured" };
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const err = `Telegram API ${res.status}: ${body}`;
      console.error("[Telegram]", err);
      return { ok: false, error: err };
    }
    return { ok: true };
  } catch (e: any) {
    console.error("[Telegram] send error:", e?.message || e);
    return { ok: false, error: e?.message || "Unknown error" };
  }
}

export type TelegramCategory = "alert" | "service_update" | "news";

export async function sendTelegramMessage(text: string, category?: TelegramCategory): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getTelegramSettings();
  if (!settings || !settings.enabled) return { ok: false, error: "Telegram notifications disabled" };
  if (!settings.chatId) return { ok: false, error: "No chat ID configured" };
  if (category === "alert" && settings.sendAlerts === false) return { ok: false, error: "Alerts disabled for Telegram" };
  if (category === "service_update" && settings.sendServiceUpdates === false) return { ok: false, error: "Service updates disabled for Telegram" };
  if (category === "news" && settings.sendNews === false) return { ok: false, error: "News disabled for Telegram" };
  return postToTelegram(settings.chatId, text);
}

export async function sendTelegramTestMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  const settings = await storage.getTelegramSettings();
  if (!settings?.chatId) return { ok: false, error: "No chat ID configured" };
  return postToTelegram(settings.chatId, text);
}

export function fireTelegram(text: string, category?: TelegramCategory): void {
  sendTelegramMessage(text, category).catch((e) => console.error("[Telegram] fire error:", e));
}

export function fireTelegramMany(texts: string[], category?: TelegramCategory): void {
  (async () => {
    for (const t of texts) {
      const r = await sendTelegramMessage(t, category);
      if (!r.ok) break;
    }
  })().catch((e) => console.error("[Telegram] fire-many error:", e));
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
    `🚨 <b>SERVICE ALERT — ${escapeHtml(opts.serviceName)}</b>`,
    `${emoji} <b>Impact:</b> ${escapeHtml(impactLabel)}`,
    opts.severity ? `<b>Severity:</b> ${escapeHtml(opts.severity)}` : "",
    ``,
    `<b>${escapeHtml(opts.title)}</b>`,
    `<i>${escapeHtml(truncate(opts.description))}</i>`,
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
    ? `✅ <b>SERVICE ALERT RESOLVED — ${escapeHtml(opts.serviceName)}</b>`
    : `🔄 <b>SERVICE ALERT UPDATE — ${escapeHtml(opts.serviceName)}</b>`;
  const lines = [
    header,
    `<b>Status:</b> ${escapeHtml(statusLabel)}`,
  ];
  if (opts.impact && opts.impact !== "no_change" && opts.status !== "resolved") {
    lines.push(`<b>Impact:</b> ${escapeHtml(impactLabels[opts.impact] || opts.impact)}`);
  }
  lines.push("");
  lines.push(`<b>${escapeHtml(opts.title)}</b>`);
  lines.push(`<i>${escapeHtml(truncate(opts.message))}</i>`);
  return lines.join("\n");
}

export function composeAlertResolved(opts: {
  serviceName: string;
  title: string;
  resolveMessage: string;
}): string {
  return [
    `✅ <b>SERVICE ALERT RESOLVED — ${escapeHtml(opts.serviceName)}</b>`,
    ``,
    `<b>${escapeHtml(opts.title)}</b>`,
    `<i>${escapeHtml(truncate(opts.resolveMessage))}</i>`,
  ].join("\n");
}

export function composeServiceUpdate(opts: {
  serviceName: string;
  title: string;
  description: string;
}): string {
  return [
    `📢 <b>SERVICE UPDATE — ${escapeHtml(opts.serviceName)}</b>`,
    ``,
    `<b>${escapeHtml(opts.title)}</b>`,
    `<i>${escapeHtml(truncate(opts.description))}</i>`,
  ].join("\n");
}

const TELEGRAM_MAX_LEN = 4096;

function splitForTelegram(body: string, headerLen: number): string[] {
  const firstBudget = TELEGRAM_MAX_LEN - headerLen - 16;
  const restBudget = TELEGRAM_MAX_LEN - 64;
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

export function composeNews(opts: {
  title: string;
  content: string;
}): string[] {
  const plain = stripHtmlPreserveBreaks(opts.content);
  const escapedTitle = escapeHtml(opts.title);
  const firstHeader = `📰 <b>NEWS</b>\n\n<b>${escapedTitle}</b>\n`;
  const contHeader = `📰 <b>NEWS (continued)</b>\n\n`;

  const escaped = escapeHtml(plain);
  const firstHeaderLen = firstHeader.length + 7; // <i></i> wrapper
  const bodyChunks = splitForTelegram(escaped, firstHeaderLen);
  if (bodyChunks.length === 0) return [`${firstHeader}<i></i>`];
  return bodyChunks.map((chunk, i) =>
    i === 0
      ? `${firstHeader}<i>${chunk}</i>`
      : `${contHeader}<i>${chunk}</i>`
  );
}
