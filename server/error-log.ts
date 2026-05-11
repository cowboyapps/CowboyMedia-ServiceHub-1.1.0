import { storage } from "./storage";
import type { ErrorLogSeverity, ErrorLogSource, InsertErrorLog } from "@shared/schema";

export interface LogErrorContext {
  severity?: ErrorLogSeverity;
  userId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  summary?: string;
  extra?: Record<string, unknown>;
}

function safeMessage(err: unknown): string {
  if (err == null) return "Unknown error";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message || err.name || "Error";
  if (typeof err === "object" && err !== null && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  try { return JSON.stringify(err); } catch { return String(err); }
}

function safeDetails(err: unknown, extra?: Record<string, unknown>): string | null {
  const parts: Record<string, unknown> = {};
  if (err instanceof Error) {
    parts.name = err.name;
    parts.message = err.message;
    if (err.stack) parts.stack = err.stack;
    if ((err as any).code) parts.code = (err as any).code;
    if ((err as any).statusCode) parts.statusCode = (err as any).statusCode;
  } else if (err != null) {
    parts.error = err;
  }
  if (extra) Object.assign(parts, extra);
  if (Object.keys(parts).length === 0) return null;
  try { return JSON.stringify(parts, null, 2).slice(0, 8000); }
  catch { return String(err).slice(0, 8000); }
}

export function buildErrorLogInsert(
  source: ErrorLogSource,
  err: unknown,
  context?: LogErrorContext,
): InsertErrorLog {
  const severity: ErrorLogSeverity = context?.severity ?? "error";
  const summary = (context?.summary ?? safeMessage(err)).slice(0, 500);
  return {
    severity,
    source,
    summary,
    details: safeDetails(err, context?.extra),
    userId: context?.userId ?? null,
    referenceType: context?.referenceType ?? null,
    referenceId: context?.referenceId ?? null,
  };
}

export function logError(
  source: ErrorLogSource,
  err: unknown,
  context?: LogErrorContext,
): void {
  const insert = buildErrorLogInsert(source, err, context);
  console.error(`[ErrorLog:${source}]`, insert.summary);
  storage.createErrorLog(insert).catch((e) => {
    console.error("[ErrorLog] Failed to persist:", e?.message || e);
  });
}
