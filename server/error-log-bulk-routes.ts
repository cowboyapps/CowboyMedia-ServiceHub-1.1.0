import type { Request, Response } from "express";
import { queryString } from "./request-utils";
import { getErrorMessage } from "./error-utils";

// Filters shared by the error-log list screen and both bulk actions. The bulk
// routes parse the SAME query keys the list uses (severity/source/search, plus
// resolved for delete) so "Clear all" / "Resolve all" affect exactly what the
// admin is currently looking at — never more.
export type ErrorLogBulkFilters = {
  severity?: string;
  source?: string;
  search?: string;
  resolved?: boolean;
};

// Human-readable summary of the filter in effect when a bulk error-log action
// runs, for the activity-log entry. "all entries" when no filter is applied.
export function describeErrorLogFilters(filters: ErrorLogBulkFilters): string {
  const parts: string[] = [];
  if (filters.severity) parts.push(`severity: ${filters.severity}`);
  if (filters.source) parts.push(`source: ${filters.source}`);
  if (filters.search) parts.push(`search: "${filters.search}"`);
  if (filters.resolved !== undefined) parts.push(filters.resolved ? "resolved only" : "unresolved only");
  return parts.length > 0 ? `filter — ${parts.join(", ")}` : "all entries";
}

type BulkRouteStorage = {
  deleteAllErrorLogs(filters?: ErrorLogBulkFilters): Promise<number>;
  resolveAllErrorLogs(by: string | null, filters?: { severity?: string; source?: string; search?: string }): Promise<number>;
  getUser(id: string): Promise<{ fullName: string } | undefined>;
};

type LogActivityFn = (
  category: string,
  action: string,
  opts: { actorId?: string; summary: string; details?: string },
) => void;

export type ErrorLogBulkHandlerOptions = {
  storage: BulkRouteStorage;
  logActivity: LogActivityFn;
};

// DELETE /api/admin/error-logs — bulk-delete error log entries. Destructive
// and irreversible, so routes.ts gates it on master_admin rather than the
// plain error_log.view permission used by the read/resolve routes. Honors the
// same filters as the list screen (severity/source/resolved/search); with no
// filter it clears everything. Safe when already empty ({ deleted: 0 }).
export function createErrorLogClearAllHandler(opts: ErrorLogBulkHandlerOptions) {
  const { storage, logActivity } = opts;
  return async (req: Request, res: Response) => {
    try {
      const { severity, source, search, resolved } = req.query;
      const resolvedParsed = resolved === "true" ? true : resolved === "false" ? false : undefined;
      const filters: ErrorLogBulkFilters = {
        severity: queryString(severity),
        source: queryString(source),
        search: queryString(search),
        resolved: resolvedParsed,
      };
      const deleted = await storage.deleteAllErrorLogs(filters);
      const userId = (req as any).session?.userId || null;
      const actor = userId ? await storage.getUser(userId) : null;
      const actorName = actor?.fullName || "Unknown admin";
      const filterDesc = describeErrorLogFilters(filters);
      logActivity("error_log", "error_logs_cleared", {
        actorId: userId || undefined,
        summary: `${actorName} cleared ${deleted} error log ${deleted === 1 ? "entry" : "entries"} (${filterDesc})`,
        details: JSON.stringify({ actor: actorName, deleted, filters }),
      });
      res.json({ deleted });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}

// POST /api/admin/error-logs/resolve-all — bulk-resolve unresolved entries.
// Non-destructive (keeps the audit trail, just stamps resolvedAt/resolvedBy),
// so routes.ts gates it on the plain error_log.view permission like the
// single-entry resolve route. Honors severity/source/search but deliberately
// NOT `resolved` — the storage layer only ever touches currently-unresolved
// rows, so a resolved=true query param must not be forwarded as a filter.
export function createErrorLogResolveAllHandler(opts: ErrorLogBulkHandlerOptions) {
  const { storage, logActivity } = opts;
  return async (req: Request, res: Response) => {
    try {
      const { severity, source, search } = req.query;
      const userId = (req as any).session?.userId || null;
      const filters = {
        severity: queryString(severity),
        source: queryString(source),
        search: queryString(search),
      };
      const resolved = await storage.resolveAllErrorLogs(userId, filters);
      const actor = userId ? await storage.getUser(userId) : null;
      const actorName = actor?.fullName || "Unknown admin";
      const filterDesc = describeErrorLogFilters(filters);
      logActivity("error_log", "error_logs_resolved_all", {
        actorId: userId || undefined,
        summary: `${actorName} resolved ${resolved} error log ${resolved === 1 ? "entry" : "entries"} (${filterDesc})`,
        details: JSON.stringify({ actor: actorName, resolved, filters }),
      });
      res.json({ resolved });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
