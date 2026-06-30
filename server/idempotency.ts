import type { Request, Response, NextFunction } from "express";

// In-process idempotency store for the customer-initiated WHMCS *money* writes
// (place order, store order, plan upgrade, cancellation). Task #588 added a
// client-side "your action may have gone through" warning when a write times
// out; this turns that warning into a guarantee: a retry that carries the SAME
// idempotency key never reaches WHMCS a second time, so a timeout-driven retry
// can't create a duplicate order/invoice or a duplicate cancellation.
//
// How it works:
//   1. The client generates one key per submission attempt and reuses it across
//      retries of that attempt (a fresh, intentional submission gets a new key).
//   2. The key arrives in the `Idempotency-Key` header. The store is keyed by
//      `${sessionUserId}:${key}` so keys can never collide across users and a
//      stolen key is useless against another account.
//   3. The FIRST request for a key is *claimed* (marked pending) and runs the
//      handler. We only persist its response once the handler signals — via
//      `res.locals.whmcsWriteAttempted` — that it actually handed the request to
//      WHMCS. Pre-write rejections (bad input, unlinked account, unreachable
//      catalogue) are NOT persisted, so a corrected resubmit with the same key
//      still goes through.
//   4. A later request for the same key REPLAYS the stored status + body without
//      touching WHMCS. A request that arrives while the first is still in flight
//      (a fast double-click, or a retry during a slow WHMCS call) gets a 409 so
//      the same submission never runs twice concurrently.
//
// Single-instance, in-memory (mirrors server/rate-limits.ts). Entries expire
// after a window generous enough to span a client timeout (30s) plus the human
// gap before a manual retry; revisit if the app ever runs multi-process.

type IdempotencyEntry =
  | { state: "pending"; expiresAt: number }
  | { state: "done"; status: number; body: unknown; expiresAt: number };

// The dedupe window. The client mutation timeout is 30s; a user then reads the
// "may have gone through" warning and (maybe) retries. 10 minutes comfortably
// covers that gap AND a genuinely slow WHMCS order call still in flight, while
// staying short enough that a much-later, intentional re-order gets a fresh run.
export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

const store = new Map<string, IdempotencyEntry>();

function sweepExpired(now: number): void {
  for (const [key, entry] of store) {
    if (entry.expiresAt <= now) store.delete(key);
  }
}

export type BeginResult =
  | { kind: "claimed" }
  | { kind: "in_progress" }
  | { kind: "replay"; status: number; body: unknown };

/**
 * Atomically claim a key, replay a finished one, or report one still in flight.
 * The Map operations are synchronous, so this whole check-and-set runs without
 * interleaving — two concurrent requests can never both be "claimed".
 */
export function beginIdempotent(scopedKey: string, ttlMs: number = IDEMPOTENCY_TTL_MS): BeginResult {
  const now = Date.now();
  sweepExpired(now);
  const existing = store.get(scopedKey);
  if (existing) {
    if (existing.state === "done") {
      return { kind: "replay", status: existing.status, body: existing.body };
    }
    return { kind: "in_progress" };
  }
  store.set(scopedKey, { state: "pending", expiresAt: now + ttlMs });
  return { kind: "claimed" };
}

/** Record the final response for a claimed key so later retries replay it. */
export function completeIdempotent(
  scopedKey: string,
  status: number,
  body: unknown,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
): void {
  store.set(scopedKey, { state: "done", status, body, expiresAt: Date.now() + ttlMs });
}

/**
 * Drop a claimed key without recording it, so a retry runs again. Used when the
 * handler rejected the request BEFORE attempting the WHMCS write (nothing
 * dangerous happened, so the same key should not be "spent").
 */
export function abandonIdempotent(scopedKey: string): void {
  store.delete(scopedKey);
}

/** Test-only: wipe the store so cases don't leak state into each other. */
export function __resetIdempotencyStore(): void {
  store.clear();
}

// Keys are client-generated (crypto.randomUUID), so they're already opaque and
// unique. We only sanity-check shape: a non-empty, reasonably-bounded token.
// Anything malformed (or absent) means "no dedupe" — the request just runs,
// preserving the pre-existing behaviour rather than failing the call.
const KEY_PATTERN = /^[A-Za-z0-9._-]{8,200}$/;

export function isValidIdempotencyKey(raw: unknown): raw is string {
  return typeof raw === "string" && KEY_PATTERN.test(raw);
}

/**
 * Express middleware that makes the route it guards idempotent per session user.
 * Mount it AFTER auth (so `req.session.userId` is set) and BEFORE the rate
 * limiter (so a replayed retry doesn't consume the limiter budget or get 429'd).
 * The guarded handler must set `res.locals.whmcsWriteAttempted = true` right
 * before it hands the request to WHMCS, or its response won't be persisted.
 */
export function createIdempotencyMiddleware(opts: { ttlMs?: number } = {}) {
  const ttlMs = opts.ttlMs ?? IDEMPOTENCY_TTL_MS;
  return (req: Request, res: Response, next: NextFunction): void => {
    const headerKey = req.get("Idempotency-Key");
    if (!isValidIdempotencyKey(headerKey)) {
      next();
      return;
    }
    const userId = req.session?.userId ?? "anon";
    const scopedKey = `${userId}:${headerKey}`;

    const begin = beginIdempotent(scopedKey, ttlMs);
    if (begin.kind === "replay") {
      res.status(begin.status).json(begin.body);
      return;
    }
    if (begin.kind === "in_progress") {
      res.status(409).json({
        ok: false,
        message:
          "We're still processing your previous request — please wait a moment before trying again.",
      });
      return;
    }

    // Claimed: capture the response body the handler sends so we can replay it.
    let captured: unknown;
    let didCapture = false;
    let closedEarly = false;

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      // Only persist (and thus block re-runs) once the handler actually handed
      // the request to WHMCS. Otherwise free the key so a corrected retry runs.
      if (didCapture && res.locals.whmcsWriteAttempted === true) {
        completeIdempotent(scopedKey, res.statusCode, captured, ttlMs);
      } else {
        abandonIdempotent(scopedKey);
      }
    };

    const originalJson = res.json.bind(res);
    res.json = (body: unknown) => {
      captured = body;
      didCapture = true;
      // If the client already disconnected (a timeout abort), `finish` will
      // never fire — finalize here so the handler's decision (write attempted or
      // not) is still recorded, and don't write to the dead socket.
      if (closedEarly) {
        settle();
        return res;
      }
      return originalJson(body);
    };

    res.on("finish", settle);
    res.on("close", () => {
      // A close AFTER the handler produced a response is the normal end-of-life
      // (or arrives right after `finish`) — settle as usual (idempotent).
      //
      // A close BEFORE any response (`!didCapture`) is a client abort while the
      // handler is still running server-side — Node does NOT kill the handler,
      // so the WHMCS write may be in flight. We must NOT abandon the key here:
      // doing so would let a retry re-run the write and double-charge. Instead
      // leave it PENDING — a retry gets a 409 until the still-running handler
      // finishes (finalizing via the patched res.json above) or the TTL lapses.
      if (didCapture) {
        settle();
      } else {
        closedEarly = true;
      }
    });

    next();
  };
}
