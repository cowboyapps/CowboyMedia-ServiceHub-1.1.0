import type { Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";

// Postgres-backed idempotency store for the customer-initiated WHMCS *money*
// writes (place order, store order, plan upgrade, cancellation). Task #588 added
// a client-side "your action may have gone through" warning when a write times
// out; Task #591 turned that warning into a guarantee. This task (#596) moves
// the store from an in-process Map to Postgres so the guarantee survives a
// redeploy/restart mid-submission AND holds no matter which app process a retry
// is routed to (the in-process Map re-opened the double-charge window on a
// multi-process deployment or a redeploy that dropped all in-flight keys).
//
// How it works:
//   1. The client generates one key per submission attempt and reuses it across
//      retries of that attempt (a fresh, intentional submission gets a new key).
//   2. The key arrives in the `Idempotency-Key` header. The store is keyed by
//      `${sessionUserId}:${key}` so keys can never collide across users and a
//      stolen key is useless against another account.
//   3. The FIRST request for a key is *claimed* (a `pending` row is inserted)
//      and runs the handler. We only persist its response once the handler
//      signals — via `res.locals.whmcsWriteAttempted` — that it actually handed
//      the request to WHMCS. Pre-write rejections (bad input, unlinked account,
//      unreachable catalogue) are NOT persisted, so a corrected resubmit with
//      the same key still goes through.
//   4. A later request for the same key REPLAYS the stored status + body without
//      touching WHMCS. A request that arrives while the first is still in flight
//      (a fast double-click, or a retry during a slow WHMCS call) gets a 409 so
//      the same submission never runs twice concurrently.
//
// Cross-process safety comes from the row's PRIMARY KEY: the claim is a single
// `INSERT ... ON CONFLICT (scoped_key) DO NOTHING` — at most one process wins
// the insert, every other concurrent attempt sees the existing row and replays
// or 409s. A redeploy that kills the winning process mid-write leaves the
// `pending` row behind, so a retry routed to a fresh process gets a 409 until
// the TTL lapses rather than re-running the (possibly already-charged) write.

// The dedupe window. The client mutation timeout is 30s; a user then reads the
// "may have gone through" warning and (maybe) retries. 10 minutes comfortably
// covers that gap AND a genuinely slow WHMCS order call still in flight, while
// staying short enough that a much-later, intentional re-order gets a fresh run.
// It also bounds how long a `pending` row orphaned by a hard process kill blocks
// retries before the key becomes claimable again.
export const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

export type BeginResult =
  | { kind: "claimed" }
  | { kind: "in_progress" }
  | { kind: "replay"; status: number; body: unknown };

function rowsOf<T>(res: unknown): T[] {
  // db.execute returns the pg result; normalize array-vs-{rows} shapes.
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] })?.rows ?? []) as T[];
}

/**
 * Atomically claim a key, replay a finished one, or report one still in flight.
 * The claim is a single `INSERT ... ON CONFLICT DO NOTHING`, so two concurrent
 * requests (even on different processes) can never both be "claimed": exactly
 * one wins the insert; the rest fall through to the replay/in-progress read.
 */
export async function beginIdempotent(
  scopedKey: string,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
): Promise<BeginResult> {
  const now = Date.now();
  const expiresAt = now + ttlMs;

  // Reap anything past its TTL first so an expired key (incl. one orphaned by a
  // hard process kill) is reclaimable. After this, any surviving conflict row
  // is guaranteed live, which keeps the claim/replay logic below simple.
  await db.execute(sql`DELETE FROM idempotency_keys WHERE expires_at <= ${now}`);

  const claim = await db.execute(sql`
    INSERT INTO idempotency_keys ("scoped_key", "state", "expires_at")
    VALUES (${scopedKey}, 'pending', ${expiresAt})
    ON CONFLICT ("scoped_key") DO NOTHING
    RETURNING "scoped_key"
  `);
  if (rowsOf(claim).length > 0) {
    return { kind: "claimed" };
  }

  // We lost the insert race — a live row exists. Read it to decide replay vs
  // in-flight. If it vanished in the gap (expired/abandoned), treat as
  // in_progress: safe (no double charge), and an immediate retry will claim it.
  const existing = await db.execute(sql`
    SELECT "state", "status", "body" FROM idempotency_keys
    WHERE "scoped_key" = ${scopedKey}
  `);
  const row = rowsOf<{ state: string; status: number | null; body: unknown }>(existing)[0];
  if (!row) return { kind: "in_progress" };
  if (row.state === "done") {
    return { kind: "replay", status: Number(row.status), body: row.body };
  }
  return { kind: "in_progress" };
}

/** Record the final response for a claimed key so later retries replay it. */
export async function completeIdempotent(
  scopedKey: string,
  status: number,
  body: unknown,
  ttlMs: number = IDEMPOTENCY_TTL_MS,
): Promise<void> {
  const expiresAt = Date.now() + ttlMs;
  const bodyJson = JSON.stringify(body ?? null);
  await db.execute(sql`
    INSERT INTO idempotency_keys ("scoped_key", "state", "status", "body", "expires_at")
    VALUES (${scopedKey}, 'done', ${status}, ${bodyJson}::jsonb, ${expiresAt})
    ON CONFLICT ("scoped_key") DO UPDATE
      SET "state" = 'done', "status" = ${status}, "body" = ${bodyJson}::jsonb, "expires_at" = ${expiresAt}
  `);
}

/**
 * Drop a claimed key without recording it, so a retry runs again. Used when the
 * handler rejected the request BEFORE attempting the WHMCS write (nothing
 * dangerous happened, so the same key should not be "spent").
 */
export async function abandonIdempotent(scopedKey: string): Promise<void> {
  await db.execute(sql`DELETE FROM idempotency_keys WHERE "scoped_key" = ${scopedKey}`);
}

/** Test-only: wipe the store so cases don't leak state into each other. */
export async function __resetIdempotencyStore(): Promise<void> {
  await db.execute(sql`DELETE FROM idempotency_keys`);
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

    // State shared between the async claim below and the response listeners.
    let claimed = false; // we only finalize a key WE actually claimed
    let captured: unknown;
    let didCapture = false;
    let closedEarly = false;
    let settled = false;

    const settle = (): Promise<void> => {
      // Finalize the claimed key exactly once. Only persist (block re-runs) once
      // the handler actually handed the request to WHMCS; otherwise free the key
      // so a corrected retry runs. Never throws — callers fire-and-forget.
      if (!claimed || settled) return Promise.resolve();
      settled = true;
      const p =
        didCapture && res.locals.whmcsWriteAttempted === true
          ? completeIdempotent(scopedKey, res.statusCode, captured, ttlMs)
          : abandonIdempotent(scopedKey);
      return p.catch((err) => console.error("[idempotency] settle failed:", err));
    };

    // Attach the lifecycle listeners SYNCHRONOUSLY, before the async claim. The
    // claim now does DB round-trips, so a fast client abort can land while it's
    // still in flight; registering here guarantees that `close` is never missed
    // (the in-process Map claimed synchronously, so this was free before). Until
    // the key is claimed these are inert (`settle` no-ops on `!claimed`).
    res.on("finish", () => void settle());
    res.on("close", () => {
      // A close AFTER the handler produced a response is the normal end-of-life
      // (or arrives right after `finish`) — settle as usual (idempotent).
      //
      // A close BEFORE any response (`!didCapture`) is a client abort while the
      // handler is still running server-side — Node does NOT kill the handler,
      // so the WHMCS write may be in flight. We must NOT abandon the key here:
      // doing so would let a retry re-run the write and double-charge. Instead
      // leave it PENDING — a retry gets a 409 until the still-running handler
      // finishes (finalizing via the patched res.json below) or the TTL lapses.
      if (didCapture) void settle();
      else closedEarly = true;
    });

    void (async () => {
      let begin: BeginResult;
      try {
        begin = await beginIdempotent(scopedKey, ttlMs);
      } catch (err) {
        // The store is unavailable (e.g. DB hiccup, table missing mid-rollout).
        // FAIL CLOSED: these routes are money writes — running the handler
        // without a working dedupe check would re-open the double-charge window
        // a retry could exploit. Refuse the request and tell the client to
        // retry; the same idempotency key keeps the eventual retry safe.
        console.error("[idempotency] begin failed; refusing request (fail-closed):", err);
        if (!closedEarly && !res.writableEnded) {
          res.status(503).json({
            ok: false,
            message:
              "We couldn't safely process your request right now. Please try again in a moment.",
          });
        }
        return;
      }

      if (begin.kind === "replay") {
        if (!closedEarly && !res.writableEnded) res.status(begin.status).json(begin.body);
        return;
      }
      if (begin.kind === "in_progress") {
        if (!closedEarly && !res.writableEnded) {
          res.status(409).json({
            ok: false,
            message:
              "We're still processing your previous request — please wait a moment before trying again.",
          });
        }
        return;
      }

      // Claimed: capture the response body the handler sends so we can replay it.
      claimed = true;
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        captured = body;
        didCapture = true;
        // If the client already disconnected (a timeout abort), `finish` will
        // never fire — finalize here so the handler's decision (write attempted
        // or not) is still recorded, and don't write to the dead socket.
        if (closedEarly) {
          void settle();
          return res;
        }
        // Persist the outcome BEFORE the response reaches the client, so any
        // retry the client fires next always observes the final state (done /
        // cleared) rather than racing a still-`pending` row into a spurious 409.
        void settle().finally(() => originalJson(body));
        return res;
      };

      next();
    })();
  };
}
