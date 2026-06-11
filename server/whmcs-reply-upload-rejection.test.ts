import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import multer from "multer";

// Route-level tests for the friendly upload-rejection mapping on the WHMCS
// ticket reply routes (Task #357). The server is the source of truth: even when
// the composer warns first, multer can still reject an upload that is too large
// or has too many files. These tests prove that such rejections surface as a
// clear, structured { message, code } the frontend can show verbatim instead of
// a generic 500.
//
// We mirror the private `describeUploadRejection` + `withUploadArray` wiring
// from server/routes.ts in a standalone express app (same pattern as
// server/whmcs-ticket-attachments.test.ts), using a small per-file size limit
// so we can trip LIMIT_FILE_SIZE without uploading 25MB.

const MAX_UPLOAD_FILE_SIZE_MB = 25;

function describeUploadRejection(
  err: unknown,
  maxCount: number,
): { status: number; body: { message: string; code: string } } | null {
  if (!(err instanceof multer.MulterError)) return null;
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return {
        status: 413,
        body: {
          message: `That file is too large — each attachment must be ${MAX_UPLOAD_FILE_SIZE_MB}MB or less.`,
          code: "FILE_TOO_LARGE",
        },
      };
    case "LIMIT_FILE_COUNT":
    case "LIMIT_UNEXPECTED_FILE":
      return {
        status: 413,
        body: {
          message: `Too many files — you can attach up to ${maxCount} file${maxCount === 1 ? "" : "s"} per reply.`,
          code: "TOO_MANY_FILES",
        },
      };
    default:
      return {
        status: 400,
        body: {
          message: "That attachment couldn't be uploaded. Please try a different file.",
          code: "UPLOAD_REJECTED",
        },
      };
  }
}

const MAX_ATTACHMENTS = 5;
// 1KB per-file cap so we can trip LIMIT_FILE_SIZE with a tiny payload.
const PER_FILE_BYTES = 1024;

function makeReplyApp() {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: PER_FILE_BYTES } });
  const handler = upload.array("attachments", MAX_ATTACHMENTS);
  let reachedHandler = false;

  const app = express();
  app.post(
    "/api/whmcs-tickets/:id/reply",
    (req, res, next) => {
      handler(req, res, (err: unknown) => {
        if (err) {
          const rejection = describeUploadRejection(err, MAX_ATTACHMENTS);
          if (rejection) {
            res.status(rejection.status).json(rejection.body);
            return;
          }
          next(err);
          return;
        }
        next();
      });
    },
    (req, res) => {
      reachedHandler = true;
      res.json({ ok: true, files: (req.files as Express.Multer.File[] | undefined)?.length ?? 0 });
    },
  );
  return { app, reachedHandler: () => reachedHandler };
}

async function postReply(
  app: express.Express,
  files: { name: string; content: string }[],
): Promise<{ status: number; body: any }> {
  return await new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const form = new FormData();
      form.append("message", "here you go");
      for (const f of files) form.append("attachments", new Blob([Buffer.from(f.content)]), f.name);
      fetch(`http://127.0.0.1:${port}/api/whmcs-tickets/123/reply`, { method: "POST", body: form })
        .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
        .then((out) => { server.close(); resolve(out); })
        .catch((err) => { server.close(); reject(err); });
    });
  });
}

test("oversized file → 413 FILE_TOO_LARGE with a friendly, size-specific message", async () => {
  const ctx = makeReplyApp();
  const tooBig = "x".repeat(PER_FILE_BYTES + 1);
  const r = await postReply(ctx.app, [{ name: "huge.bin", content: tooBig }]);
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "FILE_TOO_LARGE");
  assert.match(r.body.message, /too large/i);
  assert.match(r.body.message, new RegExp(`${MAX_UPLOAD_FILE_SIZE_MB}MB`));
  assert.equal(ctx.reachedHandler(), false, "the route body never runs when the upload is rejected");
});

test("too many files → 413 TOO_MANY_FILES naming the per-reply cap", async () => {
  const ctx = makeReplyApp();
  const files = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({ name: `f${i}.txt`, content: "ok" }));
  const r = await postReply(ctx.app, files);
  assert.equal(r.status, 413);
  assert.equal(r.body.code, "TOO_MANY_FILES");
  assert.match(r.body.message, new RegExp(`up to ${MAX_ATTACHMENTS} files`));
  assert.equal(ctx.reachedHandler(), false);
});

test("within both limits → 200, the route body runs normally", async () => {
  const ctx = makeReplyApp();
  const r = await postReply(ctx.app, [
    { name: "a.txt", content: "small" },
    { name: "b.txt", content: "also small" },
  ]);
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.files, 2);
  assert.equal(ctx.reachedHandler(), true);
});

test("describeUploadRejection returns null for a non-multer error (falls through to generic handler)", () => {
  assert.equal(describeUploadRejection(new Error("boom"), MAX_ATTACHMENTS), null);
});

test("describeUploadRejection: unknown multer code → 400 UPLOAD_REJECTED generic-but-friendly", () => {
  const err = new multer.MulterError("LIMIT_PART_COUNT");
  const out = describeUploadRejection(err, MAX_ATTACHMENTS);
  assert.equal(out?.status, 400);
  assert.equal(out?.body.code, "UPLOAD_REJECTED");
});
