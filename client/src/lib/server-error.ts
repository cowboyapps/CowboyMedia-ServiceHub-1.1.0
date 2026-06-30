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

/**
 * True when an error is the client-side request timeout that `apiRequest` throws
 * (its `TimeoutError`, identified by `name` to stay decoupled from queryClient).
 * The default mutation timeout aborts the request on OUR side, but the server may
 * already have received and processed it — so a timeout outcome is ambiguous, not
 * a clean "it failed".
 */
export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === "TimeoutError";
}

/**
 * Warning shown when a money-related, one-shot action (placing an order, a store
 * order, a plan upgrade, a cancellation request) times out on the client. Because
 * the server may still have processed the request, a plain "timed out, try again"
 * could make the customer submit twice (double order / double charge). Instead we
 * tell them the request MAY have gone through and to verify before retrying.
 * `checkSubject` names what to check first (e.g. "services and invoices").
 */
export function paymentTimeoutMessage(checkSubject = "services and invoices"): string {
  return (
    `Your request timed out before we could confirm it — but it may still have gone through. ` +
    `Please check your ${checkSubject} before trying again, so you don't submit it twice.`
  );
}
