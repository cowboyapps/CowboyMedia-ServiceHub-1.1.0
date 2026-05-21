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
}

export type ResolveKbAttachmentResult =
  | { ok: true; slug: string; info: KbArticleEnvelope }
  | { ok: false; status: 400 | 403; error: string };

export async function resolveKbArticleAttachment(
  rawKbSlug: string,
  isAdmin: boolean,
  storage: CommunityChatKbStorage,
): Promise<ResolveKbAttachmentResult> {
  if (!isAdmin) {
    return { ok: false, status: 403, error: "Only admins can attach knowledge base articles" };
  }
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
  const kbSlugs = [...new Set(messages.map(m => m.kbArticleSlug).filter((s): s is string => !!s))];
  const kbBySlug = new Map<string, KbArticleEnvelope>();
  for (const slug of kbSlugs) {
    const article = await storage.getKbArticleBySlug(slug);
    if (!article || !article.published) continue;
    const category = await storage.getKbCategory(article.categoryId);
    kbBySlug.set(slug, {
      slug: article.slug,
      title: article.title,
      categoryName: category?.name ?? null,
      summary: article.summary ?? null,
    });
  }
  return kbBySlug;
}
