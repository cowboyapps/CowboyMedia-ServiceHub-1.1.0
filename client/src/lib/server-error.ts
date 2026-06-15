/**
 * apiRequest throws `Error("<status>: <body>")` on a non-2xx response, where
 * <body> is the raw JSON the server returned. Many server endpoints degrade to
 * tagged shapes (404 unowned/unknown, 409 status-guard / unlinked / unavailable,
 * 502 unreachable, 400 errors) each carrying a human-readable `message`. Pull
 * that `message` back out so the customer sees
 * "Only an active service can be suspended." instead of
 * `409: {"ok":false,"message":"..."}`.
 */
export function serverActionErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const match = err.message.match(/^\s*\d{3}:\s*([\s\S]*)$/);
  const raw = (match ? match[1] : err.message).trim();
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    // Parsed as JSON but no usable message — don't echo raw JSON at the customer.
    return fallback;
  } catch {
    // Body wasn't JSON (e.g. plain statusText) — surface it as-is.
    return raw || fallback;
  }
}
