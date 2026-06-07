import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUploadFilename, deleteUploadedFileIfUnreferenced, sweepOrphanedUploadedFiles } from "./uploaded-file-cleanup";

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
