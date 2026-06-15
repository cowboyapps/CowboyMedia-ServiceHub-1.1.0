import { test } from "node:test";
import assert from "node:assert/strict";
import { serverActionErrorMessage } from "../client/src/components/billing-summary";

// apiRequest throws `Error("<status>: <body>")` on a non-2xx response. The admin
// suspend/unsuspend/terminate endpoint degrades to distinct tagged JSON shapes,
// each carrying a human-readable `message`. serverActionErrorMessage must pull
// that message back out so each degraded state surfaces as a distinct,
// operator-friendly toast — not a raw `409: {"ok":false,...}` string.

const FALLBACK = "Something went wrong reaching billing. Please try again shortly.";

function thrown(status: number, body: unknown): Error {
  return new Error(`${status}: ${JSON.stringify(body)}`);
}

test("404 unowned/unknown service surfaces the not-found message", () => {
  const err = thrown(404, { ok: false, message: "That service couldn't be found for this customer." });
  assert.equal(serverActionErrorMessage(err, FALLBACK), "That service couldn't be found for this customer.");
});

test("409 status-guard surfaces the guard message", () => {
  const err = thrown(409, { ok: false, message: "Only an active service can be suspended." });
  assert.equal(serverActionErrorMessage(err, FALLBACK), "Only an active service can be suspended.");
});

test("409 unlinked customer surfaces the unlinked message", () => {
  const err = thrown(409, { ok: false, message: "This customer isn't linked to billing yet." });
  assert.equal(serverActionErrorMessage(err, FALLBACK), "This customer isn't linked to billing yet.");
});

test("502 unreachable billing surfaces the unreachable message", () => {
  const err = thrown(502, {
    ok: false,
    message: "We couldn't reach the billing system right now. Please try again shortly.",
  });
  assert.equal(
    serverActionErrorMessage(err, FALLBACK),
    "We couldn't reach the billing system right now. Please try again shortly.",
  );
});

test("400 WHMCS error surfaces the underlying WHMCS message", () => {
  const err = thrown(400, { ok: false, message: "Service is already suspended in the module." });
  assert.equal(serverActionErrorMessage(err, FALLBACK), "Service is already suspended in the module.");
});

test("falls back when the body has no usable message", () => {
  assert.equal(serverActionErrorMessage(thrown(500, { ok: false }), FALLBACK), FALLBACK);
  assert.equal(serverActionErrorMessage(thrown(409, { ok: false, message: "   " }), FALLBACK), FALLBACK);
});

test("non-JSON statusText body falls through to the raw text", () => {
  assert.equal(serverActionErrorMessage(new Error("503: Service Unavailable"), FALLBACK), "Service Unavailable");
});

test("non-Error input returns the fallback", () => {
  assert.equal(serverActionErrorMessage("boom", FALLBACK), FALLBACK);
  assert.equal(serverActionErrorMessage(undefined, FALLBACK), FALLBACK);
});
