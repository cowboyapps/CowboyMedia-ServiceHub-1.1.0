import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "./db";
import {
  kbArticles,
  newsStories,
  announcements,
  changelogEntries,
  users,
  serviceAlerts,
  alertUpdates,
  tickets,
  ticketMessages,
  reportRequests,
  adminChatMessages,
  downloads,
  threadMessages,
  communityMessages,
} from "@shared/schema";
import {
  extractUploadFilename,
  extractUploadFilenamesFromHtml,
  deleteUploadedFileIfUnreferenced,
  sweepOrphanedUploadedFiles,
  bodyHtmlReferencesUpload,
  isUploadReferenced,
} from "./uploaded-file-cleanup";

// ---------- extractUploadFilename ----------
// Guards the "only ever act on a file we own" property: anything that isn't a
// bare `/uploads/<filename>` URL must return null so cleanup is a no-op.

test("extractUploadFilename: returns the filename for a plain uploads URL", () => {
  assert.equal(extractUploadFilename("/uploads/abc-123.png"), "abc-123.png");
});

test("extractUploadFilename: null/undefined/empty are no-ops", () => {
  assert.equal(extractUploadFilename(null), null);
  assert.equal(extractUploadFilename(undefined), null);
  assert.equal(extractUploadFilename(""), null);
});

test("extractUploadFilename: external URLs are ignored", () => {
  assert.equal(extractUploadFilename("https://cdn.example.com/uploads/x.png"), null);
  assert.equal(extractUploadFilename("http://evil/uploads/x.png"), null);
});

test("extractUploadFilename: nested paths and traversal attempts are ignored", () => {
  assert.equal(extractUploadFilename("/uploads/sub/dir/x.png"), null);
  assert.equal(extractUploadFilename("/uploads/../secret"), null);
});

test("extractUploadFilename: query strings / fragments are not treated as the filename", () => {
  assert.equal(extractUploadFilename("/uploads/x.png?raw=1"), null);
  assert.equal(extractUploadFilename("/uploads/x.png#frag"), null);
});

// ---------- extractUploadFilenamesFromHtml ----------
// Drives the KB-image recovery script: it must find EVERY blob an article still
// expects (so missing ones can be re-inserted from a backup) and nothing it
// doesn't own.

test("extractUploadFilenamesFromHtml: pulls every embedded upload filename", () => {
  const body =
    '<p>One</p><img src="/uploads/a-1.png"><figure><img src="/uploads/b-2.jpg" alt="x"></figure>';
  assert.deepEqual(extractUploadFilenamesFromHtml(body), ["a-1.png", "b-2.jpg"]);
});

test("extractUploadFilenamesFromHtml: de-duplicates repeated references, first-seen order", () => {
  const body = '<img src="/uploads/z.png"><img src="/uploads/a.png"><img src="/uploads/z.png">';
  assert.deepEqual(extractUploadFilenamesFromHtml(body), ["z.png", "a.png"]);
});

test("extractUploadFilenamesFromHtml: stops at quotes, query strings and fragments", () => {
  const body = '<img src="/uploads/x.png?raw=1"><img src=\'/uploads/y.png#frag\'>';
  assert.deepEqual(extractUploadFilenamesFromHtml(body), ["x.png", "y.png"]);
});

test("extractUploadFilenamesFromHtml: null/undefined/empty and image-free bodies yield []", () => {
  assert.deepEqual(extractUploadFilenamesFromHtml(null), []);
  assert.deepEqual(extractUploadFilenamesFromHtml(undefined), []);
  assert.deepEqual(extractUploadFilenamesFromHtml(""), []);
  assert.deepEqual(extractUploadFilenamesFromHtml("<p>Just text, <a href=\"/help\">link</a></p>"), []);
});

// ---------- bodyHtmlReferencesUpload ----------
// Closes the in-article-image gap: a `/uploads/...` URL embedded inside a
// rich-text HTML body (KB article, news story, announcement, changelog) must be
// reported referenced so the boot sweep never deletes the blob behind it. A
// truly absent URL must still report unreferenced so genuine orphans are reaped.

test("reports referenced when the URL is embedded inside a KB article body", () => {
  const body = '<p>See this</p><img src="/uploads/kb-img.png"><p>screenshot.</p>';
  assert.equal(bodyHtmlReferencesUpload(body, "/uploads/kb-img.png"), true);
});

test("reports referenced when the URL is embedded inside a news story body", () => {
  const body = '<h2>Update</h2><figure><img src="/uploads/news-img.png" alt=""></figure>';
  assert.equal(bodyHtmlReferencesUpload(body, "/uploads/news-img.png"), true);
});

test("reports NOT referenced when the URL is absent from the body", () => {
  const body = '<p>No images here, just <a href="/help">a link</a>.</p>';
  assert.equal(bodyHtmlReferencesUpload(body, "/uploads/orphan.png"), false);
});

test("null/undefined/empty bodies are never a reference", () => {
  assert.equal(bodyHtmlReferencesUpload(null, "/uploads/x.png"), false);
  assert.equal(bodyHtmlReferencesUpload(undefined, "/uploads/x.png"), false);
  assert.equal(bodyHtmlReferencesUpload("", "/uploads/x.png"), false);
});

// End-to-end through the sweep: a blob whose ONLY reference is inside a rich-text
// body survives, while a genuinely unreferenced blob is still removed. This is
// the exact KB/news regression the task fixes, expressed via injectable deps.

test("sweep keeps a blob referenced only inside a rich-text body, deletes the orphan", async () => {
  const kbBody = '<p>Docs</p><img src="/uploads/in-article.png">';
  const newsBody = '<p>News</p><img src="/uploads/in-news.png">';
  const removed: string[] = [];
  const count = await sweepOrphanedUploadedFiles({
    listFilenames: async () => ["in-article.png", "in-news.png", "truly-orphan.png"],
    isReferenced: async (url) =>
      bodyHtmlReferencesUpload(kbBody, url) || bodyHtmlReferencesUpload(newsBody, url),
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed, ["truly-orphan.png"]);
  assert.equal(count, 1);
});

// ---------- deleteUploadedFileIfUnreferenced ----------
// The safety contract: delete ONLY when nothing references the file, never throw.

test("deletes the blob when no record references the file", async () => {
  const removed: string[] = [];
  await deleteUploadedFileIfUnreferenced("/uploads/orphan.png", {
    isReferenced: async () => false,
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed, ["orphan.png"]);
});

test("does NOT delete when another record still references the file", async () => {
  const removed: string[] = [];
  await deleteUploadedFileIfUnreferenced("/uploads/shared.png", {
    isReferenced: async () => true,
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed, []);
});

test("skips non-owned URLs without ever consulting the reference check", async () => {
  let checked = false;
  let removed = false;
  await deleteUploadedFileIfUnreferenced("https://cdn.example.com/img.png", {
    isReferenced: async () => {
      checked = true;
      return false;
    },
    remove: async () => {
      removed = true;
    },
  });
  assert.equal(checked, false);
  assert.equal(removed, false);
});

test("swallows errors so a cleanup failure can't break the delete it follows", async () => {
  await assert.doesNotReject(
    deleteUploadedFileIfUnreferenced("/uploads/x.png", {
      isReferenced: async () => {
        throw new Error("db down");
      },
    }),
  );
});

// ---------- sweepOrphanedUploadedFiles ----------
// The boot/periodic sweep: delete every zero-reference blob, keep referenced
// ones, and never throw so a single failure can't abort the whole sweep.

test("sweep removes only the blobs that nothing references", async () => {
  const referenced = new Set(["/uploads/kept.png"]);
  const removed: string[] = [];
  const count = await sweepOrphanedUploadedFiles({
    listFilenames: async () => ["kept.png", "orphan-a.png", "orphan-b.png"],
    isReferenced: async (url) => referenced.has(url),
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed.sort(), ["orphan-a.png", "orphan-b.png"]);
  assert.equal(count, 2);
});

test("sweep returns 0 and deletes nothing when every blob is referenced", async () => {
  const removed: string[] = [];
  const count = await sweepOrphanedUploadedFiles({
    listFilenames: async () => ["a.png", "b.png"],
    isReferenced: async () => true,
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed, []);
  assert.equal(count, 0);
});

test("sweep keeps going when one file's check throws, counting only successes", async () => {
  const removed: string[] = [];
  const count = await sweepOrphanedUploadedFiles({
    listFilenames: async () => ["boom.png", "orphan.png"],
    isReferenced: async (url) => {
      if (url === "/uploads/boom.png") throw new Error("db blip");
      return false;
    },
    remove: async (filename) => {
      removed.push(filename);
    },
  });
  assert.deepEqual(removed, ["orphan.png"]);
  assert.equal(count, 1);
});

test("sweep never throws when listing the files fails", async () => {
  await assert.doesNotReject(async () => {
    const count = await sweepOrphanedUploadedFiles({
      listFilenames: async () => {
        throw new Error("db down");
      },
    });
    assert.equal(count, 0);
  });
});

// ---------- isUploadReferenced (real database) ----------
// The unit tests above exercise the pure substring helper and the injectable
// sweep, but they never touch the real Drizzle `LIKE` queries in
// `referenceChecks`. A typo'd column name or a broken `LIKE` pattern would sail
// past them yet still delete in-use images in production. This integration test
// seeds a real row in every rich-text body table — kb_articles, news_stories,
// announcements, changelog_entries — each carrying a distinct `/uploads/<uuid>`
// reference, then asserts `isUploadReferenced` reports each one referenced and a
// never-seeded URL unreferenced, against an actual (test) database.

const cleanup: Array<() => Promise<void>> = [];

before(async () => {
  // Fail fast (and skip cleanly) if the DB isn't reachable.
  await db.select().from(kbArticles).limit(1);
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

test("isUploadReferenced detects /uploads URLs embedded in real rich-text bodies", async () => {
  const kbUrl = `/uploads/${randomUUID()}.png`;
  const newsUrl = `/uploads/${randomUUID()}.png`;
  const annUrl = `/uploads/${randomUUID()}.png`;
  const changelogUrl = `/uploads/${randomUUID()}.png`;

  const [kb] = await db
    .insert(kbArticles)
    .values({
      categoryId: randomUUID(),
      slug: `cleanup-int-${randomUUID()}`,
      title: "Cleanup integration article",
      bodyHtml: `<p>Docs</p><img src="${kbUrl}"><p>screenshot.</p>`,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(kbArticles).where(eq(kbArticles.id, kb.id));
  });

  const [news] = await db
    .insert(newsStories)
    .values({
      title: "Cleanup integration news",
      content: `<h2>Update</h2><figure><img src="${newsUrl}" alt=""></figure>`,
      authorId: randomUUID(),
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(newsStories).where(eq(newsStories.id, news.id));
  });

  const [ann] = await db
    .insert(announcements)
    .values({
      title: "Cleanup integration announcement",
      bodyHtml: `<p>Heads up</p><img src="${annUrl}">`,
      createdByUserId: randomUUID(),
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(announcements).where(eq(announcements.id, ann.id));
  });

  const changelogVersion = `0.0.0-cleanup-${randomUUID()}`;
  const [changelog] = await db
    .insert(changelogEntries)
    .values({
      version: changelogVersion,
      bodyHtml: `<ul><li>Now with <img src="${changelogUrl}"></li></ul>`,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(changelogEntries).where(eq(changelogEntries.version, changelog.version));
  });

  assert.equal(await isUploadReferenced(kbUrl), true, "KB article body reference is detected");
  assert.equal(await isUploadReferenced(newsUrl), true, "news story body reference is detected");
  assert.equal(await isUploadReferenced(annUrl), true, "announcement body reference is detected");
  assert.equal(await isUploadReferenced(changelogUrl), true, "changelog entry body reference is detected");

  const absentUrl = `/uploads/${randomUUID()}.png`;
  assert.equal(
    await isUploadReferenced(absentUrl),
    false,
    "a URL that was never seeded is reported unreferenced",
  );
});

// ---------- isUploadReferenced single-image columns (real database) ----------
// The rich-text test above only exercises the substring `LIKE` branches. But
// `isUploadReferenced` ALSO guards ~11 single-image columns via exact `eq`
// matches (avatars, alert/news/ticket/report images, admin-chat & community
// attachments, downloads, thread messages). A typo in any of those column
// names would silently delete an in-use image and never trip a test. This
// integration test seeds one row in each single-image table carrying a distinct
// `/uploads/<uuid>` URL and asserts every one is reported referenced, plus a
// never-seeded URL is reported unreferenced — against an actual (test) database.

test("isUploadReferenced detects /uploads URLs in real single-image columns", async () => {
  const u = () => `/uploads/${randomUUID()}.png`;
  const avatarUrl = u();
  const alertUrl = u();
  const alertUpdateUrl = u();
  const newsUrl = u();
  const ticketUrl = u();
  const ticketMsgUrl = u();
  const reportUrl = u();
  const adminChatUrl = u();
  const downloadUrl = u();
  const threadMsgUrl = u();
  const communityUrl = u();

  const [user] = await db
    .insert(users)
    .values({
      username: `cleanup-int-${randomUUID()}`,
      password: "x",
      email: `cleanup-int-${randomUUID()}@example.com`,
      fullName: "Cleanup Integration User",
      avatarUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(users).where(eq(users.id, user.id));
  });

  const [alert] = await db
    .insert(serviceAlerts)
    .values({
      title: "Cleanup integration alert",
      description: "desc",
      imageUrl: alertUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(serviceAlerts).where(eq(serviceAlerts.id, alert.id));
  });

  const [alertUpdate] = await db
    .insert(alertUpdates)
    .values({
      alertId: alert.id,
      message: "update",
      status: "investigating",
      imageUrl: alertUpdateUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(alertUpdates).where(eq(alertUpdates.id, alertUpdate.id));
  });

  const [news] = await db
    .insert(newsStories)
    .values({
      title: "Cleanup integration news image",
      content: "<p>body</p>",
      authorId: randomUUID(),
      imageUrl: newsUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(newsStories).where(eq(newsStories.id, news.id));
  });

  const [ticket] = await db
    .insert(tickets)
    .values({
      subject: "Cleanup integration ticket",
      description: "desc",
      customerId: randomUUID(),
      imageUrl: ticketUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(tickets).where(eq(tickets.id, ticket.id));
  });

  const [ticketMsg] = await db
    .insert(ticketMessages)
    .values({
      ticketId: ticket.id,
      senderId: randomUUID(),
      message: "msg",
      imageUrl: ticketMsgUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(ticketMessages).where(eq(ticketMessages.id, ticketMsg.id));
  });

  const [report] = await db
    .insert(reportRequests)
    .values({
      customerId: randomUUID(),
      type: "bug",
      title: "Cleanup integration report",
      imageUrl: reportUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(reportRequests).where(eq(reportRequests.id, report.id));
  });

  const [adminChat] = await db
    .insert(adminChatMessages)
    .values({
      threadId: randomUUID(),
      senderId: randomUUID(),
      message: "msg",
      fileUrl: adminChatUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(adminChatMessages).where(eq(adminChatMessages.id, adminChat.id));
  });

  const [download] = await db
    .insert(downloads)
    .values({
      title: "Cleanup integration download",
      description: "desc",
      downloaderCode: randomUUID(),
      downloadUrl: "https://example.com/file.zip",
      imageUrl: downloadUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(downloads).where(eq(downloads.id, download.id));
  });

  const [threadMsg] = await db
    .insert(threadMessages)
    .values({
      threadId: randomUUID(),
      senderId: randomUUID(),
      body: "body",
      imageUrl: threadMsgUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(threadMessages).where(eq(threadMessages.id, threadMsg.id));
  });

  const [community] = await db
    .insert(communityMessages)
    .values({
      userId: randomUUID(),
      chatUsername: "cleanup-int",
      content: "hi",
      imageUrl: communityUrl,
    })
    .returning();
  cleanup.push(async () => {
    await db.delete(communityMessages).where(eq(communityMessages.id, community.id));
  });

  assert.equal(await isUploadReferenced(avatarUrl), true, "user avatar reference is detected");
  assert.equal(await isUploadReferenced(alertUrl), true, "service alert image reference is detected");
  assert.equal(await isUploadReferenced(alertUpdateUrl), true, "alert update image reference is detected");
  assert.equal(await isUploadReferenced(newsUrl), true, "news story image reference is detected");
  assert.equal(await isUploadReferenced(ticketUrl), true, "ticket image reference is detected");
  assert.equal(await isUploadReferenced(ticketMsgUrl), true, "ticket message image reference is detected");
  assert.equal(await isUploadReferenced(reportUrl), true, "report request image reference is detected");
  assert.equal(await isUploadReferenced(adminChatUrl), true, "admin chat file reference is detected");
  assert.equal(await isUploadReferenced(downloadUrl), true, "download image reference is detected");
  assert.equal(await isUploadReferenced(threadMsgUrl), true, "thread message image reference is detected");
  assert.equal(await isUploadReferenced(communityUrl), true, "community message image reference is detected");

  const absentUrl = u();
  assert.equal(
    await isUploadReferenced(absentUrl),
    false,
    "a single-image URL that was never seeded is reported unreferenced",
  );
});
