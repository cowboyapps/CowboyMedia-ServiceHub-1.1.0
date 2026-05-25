import type { KbArticle, KbCategory } from "@shared/schema";

export interface KbArticleEnvelope {
  slug: string;
  title: string;
  categoryName: string | null;
  summary: string | null;
}

export interface CommunityChatKbStorage {
  getKbArticleBySlug(slug: string): Promise<KbArticle | undefined>;
  getKbCategory(id: string): Promise<KbCategory | undefined>;
  getKbArticlesBySlugs?(slugs: string[]): Promise<KbArticle[]>;
  getKbCategoriesByIds?(ids: string[]): Promise<KbCategory[]>;
}

export type ResolveKbAttachmentResult =
  | { ok: true; slug: string; info: KbArticleEnvelope }
  | { ok: false; status: 400; error: string };

// Looks up a KB article by slug and returns the lean envelope used in
// message payloads. Does NOT enforce who is allowed to attach KB links —
// each caller (community chat = admin-only; tickets = anyone in the
// conversation) is responsible for its own authorisation check before
// calling.
export async function resolveKbArticleAttachment(
  rawKbSlug: string,
  storage: CommunityChatKbStorage,
): Promise<ResolveKbAttachmentResult> {
  const article = await storage.getKbArticleBySlug(rawKbSlug);
  if (!article || !article.published) {
    return { ok: false, status: 400, error: "Knowledge base article not found" };
  }
  const category = await storage.getKbCategory(article.categoryId);
  return {
    ok: true,
    slug: article.slug,
    info: {
      slug: article.slug,
      title: article.title,
      categoryName: category?.name ?? null,
      summary: article.summary ?? null,
    },
  };
}

export async function enrichKbArticlesForMessages(
  messages: { kbArticleSlug: string | null }[],
  storage: CommunityChatKbStorage,
): Promise<Map<string, KbArticleEnvelope>> {
  const kbSlugs = Array.from(new Set(messages.map(m => m.kbArticleSlug).filter((s): s is string => !!s)));
  const kbBySlug = new Map<string, KbArticleEnvelope>();
  if (kbSlugs.length === 0) return kbBySlug;

  // Prefer batched fetches when available; fall back to per-item lookups so
  // older test storages without the batch methods still work.
  const articles = storage.getKbArticlesBySlugs
    ? await storage.getKbArticlesBySlugs(kbSlugs)
    : (await Promise.all(kbSlugs.map(s => storage.getKbArticleBySlug(s)))).filter((a): a is KbArticle => !!a);
  const publishedArticles = articles.filter(a => a.published);
  if (publishedArticles.length === 0) return kbBySlug;

  const categoryIds = Array.from(new Set(publishedArticles.map(a => a.categoryId)));
  const categories = storage.getKbCategoriesByIds
    ? await storage.getKbCategoriesByIds(categoryIds)
    : (await Promise.all(categoryIds.map(id => storage.getKbCategory(id)))).filter((c): c is KbCategory => !!c);
  const categoryById = new Map(categories.map(c => [c.id, c]));

  for (const article of publishedArticles) {
    kbBySlug.set(article.slug, {
      slug: article.slug,
      title: article.title,
      categoryName: categoryById.get(article.categoryId)?.name ?? null,
      summary: article.summary ?? null,
    });
  }
  return kbBySlug;
}
