// Shared by the build command and the dependency-free deploy listener.
// Never inspect arbitrary error properties (Rollup includes thousands of watchFiles).
export const BUILD_ERROR_MARKER = "[build:error] ";

export function redactDiagnostics(text) {
  return String(text)
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-]*PRIVATE KEY-----|$)/g, "[REDACTED PRIVATE KEY]")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/(\/api(?:\/v\d+)?\/webhooks\/\d+\/)[^\s/?'"`]+/gi, "$1[REDACTED]")
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED AUTH]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, "[REDACTED TOKEN]")
    // Redact credential assignments, JSON fields, query parameters and env lines.
    // Match the entire quoted value, including spaces, before unquoted values.
    .replace(/(["']?\b[\w.-]*(?:password|passwd|secret|token|api[_-]?key|authorization|cookie|credential|database[_-]?url|webhook[_-]?url)[\w.-]*["']?\s*[:=]\s*)(?:\[REDACTED\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/gi, "$1[REDACTED]")
    .replace(/((?:\b[A-Z][A-Z0-9_]{2,}\s*=\s*|["'][A-Z][A-Z0-9_]{2,}["']\s*:\s*))(?:\[REDACTED\]|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;&}\]]+)/g, "$1[REDACTED]")
    .replace(/`/g, "'"); // Log text must not close Discord's code fence.
}

function bounded(text, max) {
  if (text.length <= max) return text;
  const suffix = "\n… [truncated]";
  return max <= suffix.length ? text.slice(0, max) : text.slice(0, max - suffix.length) + suffix;
}

export function formatBuildError(error) {
  const lines = [];
  const seen = new Set();
  function add(label, value) {
    if (typeof value === "string" || typeof value === "number") {
      lines.push(`${label}${bounded(redactDiagnostics(value), 800)}`);
    }
  }
  function visit(err, depth = 0) {
    if (err == null || depth > 2 || seen.has(err)) return;
    if (typeof err !== "object") {
      add(depth ? "Cause: " : "Error: ", String(err));
      return;
    }
    seen.add(err);
    add(depth ? "Cause: " : "Error: ", err.message || err.text || "Build failed");
    for (const key of ["code", "plugin", "id"]) add(`${key}: `, err[key]);
    const loc = err.loc || err.location;
    if (loc && typeof loc === "object") {
      add("Location: ", `${typeof loc.file === "string" ? loc.file : ""}:${loc.line ?? "?"}:${loc.column ?? "?"}`);
      add("", loc.lineText);
    }
    add("", err.frame);
    if (err.cause) visit(err.cause, depth + 1);
    if (Array.isArray(err.errors)) {
      for (const child of err.errors.slice(0, 3)) visit(child, depth + 1);
    }
    if (typeof err.stack === "string") {
      // Only stack frames: the message was already included above.
      add("", err.stack.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 5).join("\n"));
    }
  }
  visit(error);
  return bounded(lines.filter(Boolean).join("\n") || "Error: Build failed (no error details)", 3000);
}

export function extractFailureDiagnostics(logText) {
  const lines = redactDiagnostics(logText).split(/\r?\n/);
  const marked = lines.filter((line) => line.startsWith(BUILD_ERROR_MARKER));
  if (marked.length) {
    return bounded(marked.map((line) => line.slice(BUILD_ERROR_MARKER.length)).join("\n"), 1200);
  }

  // Older builds and prebuild/npm/git failures have no marker. Prefer an
  // actual error over unrelated cleanup/rollback output at the end of the log.
  const start = lines.findIndex((line) =>
    /(?:\b(?:RollupError|SyntaxError|TypeError|ReferenceError|Error):|\[ERROR\]|error TS\d+|npm (?:ERR!|error)|fatal:|error during build:)/i.test(line),
  );
  const selected = start >= 0 ? lines.slice(start, start + 16) : lines.filter((line) => line.trim()).slice(-12);
  const inventory = selected.findIndex((line) => /^\s*watchFiles\s*:/.test(line));
  return bounded((inventory >= 0 ? selected.slice(0, inventory) : selected).join("\n")
    || "No error summary found. Inspect the protected deployment log.", 1200);
}

export function formatFailureNotice({ sha, code, duration, verification, hint, logText, logId }) {
  // Redact BEFORE bounding: truncating a credential first can bypass redaction.
  const clean = (value, max) => bounded(redactDiagnostics(value), max);
  const header = `:x: Deploy '${clean(sha, 7)}' FAILED (exit ${clean(code, 8)}) after ${clean(duration, 20)}.`;
  const context = `\nVerification: ${clean(verification, 180)}\nFailure details:\n\`\`\`\n${extractFailureDiagnostics(logText)}\n\`\`\``;
  const footer = `\nFull log (requires deploy authorization): /_deploy/log/${clean(logId, 80)}`
    + (hint ? `\n:wrench: ${clean(hint, 250)}` : "");
  return bounded(header + context + footer, 2000);
}
