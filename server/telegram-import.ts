import { pool } from "./db";
import { TelegramImportStore } from "./telegram-import-store";
import { TelegramImportTransport, type ImportChannel } from "./telegram-import-transport";
import { decryptTelegramSession, encryptTelegramSession, importEncryptionKey, safeTelegramError } from "./telegram-import-security";
import type { TelegramImportStatus } from "@shared/telegram-import";

interface ImporterDependencies {
  store: TelegramImportStore;
  transport?: (session: string) => TelegramImportTransport;
  outboundChatId: () => Promise<string | null>;
  notify: (draft: Awaited<ReturnType<TelegramImportStore["pending"]>>[number]) => Promise<void>;
  report: (message: string) => void;
}

export class TelegramImporter {
  private client: TelegramImportTransport | null = null;
  private sessionValue: string | null = null;
  private pending: { client: TelegramImportTransport; owner: string; expires: number; step: "code" | "password"; attempts: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private busy = false;
  private authBusy = false;
  private lastLoginStart = 0;
  private makeTransport: (session: string) => TelegramImportTransport;

  constructor(private deps: ImporterDependencies) {
    this.makeTransport = deps.transport ?? (session => new TelegramImportTransport(session));
  }
  configured() {
    try {
      importEncryptionKey();
      return Number.isSafeInteger(Number(process.env.TELEGRAM_API_ID)) &&
        Number(process.env.TELEGRAM_API_ID) > 0 && !!process.env.TELEGRAM_API_HASH;
    } catch { return false; }
  }
  async status(owner: string): Promise<TelegramImportStatus> {
    await this.expirePending();
    const row = await this.deps.store.settings();
    return {
      configured: this.configured(), connected: !!row.encryptedSession && this.configured(),
      enabled: row.enabled, channelId: row.channelId, channelTitle: row.channelTitle,
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      lastImportedAt: row.lastImportedAt?.toISOString() ?? null,
      error: row.error, loginStep: this.pending?.owner === owner ? this.pending.step : "idle",
    };
  }
  private async expirePending() {
    if (this.pending && this.pending.expires < Date.now()) {
      const old = this.pending;
      this.pending = null;
      await old.client.close().catch(() => {});
    }
  }
  async login(owner: string, kind: "start" | "code" | "password", value: string) {
    if (this.authBusy) throw new Error("Telegram setup is busy. Try again shortly.");
    if (!this.configured()) throw new Error("Configure the Telegram API credentials and encryption key in server secrets first.");
    this.authBusy = true;
    try {
      await this.expirePending();
      if (kind === "start") {
        if (Date.now() - this.lastLoginStart < 60000) throw new Error("Wait a minute before requesting another Telegram login code.");
        if (this.pending && this.pending.owner !== owner) throw new Error("Another master admin is connecting the account. Try again later.");
        const settings = await this.deps.store.settings();
        if (settings.encryptedSession) throw new Error("Disconnect the existing Telegram account before connecting another.");
        this.lastLoginStart = Date.now();
        await this.pending?.client.close().catch(() => {});
        this.pending = null;
        const client = this.makeTransport("");
        try {
          await client.connect();
          await client.startLogin(value);
        } catch (error) {
          await client.close().catch(() => {});
          throw new Error(safeTelegramError(error));
        }
        this.pending = { client, owner, expires: Date.now() + 5 * 60000, step: "code", attempts: 0 };
      } else {
        const pending = this.pending;
        if (!pending || pending.owner !== owner || pending.step !== kind) throw new Error("Telegram sign-in expired. Start again.");
        pending.attempts++;
        try {
          if (kind === "code" && await pending.client.code(value) === "password") {
            pending.step = "password";
          } else {
            if (kind === "password") await pending.client.password(value);
            if (!await pending.client.authorized()) throw new Error("Not authorized");
            await this.deps.store.updateSettings({
              encryptedSession: encryptTelegramSession(pending.client.save()),
              enabled: false, channelId: null, channelTitle: null, lastMessageId: 0, error: null,
            });
            this.pending = null;
            await pending.client.close().catch(() => {});
          }
        } catch (error) {
          if (pending.attempts >= 8) {
            this.pending = null;
            await pending.client.close().catch(() => {});
            throw new Error("Too many attempts. Start Telegram sign-in again.");
          }
          throw new Error(safeTelegramError(error));
        }
      }
    } finally { this.authBusy = false; }
    return this.status(owner);
  }
  private async getClient(encryptedSession: string) {
    if (this.client && this.sessionValue === encryptedSession) return this.client;
    await this.closeClient();
    const client = this.makeTransport(decryptTelegramSession(encryptedSession));
    try {
      await client.connect();
      if (!await client.authorized()) throw { errorMessage: "SESSION_EXPIRED" };
      await client.channels();
      this.client = client;
      this.sessionValue = encryptedSession;
      return client;
    } catch (error) {
      await client.close().catch(() => {});
      throw error;
    }
  }
  private async closeClient() {
    const client = this.client;
    this.client = null;
    this.sessionValue = null;
    await client?.close().catch(() => {});
  }
  async channels() {
    const row = await this.deps.store.settings();
    if (!row.encryptedSession) throw new Error("Connect the dedicated Telegram account first.");
    try { return await (await this.getClient(row.encryptedSession)).channels(); }
    catch (error) { throw new Error(safeTelegramError(error)); }
  }
  private async checkLoop(channel: ImportChannel) {
    const outbound = (await this.deps.outboundChatId())?.trim().toLowerCase();
    if (outbound && (outbound === channel.id || outbound === channel.id.replace(/^-100/, "") ||
        (channel.username && outbound.replace(/^@/, "") === channel.username.toLowerCase()))) {
      throw new Error("Choose a source channel different from ServiceHub’s outbound Telegram channel to prevent import loops.");
    }
  }
  async configure(owner: string, enabled: boolean, channelId?: string) {
    const row = await this.deps.store.settings();
    if (!enabled && (!channelId || channelId === row.channelId)) {
      await this.deps.store.updateSettings({ enabled: false });
      return this.status(owner);
    }
    if (!row.encryptedSession || !this.configured()) throw new Error("Connect the dedicated Telegram account first.");
    const client = await this.getClient(row.encryptedSession);
    const channel = (await client.channels()).find(c => c.id === (channelId || row.channelId));
    if (!channel) throw new Error("Select a broadcast channel already joined by the dedicated account.");
    await this.checkLoop(channel);
    // Establish a baseline once per source selection, never backfill pre-activation history.
    const changed = channel.id !== row.channelId;
    const baseline = changed ? await client.latest(channel.id) : row.lastMessageId;
    await this.deps.store.updateSettings({
      enabled, channelId: channel.id, channelTitle: channel.title, lastMessageId: baseline, error: null,
    });
    return this.status(owner);
  }
  async disconnect(owner: string) {
    if (this.authBusy) throw new Error("Wait for the current Telegram setup request to finish.");
    await this.deps.store.updateSettings({ encryptedSession: null, enabled: false, channelId: null, channelTitle: null, lastMessageId: 0, error: null });
    const pending = this.pending;
    this.pending = null;
    await pending?.client.close().catch(() => {});
    await this.closeClient();
    return this.status(owner);
  }
  async tick() {
    if (this.busy || this.stopped) return;
    this.busy = true;
    const lease = await pool.connect().catch(() => null);
    if (!lease) { this.busy = false; return; }
    let locked = false;
    try {
      const result = await lease.query<{ locked: boolean }>("SELECT pg_try_advisory_lock(74192018) AS locked");
      locked = result.rows[0].locked;
      if (!locked) return;
      await this.expirePending();
      const row = await this.deps.store.settings();
      if (row.enabled && row.channelId && row.encryptedSession && this.configured()) {
        try {
          const client = await this.getClient(row.encryptedSession);
          const channel = (await client.channels()).find(c => c.id === row.channelId);
          if (!channel) throw { errorMessage: "USER_NOT_PARTICIPANT" };
          await this.checkLoop(channel);
          const posts = await client.posts(row.channelId, row.lastMessageId);
          await this.deps.store.acceptPosts(row, posts);
        } catch (error) {
          const message = error instanceof Error && error.message.startsWith("Choose a source channel") ? error.message : safeTelegramError(error);
          if (row.error !== message) this.deps.report(message);
          await this.deps.store.updateSettings({ error: message, lastCheckedAt: new Date() });
          await this.closeClient();
        }
      }
      // Draft notification retries also run while importing is paused.
      for (const draft of await this.deps.store.unnotified()) {
        await this.deps.notify(draft);
        await this.deps.store.markNotified(draft.id);
      }
    } catch {
      this.deps.report("Telegram importer could not finish its background check. It will retry automatically.");
    } finally {
      if (locked) await lease.query("SELECT pg_advisory_unlock(74192018)").catch(() => {});
      lease.release();
      this.busy = false;
    }
  }
  start() {
    const run = async () => {
      if (this.stopped) return;
      await this.tick();
      if (!this.stopped) {
        this.timer = setTimeout(() => { void run(); }, 30000);
        this.timer.unref();
      }
    };
    void run();
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    const pending = this.pending;
    this.pending = null;
    await pending?.client.close().catch(() => {});
    await this.closeClient();
  }
}
