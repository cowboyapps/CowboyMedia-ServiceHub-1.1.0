import type { NewsArticleRef } from "@shared/news-attachments";

const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Use configured public origin only, never an untrusted incoming Host header. */
export function newsTranscriptLink(
  message: { newsArticleId?: string | null; newsArticle?: NewsArticleRef | null },
  publicBaseUrl = "",
): string {
  if (!message.newsArticleId) return "";
  if (message.newsArticle === null) return "<p>Shared news article is no longer available.</p>";
  const title = escape(message.newsArticle?.title ?? "View news article");
  const path = `/news/${encodeURIComponent(message.newsArticleId)}`;
  try {
    const url = new URL(path, publicBaseUrl);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return `<p><a href="${escape(url.href)}">News: ${title}</a></p>`;
    }
  } catch { /* Without a configured origin, retain a readable reference. */ }
  return `<p>News: ${title} (${escape(path)})</p>`;
}
