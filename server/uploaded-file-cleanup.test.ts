import { test } from "node:test";
import assert from "node:assert/strict";
import { extractUploadFilename, deleteUploadedFileIfUnreferenced } from "./uploaded-file-cleanup";

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
