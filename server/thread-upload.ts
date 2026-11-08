import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import { PRIVATE_VIDEO_MAX_BYTES, PRIVATE_UPLOAD_LIMIT_LABEL, privateUploadError } from "@shared/private-message-uploads";

const pending = new Map<string, { readers: number; cleanup: boolean }>();
const paths = new WeakMap<object, string>();
const activeByUser = new Map<string, number>();
let activeCount = 0;
const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (req, _file, done) => {
      const name = `servicehub-private-${randomUUID()}`;
      const path = join(tmpdir(), name);
      paths.set(req, path);
      pending.set(path, { readers: 0, cleanup: false });
      done(null, name);
    },
  }),
  // Busboy emits LIMIT_FILE_SIZE at equality. The explicit validation below
  // rejects >250 MB while allowing a video exactly at the advertised limit.
  limits: { fileSize: PRIVATE_VIDEO_MAX_BYTES + 1, files: 1 },
}).single("image");
const uuid = z.string().uuid();

function cleanup(path?: string) {
  if (!path) return;
  const state = pending.get(path);
  if (state?.readers) { state.cleanup = true; return; }
  pending.delete(path);
  void unlink(path).catch(error => { if (error.code !== "ENOENT") console.error("Temporary private upload cleanup failed"); });
}

/** Response disconnects cannot unlink a file while persistence is reading it. */
export function retainPrivateUpload(file?: Express.Multer.File) {
  const path = file?.path;
  if (!path) return () => {};
  const state = pending.get(path) ?? { readers: 0, cleanup: false };
  pending.set(path, state);
  state.readers++;
  return () => { state.readers--; cleanup(path); };
}

export function privateMessageUpload<P>(req: Request<P>, res: Response, next: NextFunction) {
  const actor = req.session?.userId || req.ip || "unknown";
  if (activeCount >= 4 || (activeByUser.get(actor) || 0) >= 2) {
    return res.status(429).json({ message: "Other attachments are still uploading. Please wait a moment and try again." });
  }
  activeCount++;
  activeByUser.set(actor, (activeByUser.get(actor) || 0) + 1);
  let released = false;
  const releaseSlot = () => {
    if (released) return;
    released = true;
    activeCount--;
    const count = (activeByUser.get(actor) || 1) - 1;
    if (count) activeByUser.set(actor, count); else activeByUser.delete(actor);
  };
  req.setTimeout(180_000);
  const tidy = () => { releaseSlot(); cleanup(paths.get(req)); };
  res.once("finish", tidy);
  res.once("close", tidy);
  req.once("aborted", tidy);
  upload(req as Request, res, (error: unknown) => {
    if (!error) {
      const message = req.file ? privateUploadError(req.file) : null;
      if (message) { tidy(); return res.status(413).json({ message }); }
      return next();
    }
    tidy();
    if (error instanceof multer.MulterError) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        message: error.code === "LIMIT_FILE_SIZE" ? PRIVATE_UPLOAD_LIMIT_LABEL : "Attach one file per message, then try again.",
        code: error.code,
      });
    }
    return next(error);
  });
}

export function privateSendIds<P>(req: Request<P>, res: Response, next: NextFunction) {
  for (const key of ["clientMessageId", "clientThreadId"]) {
    if (req.body?.[key] !== undefined && !uuid.safeParse(req.body[key]).success) {
      return res.status(400).json({ message: "Invalid send ID. Please reopen the conversation and try again." });
    }
  }
  if (req.body?.body?.length > 100000 || req.body?.subject?.length > 500) return res.status(400).json({ message: "This message or subject is too long." });
  return next();
}
