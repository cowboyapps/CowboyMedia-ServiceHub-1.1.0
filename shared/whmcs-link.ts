// Shared constants + pure logic for the customer self-service WHMCS account
// linking flow. Kept framework-free so route logic stays thin and the
// attempt-cap rules are unit-testable without booting the server or a DB.

export const WHMCS_LINK_CODE_TTL_MS = 10 * 60 * 1000;
export const WHMCS_LINK_MAX_ATTEMPTS = 5;

export type WhmcsLinkFailureOutcome = {
  status: "invalid_code" | "too_many_attempts";
  attemptsRemaining: number;
  // True when this wrong attempt exhausts the cap and the code must be
  // invalidated immediately (in the same request), so it can never be reused.
  consume: boolean;
};

// Given how many wrong attempts a verification row had BEFORE this submission,
// decide the outcome of the current wrong submission. The Nth wrong attempt
// (N === max) invalidates the code right away rather than on a later request.
export function whmcsLinkFailureOutcome(
  priorAttempts: number,
  max: number = WHMCS_LINK_MAX_ATTEMPTS,
): WhmcsLinkFailureOutcome {
  const used = priorAttempts + 1;
  const attemptsRemaining = Math.max(0, max - used);
  if (used >= max) {
    return { status: "too_many_attempts", attemptsRemaining: 0, consume: true };
  }
  return { status: "invalid_code", attemptsRemaining, consume: false };
}
