import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { NewsStory } from "@shared/schema";
import { resolveNewsAttachment, enrichNewsArticlesForMessages } from "./news-attachments";
import { newsTranscriptLink } from "./news-transcript";
import { checkCommunityMessageEdit } from "./community-chat-edit";

const story: NewsStory = {
  id: "news-one", title: "Service announcement", content: "<p>Subscriber update</p>",
  imageUrl: null, authorId: "admin", createdAt: new Date(),
};

test("news-only references resolve to lean metadata and absent references remain absent", async () => {
  let reads = 0;
  const storage = { getNewsStory: async (id: string) => { reads++; return id === story.id ? story : undefined; } };
  for (const absent of [undefined, null, ""]) {
    assert.deepEqual(await resolveNewsAttachment(absent, false, storage), { ok: true, newsArticleId: null, newsArticle: null });
  }
  assert.equal(reads, 0);
  assert.deepEqual(await resolveNewsAttachment(" news-one ", true, storage), {
    ok: true, newsArticleId: "news-one", newsArticle: { id: story.id, title: story.title },
  });
  assert.deepEqual(await resolveNewsAttachment("removed", true, storage), { ok: false, status: 400, error: "News article not found" });
});

test("sender permission and malformed input reject before news lookups or upload persistence", async () => {
  const storage = { getNewsStory: async () => { throw new Error("Lookup must not run"); } };
  assert.equal((await resolveNewsAttachment("news-one", false, storage)).ok, false);
  for (const invalid of [[], ["one", "two"], {}, true, 10, " ".repeat(3), "a".repeat(101)]) {
    assert.deepEqual(await resolveNewsAttachment(invalid, true, storage), { ok: false, status: 400, error: "Invalid news article" });
  }
});

test("message history batches news lookups and preserves removed references", async () => {
  let reads = 0;
  const messages = [{ id: "a", newsArticleId: "news-one" }, { id: "b", newsArticleId: "news-one" },
    { id: "c", newsArticleId: "removed" }, { id: "d", newsArticleId: null }];
  const storage = { getNewsStoriesByIds: async (ids: string[]) => {
    reads++; assert.deepEqual(ids, ["news-one", "removed"]); return [story];
  } };
  const result = await enrichNewsArticlesForMessages(messages, storage);
  assert.equal(reads, 1);
  assert.equal(result[0].newsArticle?.title, story.title);
  assert.equal(result[1].newsArticle?.id, story.id);
  assert.equal(result[2].newsArticleId, "removed");
  assert.equal(result[2].newsArticle, null);
  assert.equal(result[3].newsArticle, null);
  await enrichNewsArticlesForMessages([{ newsArticleId: null }], storage);
  assert.equal(reads, 1, "ordinary messages cause no news query");
});

test("all four real send routes validate news before committing files or messages", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  for (const path of ["/api/tickets/:id/messages", "/api/message-threads", "/api/message-threads/:id/messages", "/api/community-chat/messages"]) {
    const start = source.indexOf(`app.post("${path}"`);
    assert.ok(start >= 0, path);
    const nextRoute = source.slice(start + 1).search(/\n  app\.(get|post|patch|delete|put)\(/);
    const route = source.slice(start, nextRoute < 0 ? undefined : start + 1 + nextRoute);
    const validation = route.indexOf("resolveNewsAttachment(");
    const commit = route.search(/await (saveUploadedFile|persistThreadSend)\(/);
    assert.ok(validation >= 0 && commit > validation, `${path}: news guard must precede uploads`);
    assert.match(route, /if \(!newsDecision\.ok\) return res\.status/);
    assert.match(route, /newsArticleId,/);
  }
});

test("news transcripts escape titles and IDs, and never use an unsafe origin", () => {
  const message = { newsArticleId: 'one/"><script>', newsArticle: { id: "one", title: '<img onerror="x"> & more' } };
  const html = newsTranscriptLink(message, "https://example.test");
  assert.match(html, /href="https:\/\/example\.test\/news\/one%2F/);
  assert.match(html, /&lt;img onerror=&quot;x&quot;&gt; &amp; more/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!newsTranscriptLink(message, "javascript:alert(1)").includes("<a"));
  assert.ok(!newsTranscriptLink(message).includes("<a"));
  assert.match(newsTranscriptLink({ newsArticleId: "gone", newsArticle: null }), /no longer available/);
  assert.equal(newsTranscriptLink({ newsArticleId: null }), "");
});

test("an existing news attachment permits an empty community caption without weakening edit ownership", () => {
  const input = {
    message: { userId: "author", createdAt: new Date(), pollId: null },
    requesterId: "author", isAdmin: false, newContent: "", hasImage: false,
    hasKbArticle: false, hasNewsArticle: true,
  };
  assert.deepEqual(checkCommunityMessageEdit(input), { ok: true });
  const denied = checkCommunityMessageEdit({ ...input, requesterId: "different-customer" });
  assert.equal(denied.ok, false);
  if (!denied.ok) assert.equal(denied.status, 403);
  assert.equal(checkCommunityMessageEdit({ ...input, hasNewsArticle: false }).ok, false);
});
