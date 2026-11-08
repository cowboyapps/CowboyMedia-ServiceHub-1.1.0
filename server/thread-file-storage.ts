import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { uploadedFileChunks, uploadedFiles } from "@shared/schema";
import type { Response } from "express";

// Persisted chunk boundaries are part of the storage format, not a tuning knob.
export const PRIVATE_FILE_CHUNK_BYTES = 1024 * 1024;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type StoredThreadUpload = {
  id?: string; filename: string; mimetype: string; data: string;
  chunked?: boolean; byteSize?: number | null;
};

export async function* privateFileBytes(file: Express.Multer.File): AsyncGenerator<Buffer> {
  if (file.buffer) {
    for (let start = 0; start < file.buffer.length; start += PRIVATE_FILE_CHUNK_BYTES) {
      yield file.buffer.subarray(start, start + PRIVATE_FILE_CHUNK_BYTES);
    }
    return;
  }
  let remaining = Buffer.alloc(0);
  for await (const bytes of createReadStream(file.path, { highWaterMark: PRIVATE_FILE_CHUNK_BYTES })) {
    remaining = remaining.length ? Buffer.concat([remaining, bytes]) : bytes;
    while (remaining.length >= PRIVATE_FILE_CHUNK_BYTES) {
      yield remaining.subarray(0, PRIVATE_FILE_CHUNK_BYTES);
      remaining = remaining.subarray(PRIVATE_FILE_CHUNK_BYTES);
    }
  }
  if (remaining.length) yield remaining;
}

export async function storePrivateFile(tx: Transaction, file: Express.Multer.File, filename: string, mimetype: string) {
  const chunked = !!file.path || file.buffer.length > PRIVATE_FILE_CHUNK_BYTES;
  const [upload] = await tx.insert(uploadedFiles).values({
    filename, mimetype, privateMessage: true, chunked, byteSize: file.size,
    data: chunked ? "" : file.buffer.toString("base64"),
  }).returning({ id: uploadedFiles.id });
  if (chunked) {
    let ordinal = 0;
    for await (const chunk of privateFileBytes(file)) {
      await tx.insert(uploadedFileChunks).values({ uploadId: upload.id, ordinal: ordinal++, data: chunk.toString("base64") });
    }
  }
}

export function storedThreadUploadSize(file: StoredThreadUpload) {
  if (file.chunked) {
    if (!file.id || !Number.isSafeInteger(file.byteSize) || file.byteSize! < 0) throw new Error("Invalid private attachment metadata");
    return file.byteSize!;
  }
  return Buffer.byteLength(file.data, "base64");
}

/** Only requested chunks are read, so video seeking/downloads never decode
 * a full 250 MB base64 string in the application process. */
export async function streamThreadUpload(file: StoredThreadUpload, start: number, end: number, res: Response) {
  async function* chunks() {
    if (!file.chunked) { yield Buffer.from(file.data, "base64").subarray(start, end + 1); return; }
    const first = Math.floor(start / PRIVATE_FILE_CHUNK_BYTES);
    const last = Math.floor(end / PRIVATE_FILE_CHUNK_BYTES);
    for (let ordinal = first; ordinal <= last; ordinal++) {
      if (res.destroyed) return;
      const [row] = await db.select({ data: uploadedFileChunks.data }).from(uploadedFileChunks)
        .where(and(eq(uploadedFileChunks.uploadId, file.id!), eq(uploadedFileChunks.ordinal, ordinal))).limit(1);
      if (!row) throw new Error("Private attachment chunk no longer available");
      const bytes = Buffer.from(row.data, "base64");
      yield bytes.subarray(Math.max(0, start - ordinal * PRIVATE_FILE_CHUNK_BYTES), Math.min(bytes.length, end + 1 - ordinal * PRIVATE_FILE_CHUNK_BYTES));
    }
  }
  await pipeline(Readable.from(chunks()), res);
}
