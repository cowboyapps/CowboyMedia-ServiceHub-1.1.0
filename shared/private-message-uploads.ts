export const PRIVATE_VIDEO_MAX_BYTES = 250 * 1024 * 1024;
export const PRIVATE_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const PRIVATE_UPLOAD_TIMEOUT_MS = 60 * 60 * 1000;
export const PRIVATE_UPLOAD_LIMIT_LABEL = "Videos up to 250 MB; other files up to 25 MB.";

export function isPrivateVideo(file: { type?: string; mimetype?: string; name?: string; originalname?: string }) {
  const type = file.type || file.mimetype || "";
  return type.startsWith("video/") || ((!type || type === "application/octet-stream") &&
    /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file.name || file.originalname || ""));
}

export function privateUploadError(file: { size: number; type?: string; mimetype?: string; name?: string; originalname?: string }) {
  const video = isPrivateVideo(file);
  return file.size > (video ? PRIVATE_VIDEO_MAX_BYTES : PRIVATE_FILE_MAX_BYTES)
    ? `${video ? "Videos must be 250 MB or smaller" : "This file must be 25 MB or smaller"}.` : null;
}
