import { useRef, useCallback } from "react";

// Generates a unique idempotency key for one submission attempt of a money
// action (order, store order, plan change, cancellation). The key is reused
// across retries of the SAME attempt — so a request that times out and is
// retried carries the same key and is deduped server-side, never creating a
// duplicate order/invoice/cancellation — and rotated once the attempt finishes
// (success, or a non-timeout failure that means the user is starting over).
function generateKey(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to the manual fallback
  }
  return `idem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

export interface IdempotencyKeyHandle {
  /** The current attempt's key, creating one on first use. Stable across retries. */
  getKey: () => string;
  /** Drop the current key so the next submission starts a fresh attempt. */
  reset: () => void;
}

export function useIdempotencyKey(): IdempotencyKeyHandle {
  const ref = useRef<string | null>(null);
  const getKey = useCallback(() => {
    if (!ref.current) ref.current = generateKey();
    return ref.current;
  }, []);
  const reset = useCallback(() => {
    ref.current = null;
  }, []);
  return { getKey, reset };
}
