import { TelegramClient, Api } from "teleproto";
import { StringSession } from "teleproto/sessions";
import { computeCheck } from "teleproto/Password";
import type { TelegramChannelOption } from "@shared/telegram-import";
import type { TelegramTextEntity } from "./telegram-import-security";

export interface ImportedTelegramPost {
  id: number;
  text: string;
  date: Date;
  entities: TelegramTextEntity[];
}
export interface ImportChannel extends TelegramChannelOption { username?: string }

export class TelegramImportTransport {
  private client: TelegramClient;
  private phoneNumber = "";
  private phoneCodeHash = "";

  constructor(session: string) {
    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = process.env.TELEGRAM_API_HASH;
    if (!Number.isSafeInteger(apiId) || apiId <= 0 || !apiHash) throw new Error("Telegram account API credentials are not configured.");
    this.client = new TelegramClient(new StringSession(session), apiId, apiHash, {
      connectionRetries: 2, requestRetries: 1, floodSleepThreshold: 0, timeout: 15,
      autoReconnect: true, deviceModel: "ServiceHub dedicated importer",
    });
    this.client.setLogLevel("none" as Parameters<TelegramClient["setLogLevel"]>[0]);
  }
  async connect() { await this.client.connect(); }
  async close() { await this.client.destroy(); }
  save() { return String(this.client.session.save()); }
  async authorized() { return this.client.checkAuthorization(); }
  async startLogin(phoneNumber: string) {
    this.phoneNumber = phoneNumber;
    const result = await this.client.sendCode({
      apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH!,
    }, phoneNumber);
    this.phoneCodeHash = result.phoneCodeHash;
  }
  async code(code: string): Promise<"done" | "password"> {
    try {
      await this.client.invoke(new Api.auth.SignIn({
        phoneNumber: this.phoneNumber, phoneCodeHash: this.phoneCodeHash, phoneCode: code,
      }));
      return "done";
    } catch (error) {
      if (typeof error === "object" && error && "errorMessage" in error && error.errorMessage === "SESSION_PASSWORD_NEEDED") return "password";
      throw error;
    }
  }
  async password(password: string) {
    const params = await this.client.invoke(new Api.account.GetPassword());
    await this.client.invoke(new Api.auth.CheckPassword({ password: await computeCheck(params, password) }));
  }
  async channels(): Promise<ImportChannel[]> {
    const channels: ImportChannel[] = [];
    // iterDialogs populates the session entity cache needed for private channel IDs.
    for await (const dialog of this.client.iterDialogs({})) {
      const entity = dialog.entity;
      if (entity instanceof Api.Channel && entity.broadcast && !entity.left) {
        channels.push({ id: `-100${entity.id.toString()}`, title: entity.title, username: entity.username });
      }
    }
    return channels;
  }
  async latest(channelId: string) {
    const messages = await this.client.getMessages(channelId, { limit: 1 });
    return messages[0]?.id ?? 0;
  }
  async posts(channelId: string, afterId: number): Promise<ImportedTelegramPost[]> {
    const result: ImportedTelegramPost[] = [];
    for await (const message of this.client.iterMessages(channelId, { minId: afterId, reverse: true, limit: 100 })) {
      result.push({
        id: message.id, text: message.message || "", date: new Date(message.date * 1000),
        entities: (message.entities || []).map(e => ({
          offset: e.offset, length: e.length,
          url: e instanceof Api.MessageEntityTextUrl ? e.url :
            e instanceof Api.MessageEntityUrl ? (() => {
              const visible = message.message.slice(e.offset, e.offset + e.length);
              return /^https?:\/\//i.test(visible) ? visible : `https://${visible}`;
            })() : undefined,
        })),
      });
    }
    return result;
  }
}
