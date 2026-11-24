import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function importEncryptionKey(value = process.env.TELEGRAM_IMPORT_ENCRYPTION_KEY): Buffer {
  if (!value) throw new Error("Telegram import encryption key is not configured.");
  const key = Buffer.from(value, /^[a-f0-9]{64}$/i.test(value) ? "hex" : "base64");
  if (key.length !== 32) throw new Error("Telegram import encryption key must contain 32 random bytes.");
  return key;
}

export function encryptTelegramSession(session: string, key = importEncryptionKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from("servicehub:telegram-import:v1"));
  const encrypted = Buffer.concat([cipher.update(session, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(".");
}

export function decryptTelegramSession(value: string, key = importEncryptionKey()): string {
  const [version, iv, tag, content, extra] = value.split(".");
  if (version !== "v1" || !iv || !tag || !content || extra) throw new Error("Invalid encrypted Telegram session.");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from("servicehub:telegram-import:v1"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(content, "base64")), decipher.final()]).toString("utf8");
}

export const escapeTelegramText = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface TelegramTextEntity { offset: number; length: number; url?: string }

// Telegram offsets and JS string slices both use UTF-16 code units.
export function telegramBodyHtml(text: string, entities: TelegramTextEntity[] = []): string {
  let cursor = 0;
  let html = "";
  for (const entity of [...entities].sort((a, b) => a.offset - b.offset)) {
    if (!entity.url || !/^https?:\/\//i.test(entity.url) || entity.offset < cursor ||
        entity.offset < 0 || entity.length <= 0 || entity.offset + entity.length > text.length) continue;
    html += escapeTelegramText(text.slice(cursor, entity.offset));
    html += `<a href="${escapeTelegramText(entity.url)}">${escapeTelegramText(text.slice(entity.offset, entity.offset + entity.length))}</a>`;
    cursor = entity.offset + entity.length;
  }
  html += escapeTelegramText(text.slice(cursor));
  return `<p>${html.replace(/\r\n|\r|\n/g, "<br>")}</p>`;
}

// Never expose Telegram's raw error messages, phone numbers, sessions or requests.
export function safeTelegramError(error: unknown): string {
  const code = typeof error === "object" && error && "errorMessage" in error ? String(error.errorMessage) : "";
  if (code.startsWith("FLOOD_WAIT") || code.startsWith("PHONE_NUMBER_FLOOD")) return "Telegram rate limit reached. Wait before trying again.";
  if (/PHONE_CODE_(INVALID|EXPIRED)/.test(code)) return "The Telegram code is invalid or expired. Start sign-in again if needed.";
  if (code === "PASSWORD_HASH_INVALID") return "The Telegram two-step verification password is incorrect.";
  if (/AUTH_KEY|SESSION_REVOKED|SESSION_EXPIRED|USER_DEACTIVATED/.test(code)) return "Telegram sign-in expired or was revoked. Reconnect the dedicated account.";
  if (/CHANNEL_PRIVATE|CHAT_ADMIN_REQUIRED|USER_NOT_PARTICIPANT/.test(code)) return "The dedicated account no longer has access to this channel.";
  return "Telegram connection failed. Check account access and server configuration, then retry.";
}
