import crypto from "node:crypto";
import { generateSecret, generateSync, generateURI, verifySync } from "otplib";
import qrcode from "qrcode";

export const TOTP_ISSUER = "ServiceHub";

export interface TotpChallenge {
  id: string;
  userId: string;
  expiresAt: number;
  attempts: number;
}

export interface ChallengeStoreOptions {
  ttlMs?: number;
  maxAttempts?: number;
  now?: () => number;
}

export type AttemptResult =
  | { ok: true; challenge: TotpChallenge }
  | { ok: false; reason: "not_found" | "expired" | "locked" };

export class ChallengeStore {
  private map = new Map<string, TotpChallenge>();
  private ttlMs: number;
  private maxAttempts: number;
  private now: () => number;

  constructor(opts: ChallengeStoreOptions = {}) {
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.now = opts.now ?? (() => Date.now());
  }

  create(userId: string): TotpChallenge {
    const id = crypto.randomBytes(24).toString("hex");
    const ch: TotpChallenge = {
      id,
      userId,
      expiresAt: this.now() + this.ttlMs,
      attempts: 0,
    };
    this.map.set(id, ch);
    return ch;
  }

  attempt(id: string): AttemptResult {
    const ch = this.map.get(id);
    if (!ch) return { ok: false, reason: "not_found" };
    if (this.now() > ch.expiresAt) {
      this.map.delete(id);
      return { ok: false, reason: "expired" };
    }
    if (ch.attempts >= this.maxAttempts) {
      return { ok: false, reason: "locked" };
    }
    ch.attempts++;
    return { ok: true, challenge: ch };
  }

  delete(id: string): void {
    this.map.delete(id);
  }

  size(): number {
    return this.map.size;
  }

  sweepExpired(): void {
    const now = this.now();
    const ids: string[] = [];
    this.map.forEach((ch, id) => {
      if (now > ch.expiresAt) ids.push(id);
    });
    for (const id of ids) this.map.delete(id);
  }
}

export function generateBackupCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return codes;
}

export function normalizeBackupCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

export function hashBackupCode(code: string): string {
  return crypto
    .createHash("sha256")
    .update(normalizeBackupCode(code))
    .digest("hex");
}

export function generateTotpSecret(): string {
  return generateSecret();
}

export function buildOtpAuthUri(
  secret: string,
  accountLabel: string,
  issuer: string = TOTP_ISSUER,
): string {
  return generateURI({ strategy: "totp", issuer, label: accountLabel, secret });
}

export function verifyTotpCode(secret: string, token: string): boolean {
  const cleaned = (token || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return false;
  try {
    const result = verifySync({ strategy: "totp", secret, token: cleaned });
    return !!result.valid;
  } catch {
    return false;
  }
}

export async function generateQrDataUrl(otpauth: string): Promise<string> {
  return qrcode.toDataURL(otpauth);
}

export function generateTotpForTest(secret: string): string {
  return generateSync({ strategy: "totp", secret });
}
