// MUST be imported FIRST in server/index.ts (before any other module that
// might throw or open handles). Sentry's auto-instrumentation only patches
// libraries it sees being required AFTER Sentry.init() has run.
//
// In dev (no SENTRY_DSN), Sentry.init() is a no-op — the SDK silently does
// nothing, so we can leave this import in unconditionally without a
// performance cost or noisy local logs.
import * as Sentry from "@sentry/node";
import { APP_VERSION } from "@shared/version";

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn: dsn || undefined,
  environment: process.env.NODE_ENV ?? "development",
  release: APP_VERSION,
  // Capture unhandled promise rejections + uncaughtExceptions automatically
  // (these are on by default; we leave the defaults in place).
  // Tracing: keep at 0 — we're using Sentry purely for error reporting,
  // not APM. Tracing pulls in extra deps and bandwidth.
  tracesSampleRate: 0,
  // Don't ship Sentry's own console breadcrumbs at trace-level — too noisy
  // for our log volume.
  beforeBreadcrumb(breadcrumb) {
    if (breadcrumb.category === "console" && breadcrumb.level === "log") return null;
    return breadcrumb;
  },
});

if (!dsn) {
  // Single line at boot so it's clear in dev that errors are NOT being
  // shipped anywhere. Production with a real DSN stays silent.
  console.log("[sentry] SENTRY_DSN not set — error capture disabled (no-op SDK)");
}

export { Sentry };
