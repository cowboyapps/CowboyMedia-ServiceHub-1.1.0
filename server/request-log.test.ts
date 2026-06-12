import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SENSITIVE_BODY_PATHS,
  isSensitiveBodyPath,
  buildApiLogLine,
} from "./request-log";

// Tests for the request-logging guarantee extracted from server/index.ts: the
// /api/my/services response body (which carries WHMCS service login passwords)
// must NEVER be embedded in the request log, while every OTHER /api route still
// gets its (capped) body logged.

// ---------- isSensitiveBodyPath ----------

test("isSensitiveBodyPath: /api/my/services and its sub-paths are sensitive", () => {
  assert.ok(SENSITIVE_BODY_PATHS.includes("/api/my/services"));
  assert.equal(isSensitiveBodyPath("/api/my/services"), true);
  assert.equal(isSensitiveBodyPath("/api/my/services/123"), true);
});

test("isSensitiveBodyPath: unrelated paths are NOT sensitive (no over-matching)", () => {
  assert.equal(isSensitiveBodyPath("/api/my/services-summary"), false);
  assert.equal(isSensitiveBodyPath("/api/my"), false);
  assert.equal(isSensitiveBodyPath("/api/admin/users/5/whmcs/billing"), false);
  assert.equal(isSensitiveBodyPath("/api/tickets"), false);
});

// ---------- buildApiLogLine: sensitive path ----------

test("buildApiLogLine: NEVER embeds the /api/my/services body (password stays out of logs)", () => {
  const line = buildApiLogLine({
    method: "GET",
    path: "/api/my/services",
    statusCode: 200,
    durationMs: 12,
    body: {
      services: [{ id: 1, name: "VPS", username: "ada", password: "s3cr3t-do-not-log" }],
    },
  });
  assert.equal(line, "GET /api/my/services 200 in 12ms");
  assert.ok(!line.includes("s3cr3t-do-not-log"), "password must not appear in the log line");
  assert.ok(!line.includes("password"), "no body keys at all for the sensitive path");
  assert.ok(!line.includes("::"), "no body segment for the sensitive path");
});

test("buildApiLogLine: a sub-path of the sensitive route is also dropped", () => {
  const line = buildApiLogLine({
    method: "GET",
    path: "/api/my/services/9",
    statusCode: 200,
    durationMs: 3,
    body: { password: "leak-me" },
  });
  assert.ok(!line.includes("leak-me"));
  assert.ok(!line.includes("::"));
});

// ---------- buildApiLogLine: ordinary paths still log the body ----------

test("buildApiLogLine: a non-sensitive /api route DOES embed its (capped) body", () => {
  const line = buildApiLogLine({
    method: "GET",
    path: "/api/tickets",
    statusCode: 200,
    durationMs: 7,
    body: { count: 3, items: ["a", "b", "c"] },
  });
  assert.match(line, /^GET \/api\/tickets 200 in 7ms :: /);
  assert.ok(line.includes('"count":3'));
});

test("buildApiLogLine: oversized non-sensitive bodies are truncated to 200 chars + ellipsis", () => {
  const big = { blob: "x".repeat(5000) };
  const line = buildApiLogLine({
    method: "POST",
    path: "/api/admin/health/errors",
    statusCode: 200,
    durationMs: 1,
    body: big,
  });
  const bodyPart = line.split(" :: ")[1];
  assert.ok(bodyPart.endsWith("…"), "truncated bodies end with an ellipsis");
  // 200 chars of body + the ellipsis character.
  assert.equal(bodyPart.length, 201);
});

test("buildApiLogLine: no body -> bare line, no trailing separator", () => {
  const line = buildApiLogLine({ method: "DELETE", path: "/api/tickets/1", statusCode: 204, durationMs: 2 });
  assert.equal(line, "DELETE /api/tickets/1 204 in 2ms");
});
