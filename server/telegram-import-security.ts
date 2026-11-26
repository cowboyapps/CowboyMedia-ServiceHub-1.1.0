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

const TELEGRAM_ERROR_MESSAGES: Record<string, string> = {
  API_ID_INVALID: "Telegram rejected the API ID and API hash combination. Check that both VPS settings match the same application at my.telegram.org/apps.",
  CONNECTION_API_ID_INVALID: "Telegram rejected the API ID. Check the API credentials saved on the VPS.",
  API_ID_PUBLISHED_FLOOD: "Telegram has restricted this API application. Review the application with Telegram before retrying.",
  PHONE_NUMBER_INVALID: "Telegram did not accept this phone number. Use the dedicated account's full international number, including the country code.",
  PHONE_NUMBER_BANNED: "Telegram has banned this phone number. Resolve the account restriction with Telegram before connecting it.",
  PHONE_NUMBER_APP_SIGNUP_FORBIDDEN: "Telegram does not allow this account to be registered through this application. Complete account registration in the official Telegram app first.",
  PHONE_NUMBER_UNOCCUPIED: "No Telegram account is registered with this number. Sign in to the dedicated account in the official Telegram app first.",
  FLOOD_WAIT: "Telegram rate limit reached. Wait before trying again.",
  PHONE_NUMBER_FLOOD: "Telegram has limited sign-in attempts for this number. Wait before requesting another code.",
  PHONE_PASSWORD_FLOOD: "Telegram has limited password attempts. Wait before trying again.",
  PHONE_CODE_INVALID: "The Telegram code is invalid or expired. Start sign-in again if needed.",
  PHONE_CODE_EXPIRED: "The Telegram code is invalid or expired. Start sign-in again if needed.",
  PASSWORD_HASH_INVALID: "The Telegram two-step verification password is incorrect.",
  AUTH_RESTART: "Telegram requires a fresh sign-in attempt. Wait a minute, then start sign-in again.",
  SMS_CODE_CREATE_FAILED: "Telegram could not create a sign-in code. Confirm the account works in the official Telegram app and wait before retrying.",
  UPDATE_APP_TO_LOGIN: "Telegram requires a newer login client. The ServiceHub Telegram integration needs a compatibility update.",
  RECAPTCHA_CHECK: "Telegram requires a CAPTCHA for this sign-in request. ServiceHub cannot complete that challenge; no account was connected.",
  SESSION_EXPIRED: "Telegram sign-in expired or was revoked. Reconnect the dedicated account.",
  CHANNEL_PRIVATE: "The dedicated account no longer has access to this channel.",
  NETWORK_FAILURE: "The VPS could not complete its connection to Telegram. Check server connectivity before retrying.",
  TIMEOUT: "The Telegram request timed out. Wait before retrying; a sign-in code may still have been delivered.",
  DATA_CENTER_MIGRATION: "Telegram requested a different data center, but the redirect could not be completed. Wait before retrying; if it persists, the ServiceHub integration needs attention.",
};

/** Return only known identifiers, never a provider-supplied payload or message. */
export function telegramFailureCode(error: unknown): string {
  if (!error || typeof error !== "object") return "UNKNOWN";
  const provider = "errorMessage" in error && typeof error.errorMessage === "string" ? error.errorMessage : "";
  if (Object.prototype.hasOwnProperty.call(TELEGRAM_ERROR_MESSAGES, provider)) return provider;
  const name = "name" in error ? error.name : undefined;
  if (/^(?:PHONE|NETWORK|USER)_MIGRATE_\d+$/.test(provider) ||
      ["PhoneMigrateError", "NetworkMigrateError", "UserMigrateError"].includes(name as string)) return "DATA_CENTER_MIGRATION";
  if (/^FLOOD_(?:PREMIUM_)?WAIT_\d+$/.test(provider)) return "FLOOD_WAIT";
  if (/^RECAPTCHA_CHECK_/.test(provider)) return "RECAPTCHA_CHECK";
  if (/^(?:AUTH_KEY_(?:INVALID|DUPLICATED|UNREGISTERED)|SESSION_REVOKED|USER_DEACTIVATED(?:_BAN)?)$/.test(provider)) return "SESSION_EXPIRED";
  if (/^(?:CHAT_ADMIN_REQUIRED|USER_NOT_PARTICIPANT)$/.test(provider)) return "CHANNEL_PRIVATE";
  const code = "code" in error ? error.code : undefined;
  if (["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN", "ENOTFOUND"].includes(code as string)) return "NETWORK_FAILURE";
  const message = "message" in error ? error.message : undefined;
  if (code === "ETIMEDOUT" || message === "TIMEOUT" || message === "Timeout" || ("name" in error && error.name === "TimeoutError")) return "TIMEOUT";
  return "UNKNOWN";
}

// Never expose Telegram's raw error messages, phone numbers, sessions or requests.
export function safeTelegramError(error: unknown): string {
  return TELEGRAM_ERROR_MESSAGES[telegramFailureCode(error)] ??
    "Telegram connection failed. Check account access and server configuration, then retry.";
}
