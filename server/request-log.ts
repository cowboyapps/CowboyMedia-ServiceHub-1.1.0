// API request log-line builder + the sensitive-body path allowlist, extracted
// from the request-logging middleware in server/index.ts so both can be unit-
// tested without booting the server (index.ts has heavy import-time side effects
// — it builds the express app, runs migrations and starts notifiers).
//
// The core guarantee under test: routes whose JSON body carries sensitive
// customer data (e.g. WHMCS service login passwords from "My Services") must
// NEVER have their body embedded in the request log, even truncated — while
// every OTHER /api route still gets its (capped) body logged for debugging.

// Routes whose JSON body must never be embedded in the request log. Match is
// exact OR a sub-path (so `/api/my/services/123` is covered too).
export const SENSITIVE_BODY_PATHS = ["/api/my/services"];

export function isSensitiveBodyPath(path: string): boolean {
  return SENSITIVE_BODY_PATHS.some((p) => path === p || path.startsWith(p + "/"));
}

export interface ApiLogLineArgs {
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  /** The captured JSON response body, if any. */
  body?: unknown;
}

/**
 * Build the single `[express]` request-log line for an /api request. Appends a
 * capped `:: <body>` segment EXCEPT when the path is sensitive (then the body is
 * dropped entirely) or there is no body.
 *
 * The 200-char cap exists because PM2's log file splits any single console.log
 * longer than ~1KB across multiple physical lines, and only the first chunk
 * carries the `[express]` prefix. The deploy log-tail error gate filters on
 * `[express]` to skip request logs — continuation chunks slip through, and
 * routes that return large JSON arrays containing strings like
 * `column "x" does not exist` end up tripping the gate on healthy deploys.
 * 200 chars is plenty for at-a-glance debugging and keeps the whole line well
 * under pm2's split threshold.
 */
export function buildApiLogLine(args: ApiLogLineArgs): string {
  const { method, path, statusCode, durationMs, body } = args;
  let logLine = `${method} ${path} ${statusCode} in ${durationMs}ms`;
  if (body && !isSensitiveBodyPath(path)) {
    const serialized = JSON.stringify(body);
    logLine += ` :: ${serialized.length > 200 ? serialized.slice(0, 200) + "…" : serialized}`;
  }
  return logLine;
}
