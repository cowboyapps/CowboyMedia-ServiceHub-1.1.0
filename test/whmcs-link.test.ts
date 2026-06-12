import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_EMAIL_TEMPLATES } from "../server/email";
import { insertWhmcsLinkVerificationSchema } from "../shared/schema";
import { whmcsLinkFailureOutcome, WHMCS_LINK_MAX_ATTEMPTS } from "../shared/whmcs-link";

test("whmcs link attempt cap: wrong guesses 1-4 stay retryable with a decreasing remaining count", () => {
  for (let prior = 0; prior < WHMCS_LINK_MAX_ATTEMPTS - 1; prior++) {
    const outcome = whmcsLinkFailureOutcome(prior);
    assert.equal(outcome.status, "invalid_code");
    assert.equal(outcome.consume, false);
    assert.equal(outcome.attemptsRemaining, WHMCS_LINK_MAX_ATTEMPTS - (prior + 1));
  }
});

test("whmcs link attempt cap: the 5th wrong guess invalidates the code in the same request", () => {
  // prior = 4 means this is the 5th submission.
  const outcome = whmcsLinkFailureOutcome(WHMCS_LINK_MAX_ATTEMPTS - 1);
  assert.equal(outcome.status, "too_many_attempts");
  assert.equal(outcome.consume, true);
  assert.equal(outcome.attemptsRemaining, 0);
});

test("whmcs link attempt cap: any attempt at/over the cap stays consumed", () => {
  const outcome = whmcsLinkFailureOutcome(WHMCS_LINK_MAX_ATTEMPTS);
  assert.equal(outcome.status, "too_many_attempts");
  assert.equal(outcome.consume, true);
});

test("whmcs_link_verification email template is seeded with code + name variables", () => {
  const tpl = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateKey === "whmcs_link_verification");
  assert.ok(tpl, "template must exist in DEFAULT_EMAIL_TEMPLATES");
  assert.ok(tpl!.body.includes("{code}"), "body must interpolate {code}");
  assert.ok(tpl!.body.includes("{name}"), "body must interpolate {name}");
  assert.deepEqual([...tpl!.availableVariables].sort(), ["code", "name"]);
  // The OTP must NOT live in the subject — subjects are written to server logs
  // (server/email.ts), so a {code} there would leak the one-time code in plaintext.
  assert.ok(!tpl!.subject.includes("{code}"), "subject must NOT contain the code (log leakage)");
});

test("insertWhmcsLinkVerificationSchema accepts a well-formed verification row", () => {
  const parsed = insertWhmcsLinkVerificationSchema.safeParse({
    userId: "user-1",
    email: "a@b.com",
    codeHash: "deadbeef",
    whmcsClientId: 42,
    attempts: 0,
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.ok(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues));
});

test("insertWhmcsLinkVerificationSchema rejects a row missing required fields", () => {
  const parsed = insertWhmcsLinkVerificationSchema.safeParse({
    email: "a@b.com",
  });
  assert.equal(parsed.success, false);
});
