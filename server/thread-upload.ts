import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { z } from "zod";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } }).single("image");
const uuid = z.string().uuid();

export function privateMessageUpload<P>(req: Request<P>, res: Response, next: NextFunction) {
  upload(req as Request, res, (error: unknown) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({
        message: error.code === "LIMIT_FILE_SIZE" ? "This file is too large. Each attachment must be 25 MB or smaller." : "Attach one file per message, then try again.",
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
