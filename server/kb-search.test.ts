import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import { kbArticles } from "@shared/schema";
import { storage } from "./storage";

// ---------- Knowledge Base full-text search (real database) ----------
// Proves the customer-facing KB search works end-to-end against a real DB: the
// `search_vector` trigger (migrations/0026_kb_search_vector.sql) must populate
// the tsvector on insert, and `storage.searchKbArticles` (raw SQL using
// `search_vector @@ plainto_tsquery(...)`) must return matching articles and
// exclude non-matching ones. A future change to either the trigger SQL or the
// search query that silently broke KB search would trip this test.

const cleanup: Array<() => Promise<void>> = [];

// A unique nonce woven into the seeded article so the search terms can't
// accidentally match pre-existing rows in the test DB.
const nonce = randomUUID().replace(/-/g, "").slice(0, 12);
const titleTerm = `zylophonics${nonce}`; // in title (weight A)
const summaryTerm = `quibbleflux${nonce}`; // in summary (weight B)
const tagTerm = `tagwidget${nonce}`; // in tags (weight B)
const bodyTerm = `bodyglyph${nonce}`; // in body_html (weight C)
const unrelatedTerm = `nothingmatches${nonce}`; // appears nowhere

before(async () => {
  // Fail fast if the DB isn't reachable.
  await db.select().from(kbArticles).limit(1);

  const [article] = await db
    .insert(kbArticles)
    .values({
      categoryId: randomUUID(),
      slug: `kb-search-int-${randomUUID()}`,
      title: `Guide to ${titleTerm}`,
      summary: `A short ${summaryTerm} overview`,
      bodyHtml: `<p>The <strong>${bodyTerm}</strong> appears in the body.</p>`,
      tags: [tagTerm, "general"],
      published: true,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(kbArticles).where(eq(kbArticles.id, article.id));
  });
});

after(async () => {
  for (const undo of cleanup.reverse()) {
    try {
      await undo();
    } catch (e) {
      console.error("cleanup failed:", e);
    }
  }
  await pool.end();
});

test("searchKbArticles: trigger populates search_vector and a title term matches", async () => {
  const results = await storage.searchKbArticles(titleTerm);
  assert.equal(
    results.some((a) => a.title === `Guide to ${titleTerm}`),
    true,
    "article is returned for a term in its title",
  );
});

test("searchKbArticles: a summary term matches", async () => {
  const results = await storage.searchKbArticles(summaryTerm);
  assert.equal(
    results.some((a) => a.summary === `A short ${summaryTerm} overview`),
    true,
    "article is returned for a term in its summary",
  );
});

test("searchKbArticles: a tag term matches", async () => {
  const results = await storage.searchKbArticles(tagTerm);
  assert.equal(
    results.some((a) => a.tags.includes(tagTerm)),
    true,
    "article is returned for a term in its tags",
  );
});

test("searchKbArticles: a body term matches (HTML tags stripped from the vector)", async () => {
  const results = await storage.searchKbArticles(bodyTerm);
  assert.equal(
    results.some((a) => a.title === `Guide to ${titleTerm}`),
    true,
    "article is returned for a term in its body_html",
  );
});

test("searchKbArticles: an unrelated term does not match", async () => {
  const results = await storage.searchKbArticles(unrelatedTerm);
  assert.equal(
    results.some((a) => a.title === `Guide to ${titleTerm}`),
    false,
    "article is NOT returned for a term that appears nowhere in it",
  );
});

test("searchKbArticles: publishedOnly excludes unpublished articles", async () => {
  const hiddenTerm = `hiddenword${nonce}`;
  const [hidden] = await db
    .insert(kbArticles)
    .values({
      categoryId: randomUUID(),
      slug: `kb-search-hidden-${randomUUID()}`,
      title: `Draft about ${hiddenTerm}`,
      bodyHtml: `<p>unpublished</p>`,
      published: false,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(kbArticles).where(eq(kbArticles.id, hidden.id));
  });

  const all = await storage.searchKbArticles(hiddenTerm);
  assert.equal(
    all.some((a) => a.id === hidden.id),
    true,
    "unpublished article is found without the publishedOnly filter",
  );

  const publishedOnly = await storage.searchKbArticles(hiddenTerm, { publishedOnly: true });
  assert.equal(
    publishedOnly.some((a) => a.id === hidden.id),
    false,
    "unpublished article is excluded when publishedOnly is set",
  );
});
