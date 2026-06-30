import { test } from "node:test";
import assert from "node:assert/strict";
import { isTimeoutError, paymentTimeoutMessage } from "../client/src/lib/server-error";
import { TimeoutError } from "../client/src/lib/queryClient";

// The default mutation timeout aborts a money-related, one-shot action (order,
// store-order, plan upgrade, cancellation) on the CLIENT, but the server may
// already have processed it. A plain "timed out, try again" could make the
// customer submit twice (double order / double charge), so the timeout branch
// must instead warn that the request MAY have gone through and to verify first.

test("isTimeoutError recognises apiRequest's TimeoutError", () => {
  assert.equal(isTimeoutError(new TimeoutError()), true);
});

test("isTimeoutError recognises any Error named TimeoutError", () => {
  const err = new Error("boom");
  err.name = "TimeoutError";
  assert.equal(isTimeoutError(err), true);
});

test("isTimeoutError is false for ordinary server errors", () => {
  assert.equal(isTimeoutError(new Error('409: {"ok":false,"message":"nope"}')), false);
  assert.equal(isTimeoutError(new Error("503: Service Unavailable")), false);
});

test("isTimeoutError is false for non-Error input", () => {
  assert.equal(isTimeoutError("TimeoutError"), false);
  assert.equal(isTimeoutError(undefined), false);
  assert.equal(isTimeoutError(null), false);
});

test("paymentTimeoutMessage warns the request may have gone through and not to retry blindly", () => {
  const msg = paymentTimeoutMessage("services and invoices");
  assert.match(msg, /may still have gone through/i);
  assert.match(msg, /services and invoices/);
  assert.match(msg, /before trying again/i);
  assert.match(msg, /twice/i);
});

test("paymentTimeoutMessage lets the cancel flow point at services only", () => {
  const msg = paymentTimeoutMessage("services");
  assert.match(msg, /check your services before trying again/i);
});

test("paymentTimeoutMessage defaults to checking services and invoices", () => {
  assert.match(paymentTimeoutMessage(), /services and invoices/);
});
