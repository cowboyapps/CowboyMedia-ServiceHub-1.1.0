// Pure reducer helpers extracted from client/src/pages/ticket-detail.tsx so the
// WS-vs-POST reconciliation (which used to be inline in the WebSocket
// handler) is unit-testable without mounting the page.
//
// Both helpers are referentially-pure: they take prev state + incoming and
// return the next state. No I/O, no React.

export interface ReconcileMessage {
  id: string;
  senderId: string;
  message: string;
  isInternal?: boolean | null;
}

export interface ReconcileOptimistic {
  id: string;
  senderId: string;
  message: string;
  isInternal?: boolean | null;
  status: "sending" | "failed";
}

/**
 * Merge a broadcast message into the cached message list.
 *
 * Branches covered:
 * - `prev === undefined` → seed the cache with `[incoming]` (covers the
 *   first message landing before the initial GET resolves).
 * - existing entry with the same id → return prev unchanged (covers the
 *   server sometimes broadcasting twice via the internal-notes /
 *   admin-only fan-out path, and the sender already having it via their
 *   own POST `.then()` invalidation).
 * - otherwise → append.
 */
export function mergeIncomingMessageIntoCache<M extends ReconcileMessage>(
  prev: M[] | undefined,
  incoming: M,
): M[] {
  if (!prev) return [incoming];
  if (prev.some((m) => m.id === incoming.id)) return prev;
  return [...prev, incoming];
}

/**
 * Remove at most ONE matching optimistic placeholder when our own send is
 * echoed back over the WebSocket before the POST `.then()` had a chance to
 * remove it. Matching is sender + text + isInternal (there is no shared id
 * between an optimistic temp row and the real server row).
 *
 * Only the SINGLE oldest matching pending entry is removed so rapid duplicate
 * sends ("ok" / "ok") don't lose their second optimistic bubble — the second
 * one stays pending and remains retryable if its POST eventually fails.
 *
 * Failed optimistic rows are NEVER consumed by reconciliation: a separate
 * incoming broadcast must not silently swallow a still-retryable failure.
 */
/**
 * Append a fresh optimistic row. Used on first send (no existing tempId).
 */
export function appendOptimistic<O extends ReconcileOptimistic>(
  prev: O[],
  msg: O,
): O[] {
  return [...prev, msg];
}

/**
 * Flip an existing optimistic row back to `sending`. Used by the Retry button
 * when re-running `doSendMessage` against an already-rendered `failed` bubble:
 * the row must stay in place (preserve position + attached image/kb) but its
 * status flips back to `sending` so the spinner replaces the retry affordance.
 *
 * If the id is unknown the list is returned unchanged (no row is inserted) —
 * the caller is responsible for ensuring the id is one it already owns.
 */
export function markOptimisticSending<O extends ReconcileOptimistic>(
  prev: O[],
  id: string,
): O[] {
  let changed = false;
  const next = prev.map((m) => {
    if (m.id !== id) return m;
    if (m.status === "sending") return m;
    changed = true;
    return { ...m, status: "sending" as const };
  });
  return changed ? next : prev;
}

/**
 * Flip an optimistic row to `failed` after its POST rejects. The row is kept
 * (not removed) so the user can hit Retry. No-op when the id isn't present
 * (e.g. the row was already reconciled away by a WS broadcast).
 */
export function markOptimisticFailed<O extends ReconcileOptimistic>(
  prev: O[],
  id: string,
): O[] {
  let changed = false;
  const next = prev.map((m) => {
    if (m.id !== id) return m;
    if (m.status === "failed") return m;
    changed = true;
    return { ...m, status: "failed" as const };
  });
  return changed ? next : prev;
}

/**
 * Remove an optimistic row by id after its POST resolves. The server-side
 * row will land via the subsequent cache invalidation / WS broadcast.
 */
export function removeOptimisticById<O extends ReconcileOptimistic>(
  prev: O[],
  id: string,
): O[] {
  return prev.filter((m) => m.id !== id);
}

export function removeMatchingOptimistic<O extends ReconcileOptimistic>(
  prev: O[],
  incoming: ReconcileMessage,
  currentUserId: string | null,
): O[] {
  if (!currentUserId || incoming.senderId !== currentUserId) return prev;
  const idx = prev.findIndex(
    (m) =>
      m.status !== "failed" &&
      m.senderId === incoming.senderId &&
      m.message === incoming.message &&
      !!m.isInternal === !!incoming.isInternal,
  );
  if (idx === -1) return prev;
  const next = prev.slice();
  next.splice(idx, 1);
  return next;
}
