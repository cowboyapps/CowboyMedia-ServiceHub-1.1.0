// Monitor-driven alert-draft suggestions: the down/up hooks called from the
// monitoring loop plus the two admin routes for listing/acting on drafts.
// Hard rule: NOTHING here posts an alert, sends customer notifications, or
// calls the alert fan-out. Drafts are suggestions only — an admin publishes
// through the existing alert routes, which own all side effects.

import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { format } from "date-fns";
import type { AlertDraft, InsertAlertDraft, UrlMonitor } from "@shared/schema";
import {
  decideOutageDraft,
  decideOutageSupersedesRecovery,
  decideRecoveryDraft,
  formatDowntime,
} from "@shared/alert-draft-decision";
import { getParam } from "./http-params";
import { getErrorMessage } from "./error-utils";

// Minimal storage surface so the hooks are testable without the real DB.
export interface AlertDraftStorage {
  getAlertDraftsForMonitor(monitorId: string): Promise<AlertDraft[]>;
  createAlertDraft(data: InsertAlertDraft): Promise<AlertDraft>;
  updateAlertDraft(id: string, data: Partial<AlertDraft>): Promise<AlertDraft | undefined>;
  serviceHasActiveAlert(serviceId: string): Promise<boolean>;
  getActiveAlertIdForService(serviceId: string): Promise<string | null>;
  isAlertActive(alertId: string): Promise<boolean>;
  getService(id: string): Promise<{ id: string; name: string } | undefined>;
}

export interface AlertDraftHookDeps {
  storage: AlertDraftStorage;
  // Push a "draft ready for review" notification to admins. Must never touch
  // customer channels. Optional so tests can omit it.
  notifyAdminsDraftReady?: (draft: AlertDraft, monitor: { id: string; name: string }) => void | Promise<void>;
}

/**
 * Down transition (threshold crossed). Applies flap suppression: one draft per
 * outage episode. Returns the created draft or null when suppressed.
 */
export async function onMonitorDownCreateDraft(
  monitor: Pick<UrlMonitor, "id" | "name" | "serviceId">,
  incident: { id: string; failureReason?: string | null },
  now: Date,
  deps: AlertDraftHookDeps,
): Promise<AlertDraft | null> {
  const { storage } = deps;
  const drafts = await storage.getAlertDraftsForMonitor(monitor.id);

  // A fresh outage makes any pending recovery suggestion stale.
  for (const id of decideOutageSupersedesRecovery(drafts)) {
    await storage.updateAlertDraft(id, { status: "superseded", actedAt: now });
  }

  const serviceHasActiveAlert = monitor.serviceId
    ? await storage.serviceHasActiveAlert(monitor.serviceId)
    : false;

  const decision = decideOutageDraft({ now, monitorDrafts: drafts, serviceHasActiveAlert });

  if (decision.action === "attach") {
    await storage.updateAlertDraft(decision.draftId, { monitorIncidentId: incident.id });
    return null;
  }
  if (decision.action === "skip") return null;

  const service = monitor.serviceId ? await storage.getService(monitor.serviceId) : undefined;
  const subjectName = service?.name || monitor.name;
  const detectedAt = format(now, "MMM d, yyyy h:mm a");
  const reason = incident.failureReason ? ` (${incident.failureReason})` : "";

  const draft = await storage.createAlertDraft({
    monitorId: monitor.id,
    monitorIncidentId: incident.id,
    serviceId: monitor.serviceId || null,
    kind: "outage",
    suggestedTitle: `${subjectName} is experiencing an outage`,
    suggestedDescription: `Our monitoring detected a problem with ${subjectName} at ${detectedAt}${reason}. We are investigating.`,
    suggestedSeverity: "critical",
    suggestedServiceImpact: "outage",
    relatedAlertId: null,
    status: "pending",
  });
  if (deps.notifyAdminsDraftReady) await deps.notifyAdminsDraftReady(draft, monitor);
  return draft;
}

/**
 * Up transition. Supersedes never-published outage drafts; when a published
 * outage draft's alert (or another active alert on the service) is still open,
 * suggests a recovery/resolve draft instead.
 */
export async function onMonitorUpCreateRecoveryDraft(
  monitor: Pick<UrlMonitor, "id" | "name" | "serviceId">,
  downtimeSeconds: number,
  now: Date,
  deps: AlertDraftHookDeps,
): Promise<AlertDraft | null> {
  const { storage } = deps;
  const drafts = await storage.getAlertDraftsForMonitor(monitor.id);

  // Resolve which active alert (if any) this recovery relates to: prefer the
  // alert a published outage draft points at (if still active), else any
  // active alert covering the linked service.
  let activeRelatedAlertId: string | null = null;
  const published = drafts.find(d => d.kind === "outage" && d.status === "published" && d.relatedAlertId);
  if (published?.relatedAlertId && (await storage.isAlertActive(published.relatedAlertId))) {
    activeRelatedAlertId = published.relatedAlertId;
  } else if (monitor.serviceId) {
    activeRelatedAlertId = await storage.getActiveAlertIdForService(monitor.serviceId);
  }

  const decision = decideRecoveryDraft({ monitorDrafts: drafts, activeRelatedAlertId });

  for (const id of decision.supersedeDraftIds) {
    await storage.updateAlertDraft(id, { status: "superseded", actedAt: now });
  }

  if (!decision.createRecoveryForAlertId) return null;

  const service = monitor.serviceId ? await storage.getService(monitor.serviceId) : undefined;
  const subjectName = service?.name || monitor.name;
  const recoveredAt = format(now, "MMM d, yyyy h:mm a");

  const draft = await storage.createAlertDraft({
    monitorId: monitor.id,
    monitorIncidentId: null,
    serviceId: monitor.serviceId || null,
    kind: "recovery",
    suggestedTitle: `${subjectName} has recovered`,
    suggestedDescription: `${subjectName} has recovered as of ${recoveredAt}. Total downtime: ${formatDowntime(downtimeSeconds)}. Monitoring for stability.`,
    suggestedSeverity: "info",
    suggestedServiceImpact: "operational",
    relatedAlertId: decision.createRecoveryForAlertId,
    status: "pending",
  });
  if (deps.notifyAdminsDraftReady) await deps.notifyAdminsDraftReady(draft, monitor);
  return draft;
}

// ---------------------------------------------------------------------------
// Retention sweep
// ---------------------------------------------------------------------------

// Pending drafts older than this are auto-expired (a suggestion about a blip
// from a week ago is noise, not signal).
export const PENDING_DRAFT_EXPIRY_DAYS = 7;
// Non-pending rows (dismissed / superseded / published / expired) are purged
// after this long — the published alert itself lives in service_alerts.
export const DRAFT_PURGE_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AlertDraftSweepStorage {
  // Set status='expired' + actedAt on pending drafts created before the
  // cutoff; returns the number of rows changed.
  expireStalePendingAlertDrafts(cutoff: Date, now: Date): Promise<number>;
  // Delete non-pending drafts created before the cutoff; returns row count.
  purgeOldAlertDrafts(cutoff: Date): Promise<number>;
}

/**
 * Retention sweep: expire stale pending drafts, purge old non-pending rows.
 * Pure bookkeeping — never touches alerts or customer channels.
 */
export async function sweepAlertDrafts(
  now: Date,
  storage: AlertDraftSweepStorage,
  opts?: { pendingExpiryDays?: number; purgeDays?: number },
): Promise<{ expired: number; purged: number }> {
  const pendingDays = opts?.pendingExpiryDays ?? PENDING_DRAFT_EXPIRY_DAYS;
  const purgeDays = opts?.purgeDays ?? DRAFT_PURGE_DAYS;
  // Purge BEFORE expiring so a draft that expires in this pass is not deleted
  // in the same breath — it stays visible (as expired) until a later sweep.
  const purged = await storage.purgeOldAlertDrafts(new Date(now.getTime() - purgeDays * DAY_MS));
  const expired = await storage.expireStalePendingAlertDrafts(
    new Date(now.getTime() - pendingDays * DAY_MS),
    now,
  );
  return { expired, purged };
}

// ---------------------------------------------------------------------------
// Admin routes
// ---------------------------------------------------------------------------

const patchDraftSchema = z.object({
  status: z.enum(["dismissed", "published"]),
  relatedAlertId: z.string().min(1).optional(),
});

export interface AlertDraftRouteDeps {
  storage: AlertDraftStorage & {
    getAlertDrafts(status?: string): Promise<AlertDraft[]>;
    getAlertDraft(id: string): Promise<AlertDraft | undefined>;
  };
}

export interface AlertDraftRouteMiddleware {
  requirePermission: (
    viewPerm: string,
    managePerm?: string,
  ) => <P>(req: Request<P>, res: Response, next: NextFunction) => unknown;
}

export function registerAlertDraftRoutes(
  app: Express,
  middleware: AlertDraftRouteMiddleware,
  deps: AlertDraftRouteDeps,
): void {
  const { requirePermission } = middleware;
  const { storage } = deps;

  app.get("/api/admin/alert-drafts", requirePermission("alerts.view"), async (req, res) => {
    try {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await storage.getAlertDrafts(status));
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/alert-drafts/:id", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      const parsed = patchDraftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid body: status must be 'dismissed' or 'published'" });
      }
      const draft = await storage.getAlertDraft(getParam(req, "id"));
      if (!draft) return res.status(404).json({ message: "Draft not found" });
      if (draft.status !== "pending") {
        return res.status(409).json({ message: `Draft is already ${draft.status}` });
      }
      const updated = await storage.updateAlertDraft(draft.id, {
        status: parsed.data.status,
        relatedAlertId: parsed.data.relatedAlertId ?? draft.relatedAlertId,
        actedByUserId: req.session.userId ?? null,
        actedAt: new Date(),
      });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });
}
