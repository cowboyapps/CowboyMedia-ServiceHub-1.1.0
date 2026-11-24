import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { db, pool } from "./db";
import { telegramServiceDrafts as drafts, serviceUpdates } from "@shared/schema";
import { TelegramImportStore, ImportConflict } from "./telegram-import-store";

after(async () => { await pool.end(); });

test("draft approval is atomic, repeat-safe, private until approval, and deletion preserves deduplication", async () => {
  const channelId = `test-${randomUUID()}`;
  const store = new TelegramImportStore();
  const fields = { title: "Synthetic import test", description: "<p>Reviewed body</p>", serviceId: randomUUID(), matureContent: false };
  try {
    const input = { channelId, channelTitle: "Synthetic verification", sourceMessageId: 10,
      sourcePostedAt: new Date(), description: "<p>Imported body</p>", adminNotifiedAt: new Date() };
    const [draft] = await db.insert(drafts).values(input).returning();
    assert.equal(draft.title, "");
    assert.equal(draft.serviceId, "");
    assert.equal((await store.getDraft(draft.id))?.status, "pending");
    assert.equal((await db.select().from(serviceUpdates).where(eq(serviceUpdates.description, "<p>Imported body</p>"))).length, 0);
    await store.saveDraft(draft.id, { ...fields, title: "", serviceId: "" });
    assert.equal((await store.getDraft(draft.id))?.status, "pending");
    const [a, b] = await Promise.all([store.publish(draft.id, fields), store.publish(draft.id, fields)]);
    assert.equal(a.id, b.id);
    assert.equal(Number(a.created) + Number(b.created), 1);
    assert.equal((await db.select().from(serviceUpdates).where(eq(serviceUpdates.id, a.id))).length, 1);
    assert.equal((await store.getDraft(draft.id))?.status, "published");
    await assert.rejects(store.deleteDraft(draft.id), ImportConflict);
    const [discard] = await db.insert(drafts).values({ ...input, sourceMessageId: 11 }).returning();
    await store.deleteDraft(discard.id);
    assert.equal((await store.getDraft(discard.id))?.description, "");
    const duplicates = await db.insert(drafts).values({ ...input, sourceMessageId: 11 }).onConflictDoNothing().returning();
    assert.equal(duplicates.length, 0, "discarded source IDs cannot be imported again");
    await assert.rejects(store.publish(discard.id, fields), ImportConflict);
    await assert.rejects(store.saveDraft(discard.id, fields), ImportConflict);
  } finally {
    await db.delete(drafts).where(eq(drafts.channelId, channelId));
    await db.delete(serviceUpdates).where(and(eq(serviceUpdates.serviceId, fields.serviceId), eq(serviceUpdates.title, fields.title)));
  }
});
