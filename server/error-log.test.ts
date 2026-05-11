import { test } from "node:test";
import assert from "node:assert/strict";
import { buildErrorLogInsert } from "./error-log";

test("buildErrorLogInsert: defaults severity to 'error'", () => {
  const r = buildErrorLogInsert("push", new Error("boom"));
  assert.equal(r.severity, "error");
  assert.equal(r.source, "push");
  assert.equal(r.summary, "boom");
  assert.equal(r.userId, null);
});

test("buildErrorLogInsert: respects severity override and context", () => {
  const r = buildErrorLogInsert("email", new Error("smtp failed"), {
    severity: "warn",
    userId: "u-1",
    referenceType: "ticket",
    referenceId: "t-1",
    summary: "Custom summary",
    extra: { to: "x@example.com" },
  });
  assert.equal(r.severity, "warn");
  assert.equal(r.source, "email");
  assert.equal(r.summary, "Custom summary");
  assert.equal(r.userId, "u-1");
  assert.equal(r.referenceType, "ticket");
  assert.equal(r.referenceId, "t-1");
  assert.ok(r.details && r.details.includes("smtp failed"));
  assert.ok(r.details && r.details.includes("x@example.com"));
});

test("buildErrorLogInsert: handles non-Error values", () => {
  const r = buildErrorLogInsert("telegram", "string error");
  assert.equal(r.summary, "string error");
  const r2 = buildErrorLogInsert("discord", { message: "obj msg" });
  assert.equal(r2.summary, "obj msg");
  const r3 = buildErrorLogInsert("route", null);
  assert.equal(r3.summary, "Unknown error");
});

test("buildErrorLogInsert: clamps oversized summary to 500 chars", () => {
  const r = buildErrorLogInsert("job", new Error("x".repeat(2000)));
  assert.equal(r.summary.length, 500);
});

test("buildErrorLogInsert: serialises stack into details", () => {
  const err = new Error("oops");
  const r = buildErrorLogInsert("push", err);
  assert.ok(r.details);
  const parsed = JSON.parse(r.details!);
  assert.equal(parsed.message, "oops");
  assert.equal(typeof parsed.stack, "string");
});
