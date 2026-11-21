import type { NewsStory } from "@shared/schema";
import type { NewsArticleRef } from "@shared/news-attachments";

export interface NewsAttachmentStorage {
  getNewsStory(id: string): Promise<NewsStory | undefined>;
  getNewsStoriesByIds(ids: string[]): Promise<NewsStory[]>;
}

export type NewsAttachmentDecision =
  | { ok: true; newsArticleId: string | null; newsArticle: NewsArticleRef | null }
  | { ok: false; status: 400 | 403; error: string };

/** Run before persisting uploads, using the same sender permission as KB links. */
export async function resolveNewsAttachment(
  rawId: unknown, allowed: boolean, storage: Pick<NewsAttachmentStorage, "getNewsStory">,
): Promise<NewsAttachmentDecision> {
  if (rawId === undefined || rawId === null || rawId === "") {
    return { ok: true, newsArticleId: null, newsArticle: null };
  }
  if (!allowed) return { ok: false, status: 403, error: "You cannot attach news articles here" };
  if (typeof rawId !== "string" || rawId.trim().length > 100 || !rawId.trim()) {
    return { ok: false, status: 400, error: "Invalid news article" };
  }
  const story = await storage.getNewsStory(rawId.trim());
  if (!story) return { ok: false, status: 400, error: "News article not found" };
  return { ok: true, newsArticleId: story.id, newsArticle: { id: story.id, title: story.title } };
}

/** One bounded lookup per history response, not per message; deleted news stays identifiable. */
export async function enrichNewsArticlesForMessages<T extends { newsArticleId?: string | null }>(
  messages: T[], storage: Pick<NewsAttachmentStorage, "getNewsStoriesByIds">,
): Promise<Array<T & { newsArticle: NewsArticleRef | null }>> {
  const ids = [...new Set(messages.flatMap(message => message.newsArticleId ? [message.newsArticleId] : []))];
  const stories = ids.length ? await storage.getNewsStoriesByIds(ids) : [];
  const byId = new Map(stories.map(story => [story.id, { id: story.id, title: story.title }]));
  return messages.map(message => ({
    ...message, newsArticle: message.newsArticleId ? byId.get(message.newsArticleId) ?? null : null,
  }));
}
