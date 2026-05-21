import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveKbArticleAttachment,
  enrichKbArticlesForMessages,
  type CommunityChatKbStorage,
} from "./community-chat-kb";
import type { KbArticle, KbCategory } from "../shared/schema";

const CATEGORY: KbCategory = {
  id: "cat-1",
  slug: "billing",
  name: "Billing",
  description: null,
  sortOrder: 0,
  createdAt: new Date("2025-01-01T00:00:00Z"),
};

const PUBLISHED_ARTICLE: KbArticle = {
  id: "art-1",
  categoryId: "cat-1",
  slug: "how-to-pay",
  title: "How to pay",
  summary: "Pay your bill in 3 steps",
  bodyHtml: "<p>Pay here</p>",
  tags: [],
  published: true,
  viewCount: 0,
  helpfulCount: 0,
  unhelpfulCount: 0,
  sortOrder: 0,
  authorId: null,
  createdAt: new Date("2025-01-01T00:00:00Z"),
  updatedAt: new Date("2025-01-01T00:00:00Z"),
};

const UNPUBLISHED_ARTICLE: KbArticle = { ...PUBLISHED_ARTICLE, id: "art-2", slug: "draft-only", published: false };

function mockStorage(opts: {
  articles?: Record<string, KbArticle | undefined>;
  categories?: Record<string, KbCategory | undefined>;
} = {}): CommunityChatKbStorage & { articleCalls: string[]; categoryCalls: string[] } {
  const articles = opts.articles ?? { [PUBLISHED_ARTICLE.slug]: PUBLISHED_ARTICLE };
  const categories = opts.categories ?? { [CATEGORY.id]: CATEGORY };
  const articleCalls: string[] = [];
  const categoryCalls: string[] = [];
  return {
    articleCalls,
    categoryCalls,
    async getKbArticleBySlug(slug) {
      articleCalls.push(slug);
      return articles[slug];
    },
    async getKbCategory(id) {
      categoryCalls.push(id);
      return categories[id];
    },
  };
}

// ---------- resolveKbArticleAttachment ----------

test("resolveKbArticleAttachment: unknown slug returns 400", async () => {
  const s = mockStorage({ articles: {} });
  const r = await resolveKbArticleAttachment("missing-slug", s);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 400);
    assert.match(r.error, /not found/i);
  }
});

test("resolveKbArticleAttachment: unpublished slug returns 400", async () => {
  const s = mockStorage({ articles: { "draft-only": UNPUBLISHED_ARTICLE } });
  const r = await resolveKbArticleAttachment("draft-only", s);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.status, 400);
});

test("resolveKbArticleAttachment: valid slug returns the kbArticle envelope", async () => {
  const s = mockStorage();
  const r = await resolveKbArticleAttachment("how-to-pay", s);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.slug, "how-to-pay");
    assert.deepEqual(r.info, {
      slug: "how-to-pay",
      title: "How to pay",
      categoryName: "Billing",
      summary: "Pay your bill in 3 steps",
    });
  }
});

test("resolveKbArticleAttachment: envelope categoryName is null when category lookup misses", async () => {
  const s = mockStorage({ categories: {} });
  const r = await resolveKbArticleAttachment("how-to-pay", s);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.info.categoryName, null);
});

// ---------- enrichKbArticlesForMessages ----------

test("enrichKbArticlesForMessages: includes kbArticle envelope for messages with the slug column set", async () => {
  const s = mockStorage();
  const map = await enrichKbArticlesForMessages(
    [
      { kbArticleSlug: null },
      { kbArticleSlug: "how-to-pay" },
      { kbArticleSlug: null },
    ],
    s,
  );
  assert.equal(map.size, 1);
  const env = map.get("how-to-pay");
  assert.ok(env, "expected envelope for how-to-pay");
  assert.deepEqual(env, {
    slug: "how-to-pay",
    title: "How to pay",
    categoryName: "Billing",
    summary: "Pay your bill in 3 steps",
  });
});

test("enrichKbArticlesForMessages: dedupes slug lookups across messages", async () => {
  const s = mockStorage();
  await enrichKbArticlesForMessages(
    [
      { kbArticleSlug: "how-to-pay" },
      { kbArticleSlug: "how-to-pay" },
      { kbArticleSlug: "how-to-pay" },
    ],
    s,
  );
  assert.equal(s.articleCalls.length, 1);
});

test("enrichKbArticlesForMessages: skips unpublished or missing articles", async () => {
  const s = mockStorage({
    articles: { "draft-only": UNPUBLISHED_ARTICLE, "how-to-pay": PUBLISHED_ARTICLE },
  });
  const map = await enrichKbArticlesForMessages(
    [
      { kbArticleSlug: "draft-only" },
      { kbArticleSlug: "ghost-slug" },
      { kbArticleSlug: "how-to-pay" },
    ],
    s,
  );
  assert.equal(map.has("draft-only"), false);
  assert.equal(map.has("ghost-slug"), false);
  assert.equal(map.has("how-to-pay"), true);
});

test("enrichKbArticlesForMessages: returns an empty map when no message has a slug", async () => {
  const s = mockStorage();
  const map = await enrichKbArticlesForMessages([{ kbArticleSlug: null }], s);
  assert.equal(map.size, 0);
  assert.equal(s.articleCalls.length, 0);
});
