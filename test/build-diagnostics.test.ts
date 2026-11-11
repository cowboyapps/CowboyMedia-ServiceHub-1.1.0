import { test } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import fs, { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { runInNewContext } from "node:vm";
import {
  BUILD_ERROR_MARKER, formatBuildError, extractFailureDiagnostics,
  formatFailureNotice, redactDiagnostics,
} from "../deploy/webhook-listener/build-diagnostics.mjs";

const watchFiles = Array.from({ length: 5000 }, (_, i) => `/opt/servicehub/client/module-${i}.tsx`);
const trailingOutput = Array.from({ length: 100 }, (_, i) => `cleanup step ${i} finished`).join("\n");

function marked(error: unknown) {
  return formatBuildError(error).split("\n").map((line) => BUILD_ERROR_MARKER + line).join("\n");
}

test("build summary keeps the actual Rollup cause and context, not thousands of watch files or arbitrary properties", () => {
  const error = Object.assign(new Error('Could not resolve "./missing" from "client/src/App.tsx"'), {
    code: "UNRESOLVED_IMPORT", plugin: "vite:import-analysis", id: "client/src/App.tsx",
    loc: { file: "client/src/App.tsx", line: 12, column: 3 },
    frame: '12 | import missing from "./missing";\n   | ^',
    watchFiles, env: { PRIVATE_VALUE: "must-not-appear" }, token: "must-not-appear-either",
  });
  const summary = formatBuildError(error);
  assert.match(summary, /Could not resolve/);
  assert.match(summary, /UNRESOLVED_IMPORT/);
  assert.match(summary, /vite:import-analysis/);
  assert.match(summary, /App\.tsx:12:3/);
  assert.match(summary, /12 \| import missing/);
  assert.match(summary, /at /);
  assert.doesNotMatch(summary, /watchFiles|module-4999|must-not-appear|PRIVATE_VALUE/);
  assert.ok(summary.length <= 3000);
  const log = `${inspect(error, { maxArrayLength: null })}\n${marked(error)}\n${trailingOutput}`;
  const details = extractFailureDiagnostics(log);
  assert.match(details, /Could not resolve/);
  assert.match(details, /App\.tsx:12:3/);
  assert.doesNotMatch(details, /module-\d|cleanup step/);
  assert.ok(details.length <= 1200);
});

test("legacy Rollup object dumps retain the cause even with inventories and unrelated trailing output", () => {
  const error = Object.assign(new Error("Missing export customerPrice in pricing.ts"), { watchFiles });
  const log = `building client...\n${inspect(error, { maxArrayLength: null })}\n${trailingOutput}`;
  assert.ok(log.length > 200_000);
  const details = extractFailureDiagnostics(log);
  assert.match(details, /Missing export customerPrice in pricing\.ts/);
  assert.doesNotMatch(details, /watchFiles|module-\d|cleanup step/);
});

test("prebuild failures, ANSI output, and no recognized error have useful bounded fallbacks", () => {
  assert.match(extractFailureDiagnostics(`checking types\nsrc/app.ts(2,4): error TS2307: Cannot find module 'missing'\n${trailingOutput}`), /TS2307: Cannot find module/);
  assert.match(extractFailureDiagnostics(`\x1b[31mnpm error code EACCES\x1b[0m\n${trailingOutput}`), /EACCES/);
  assert.match(extractFailureDiagnostics("fatal: Could not resolve host: github.com\n" + trailingOutput), /Could not resolve host/);
  assert.equal(extractFailureDiagnostics("normal output\nlast operation"), "normal output\nlast operation");
  assert.match(extractFailureDiagnostics(""), /protected deployment log/);
});

test("cause chains, esbuild details, strings and circular errors are bounded", () => {
  const error = Object.assign(new Error("Build failed"), {
    errors: [{ text: "No matching export", location: { file: "src/main.ts", line: 5, column: 1, lineText: 'import { missing } from "./module";' } }],
    cause: new Error("Underlying parser failure"),
  });
  (error.cause as Error & { cause: unknown }).cause = error;
  const summary = formatBuildError(error);
  assert.match(summary, /Cause: Underlying parser failure/);
  assert.match(summary, /Cause: No matching export/);
  assert.match(summary, /src\/main.ts:5:1/);
  assert.equal(formatBuildError("string rejection"), "Error: string rejection");
  assert.match(formatBuildError(undefined), /no error details/);
  assert.ok(formatBuildError(new Error("x".repeat(10_000))).length <= 3000);
});

test("redaction removes credentials without reading or serializing the environment", () => {
  const secrets = [
    "fake-db-pass", "fake-bearer-token", "fake-basic-token", "fake-json-secret with spaces",
    "fake-api-key", "fake-env-content", "fake-query-token", "fake-hook-token",
    "ghp_fakegithubtoken", "fake-private-key",
  ];
  const input = `Error: request failed
https://dbuser:${secrets[0]}@example.com/db
postgresql://dbuser:${secrets[0]}@example.com/db
Authorization: Bearer ${secrets[1]}
Basic ${secrets[2]}
{"password": "${secrets[3]}", "apiKey": "${secrets[4]}"}
INNOCENT_SETTING=${secrets[5]}
https://example.com?token=${secrets[6]}&ok=1
https://discord.com/api/webhooks/123/${secrets[7]}
${secrets[8]}
-----BEGIN PRIVATE KEY-----
${secrets[9]}
-----END PRIVATE KEY-----
\`\`\` @everyone`;
  const redacted = redactDiagnostics(input);
  for (const secret of secrets) assert.ok(!redacted.includes(secret), secret);
  assert.equal(redactDiagnostics(redacted), redacted);
  assert.match(redacted, /Error: request failed/);
  assert.doesNotMatch(redacted, /```/);
  const log = marked(new Error(input));
  const notice = formatFailureNotice({
    sha: "1234567", code: 1, duration: "15s", verification: input,
    hint: input, logText: log, logId: "delivery-id",
  });
  for (const secret of secrets) assert.ok(!notice.includes(secret), secret);
  assert.ok(notice.length <= 2000);
});

test("final Discord notice reserves space for the cause, verification, hint and protected log", () => {
  const notice = formatFailureNotice({
    sha: "abcdef0", code: 1, duration: "2m5s", verification: "Rolled back to 1234567 " + "v".repeat(4000),
    hint: "Check the build configuration " + "h".repeat(4000),
    logId: "test-delivery",
    logText: marked(new Error("Missing export actualCause " + "x".repeat(10_000))) + "\n" + trailingOutput,
  });
  assert.match(notice, /Missing export actualCause/);
  assert.match(notice, /Rolled back to 1234567/);
  assert.match(notice, /Check the build configuration/);
  assert.match(notice, /requires deploy authorization/);
  assert.match(notice, /\/_deploy\/log\/test-delivery/);
  assert.ok(notice.length <= 2000);
  assert.equal((notice.match(/```/g) || []).length, 2);
});

test("production paths use the shared formatter and leave full log access authenticated", () => {
  const build = readFileSync(new URL("../script/build.ts", import.meta.url), "utf8");
  const listener = readFileSync(new URL("../deploy/webhook-listener/server.mjs", import.meta.url), "utf8");
  assert.match(build, /formatBuildError\(err\)/);
  assert.doesNotMatch(build, /console\.error\(err\)/);
  assert.match(listener, /formatFailureNotice\(\{/);
  assert.match(listener, /allowed_mentions: \{ parse: \[\] \}/);
  assert.match(listener, /content: redactDiagnostics\(content\)\.slice\(0, 2000\)/);
  assert.match(listener, /child\.stdout\.pipe\(out, \{ end: false \}\)/);
  assert.match(listener, /child\.stderr\.pipe\(out, \{ end: false \}\)/);
  assert.match(listener, /out\.end\(\(\) => \{\s*resolve\(/);
  const logRoute = listener.slice(listener.indexOf('if (req.method === "GET" && req.url?.startsWith("/log/"))'));
  assert.ok(logRoute.indexOf('res.writeHead(401)') < logRoute.indexOf("fs.createReadStream(p).pipe(res)"));
  assert.match(logRoute, /if \(!expected \|\| auth !== `Bearer \$\{expected\}`\)/);
});

test("deploy capture waits for both streams and disk flush before reading the final error", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "build-diagnostics-"));
  try {
    const source = readFileSync(new URL("../deploy/webhook-listener/server.mjs", import.meta.url), "utf8");
    // Exercise the real capture function without starting the listener or a deploy.
    const capture = source.slice(source.indexOf("function runDeploy("), source.indexOf("\nfunction fmtDuration("));
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(),
    });
    const runDeploy = runInNewContext(`(${capture})`, {
      fs, path, LOG_DIR: directory, UPDATE_SCRIPT: "/not-executed",
      spawn: () => child,
    }) as (ref: string, id: string) => Promise<{ logPath: string }>;
    const pending = runDeploy("abcdef0", "test-delivery");
    child.stdout.end("building client...\n");
    // stdout can end while stderr still has the final failure to deliver.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const details = marked(new Error("Actual final build failure"));
    child.stderr.end(details + "\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    child.emit("close", 1);
    const { logPath } = await pending;
    const log = readFileSync(logPath, "utf8");
    assert.equal(log, "building client...\n" + details + "\n");
    assert.match(extractFailureDiagnostics(log), /Actual final build failure/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
