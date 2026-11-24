import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "./db";
import { telegramImportSettings as settingsTable, telegramServiceDrafts as drafts, serviceUpdates } from "@shared/schema";
import { telegramBodyHtml } from "./telegram-import-security";
import type { ImportedTelegramPost } from "./telegram-import-transport";

export type ImportSettings = typeof settingsTable.$inferSelect;
export type DraftFields = Pick<typeof drafts.$inferInsert, "title" | "description" | "serviceId" | "matureContent">;
export class ImportConflict extends Error {}

export class TelegramImportStore {
  async settings() {
    await db.insert(settingsTable).values({ id: "singleton" }).onConflictDoNothing();
    const [row] = await db.select().from(settingsTable).where(eq(settingsTable.id, "singleton"));
    return row;
  }
  async updateSettings(patch: Partial<Omit<ImportSettings, "id">>) {
    await this.settings();
    const [row] = await db.update(settingsTable).set(patch).where(eq(settingsTable.id, "singleton")).returning();
    return row;
  }
  async pending() {
    return db.select().from(drafts).where(eq(drafts.status, "pending")).orderBy(desc(drafts.createdAt));
  }
  async getDraft(id: string) {
    const [row] = await db.select().from(drafts).where(eq(drafts.id, id));
    return row;
  }
  async saveDraft(id: string, fields: DraftFields) {
    const [row] = await db.update(drafts).set({ ...fields, updatedAt: new Date() })
      .where(and(eq(drafts.id, id), eq(drafts.status, "pending"))).returning();
    if (!row) throw new ImportConflict("This draft was already published or deleted. Reload the draft list.");
    return row;
  }
  async deleteDraft(id: string) {
    // Keep the source ID as a tombstone so reconnects never re-import discarded posts.
    const [row] = await db.update(drafts).set({ status: "deleted", description: "", title: "", updatedAt: new Date() })
      .where(and(eq(drafts.id, id), eq(drafts.status, "pending"))).returning();
    if (!row) throw new ImportConflict("This draft was already published or deleted.");
  }
  async publish(id: string, fields: DraftFields) {
    return db.transaction(async tx => {
      const [draft] = await tx.select().from(drafts).where(eq(drafts.id, id)).for("update");
      if (!draft || draft.status === "deleted") throw new ImportConflict("This draft is no longer available.");
      if (draft.status === "published" && draft.publishedUpdateId) {
        return { id: draft.publishedUpdateId, created: false, update: null };
      }
      const [update] = await tx.insert(serviceUpdates).values({
        title: fields.title!, description: fields.description!, serviceId: fields.serviceId!,
        matureContent: fields.matureContent ?? false,
      }).returning();
      await tx.update(drafts).set({ ...fields, status: "published", publishedUpdateId: update.id, updatedAt: new Date() })
        .where(eq(drafts.id, id));
      return { id: update.id, created: true, update };
    });
  }
  async acceptPosts(expected: ImportSettings, posts: ImportedTelegramPost[]) {
    return db.transaction(async tx => {
      const [current] = await tx.select().from(settingsTable).where(eq(settingsTable.id, "singleton")).for("update");
      if (!current.enabled || current.channelId !== expected.channelId ||
          current.encryptedSession !== expected.encryptedSession || current.lastMessageId !== expected.lastMessageId) return;
      let lastMessageId = current.lastMessageId;
      let imported = false;
      for (const post of [...posts].sort((a, b) => a.id - b.id)) {
        if (post.id <= lastMessageId) continue;
        if (post.text.trim()) {
          const [row] = await tx.insert(drafts).values({
            channelId: current.channelId!, channelTitle: current.channelTitle!,
            sourceMessageId: post.id, sourcePostedAt: post.date,
            sourceUrl: `https://t.me/c/${current.channelId!.replace(/^-100/, "")}/${post.id}`,
            description: telegramBodyHtml(post.text, post.entities),
          }).onConflictDoNothing().returning({ id: drafts.id });
          if (row) imported = true;
        }
        lastMessageId = post.id;
      }
      await tx.update(settingsTable).set({
        lastMessageId, lastCheckedAt: new Date(), error: null,
        ...(imported ? { lastImportedAt: new Date() } : {}),
      }).where(eq(settingsTable.id, "singleton"));
    });
  }
  async unnotified() {
    return db.select().from(drafts).where(and(eq(drafts.status, "pending"), isNull(drafts.adminNotifiedAt))).limit(30);
  }
  async markNotified(id: string) {
    await db.update(drafts).set({ adminNotifiedAt: new Date() }).where(eq(drafts.id, id));
  }
}
