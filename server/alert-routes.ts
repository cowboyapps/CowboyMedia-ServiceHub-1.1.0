// Service-alert admin routes, extracted from the monolithic registerRoutes() in
// server/routes.ts so they can be mounted on a throwaway Express app and driven
// over HTTP in tests. The motivating bug class — a route that mutates alert
// coverage but forgets to recompute + broadcast the affected services' status —
// can only be caught by exercising the route boundary, which was impossible
// while these handlers lived inline. All side-effecting collaborators (storage,
// broadcast, notification fan-out) are injected via AlertRouteDeps so tests can
// pass spies and assert the recompute/broadcast orchestration fires per path.

import type { Express, Request, Response, NextFunction, RequestHandler } from "express";
import type { Service } from "@shared/schema";
import { getParam } from "./http-params";
import { recomputeForCoveredServices, recomputeForServiceChange } from "./alert-status";
import { getErrorMessage } from "./error-utils";
import { composeAlertCreated, composeAlertUpdate, composeAlertResolved, type TelegramCategory } from "./telegram";
import {
  composeAlertCreated as composeDiscordAlertCreated,
  composeAlertUpdate as composeDiscordAlertUpdate,
  composeAlertResolved as composeDiscordAlertResolved,
} from "./discord";

export interface AlertRouteDeps {
  storage: typeof import("./storage").storage;
  broadcast: (data: any) => void;
  saveUploadedFile: (file: any) => Promise<string>;
  parseServiceIds: (raw: any) => string[];
  logActivity: (category: string, action: string, opts: any) => void;
  customerWantsPush: (user: any, categoryKey: string, severity?: string | null) => boolean;
  customerWantsEmail: (user: any, categoryKey: string, severity?: string | null) => boolean;
  customerWantsInApp: (user: any, categoryKey: string) => boolean;
  sendPushToUser: (userId: string, payload: any, notif?: any) => Promise<any> | any;
  sendTemplatedEmail: (to: string, template: string, vars: any, name?: string) => Promise<any> | any;
  fireDiscordForServices: (services: Service[], payload: any) => void;
  fireTelegram: (text: string, category?: TelegramCategory) => void;
  getBaseUrl: (req: Request) => string;
  notifyServiceSubscribers: (
    serviceId: string,
    event: "status" | "incident" | "resolved",
    vars: {
      service_name: string;
      alert_title: string;
      alert_description?: string;
      impact_label?: string;
      resolve_message?: string;
    },
    baseUrl: string,
  ) => Promise<void> | void;
}

export interface AlertRouteMiddleware {
  // Mirrors server/routes.ts requirePermission(viewPerm, managePerm) → RequestHandler.
  // Generic-over-P so route-param inference survives this middleware on the
  // injected routes (see server/routes.ts for the rationale).
  requirePermission: (
    viewPerm: string,
    managePerm?: string,
  ) => <P>(req: Request<P>, res: Response, next: NextFunction) => unknown;
  // Mirrors multer's instance: upload.single(field) → RequestHandler.
  upload: { single: (field: string) => RequestHandler };
}

// Register the six service-alert admin routes on `app`. Pulled out of
// registerRoutes() verbatim; the only change is that collaborators are reached
// through the injected `deps`/`middleware` rather than module/closure scope.
export function registerAlertRoutes(
  app: Express,
  middleware: AlertRouteMiddleware,
  deps: AlertRouteDeps,
): void {
  const { requirePermission, upload } = middleware;
  // Generic-over-P wrapper so route-param inference survives the multer
  // middleware (see the matching helper in server/routes.ts for the rationale).
  const withUpload = (field: string) => {
    const handler = upload.single(field);
    return <P>(req: Request<P>, res: Response, next: NextFunction): void => {
      handler(req as Request, res, next);
    };
  };
  const {
    storage,
    broadcast,
    saveUploadedFile,
    parseServiceIds,
    logActivity,
    customerWantsPush,
    customerWantsEmail,
    customerWantsInApp,
    sendPushToUser,
    sendTemplatedEmail,
    fireDiscordForServices,
    fireTelegram,
    getBaseUrl,
    notifyServiceSubscribers,
  } = deps;

  // Dependencies the alert-status orchestration (server/alert-status.ts) needs:
  // recompute a service's derived status, then broadcast it to connected clients.
  const alertStatusDeps = {
    recompute: (serviceId: string) => storage.recomputeServiceStatus(serviceId),
    broadcast: (message: { type: "service_updated"; serviceId: string }) => broadcast(message),
  };

  app.post("/api/admin/alerts", requirePermission("alerts.view", "alerts.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const { sendPush, sendEmail, serviceImpact, serviceIds: rawServiceIds, ...alertData } = req.body;
      const parsedSendPush = sendPush === "false" ? false : sendPush !== false;
      const parsedSendEmail = sendEmail === "false" ? false : sendEmail !== false;
      if (imageUrl) alertData.imageUrl = imageUrl;
      const serviceIds = parseServiceIds(rawServiceIds);
      if (serviceIds.length === 0) {
        return res.status(400).json({ message: "At least one service is required" });
      }
      const impact = serviceImpact || "degraded";
      alertData.impact = impact;
      const alert = await storage.createAlert(alertData, serviceIds);
      // Recompute each covered service's status so a shared service keeps its
      // most-severe active impact rather than being clobbered by this one.
      await recomputeForCoveredServices(alert.serviceIds, alertStatusDeps);
      const coveredServices = (await Promise.all(alert.serviceIds.map(sid => storage.getService(sid)))).filter((s): s is Service => !!s);
      const serviceNames = coveredServices.map(s => s.name);
      const serviceNameDisplay = serviceNames.length > 0 ? serviceNames.join(", ") : "Service";
      const impactLabel = impact === "outage" ? "Outage" : impact === "maintenance" ? "Maintenance" : "Degraded Performance";
      logActivity("alert", "alert_created", { actorId: req.session.userId!, targetId: alert.id, targetType: "alert", summary: `Alert created: ${alert.title} (${serviceNameDisplay} — ${impactLabel})`, details: JSON.stringify({ title: alert.title, description: alert.description, severity: alert.severity, services: serviceNames, impact }) });
      broadcast({ type: "new_alert", alert });
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.id !== req.session.userId && u.subscribedServices?.some(sid => alert.serviceIds.includes(sid)));
      console.log(`[Alert Create] Alert ${alert.id} — sendPush=${parsedSendPush}, ${subscribers.length} subscriber(s)`);
      for (const u of subscribers) {
        if (parsedSendPush && customerWantsPush(u, "service_alert", alert.severity)) {
          await sendPushToUser(u.id, {
            title: `${serviceNameDisplay}: ${impactLabel}`,
            body: alert.title,
            url: `/alerts/${alert.id}`,
            tag: `alert-${alert.id}`,
            resourceLabel: `${serviceNameDisplay} alert: ${alert.title}`,
            rollupNoun: "updates",
          }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: alert.id } : undefined);
        }
        if (parsedSendEmail && u.email && customerWantsEmail(u, "service_alert", alert.severity)) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceNameDisplay}: ${impactLabel}`,
            alert_description: `${alert.title}\n\n${alert.description}`,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const subIds = subscribers.filter(u => customerWantsInApp(u, "service_alert")).map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", `${serviceNameDisplay}: ${impactLabel} — ${alert.title}`, alert.id).catch(() => {});
      fireDiscordForServices(coveredServices, composeDiscordAlertCreated({
        serviceNames,
        impact,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
        alertId: alert.id,
        baseUrl: getBaseUrl(req),
      }));
      fireTelegram(composeAlertCreated({
        serviceNames,
        impact,
        severity: alert.severity,
        title: alert.title,
        description: alert.description,
      }), "alert");
      for (const s of coveredServices) {
        void notifyServiceSubscribers(s.id, "incident", {
          service_name: s.name,
          alert_title: alert.title,
          alert_description: alert.description,
          impact_label: impactLabel,
        }, getBaseUrl(req));
      }
      res.json(alert);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/alerts/:id", requirePermission("alerts.view", "alerts.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const data: Record<string, any> = {};
      if (req.body.title !== undefined) data.title = req.body.title;
      if (req.body.description !== undefined) data.description = req.body.description;
      if (req.body.severity !== undefined) data.severity = req.body.severity;
      if (imageUrl) data.imageUrl = imageUrl;
      if (req.body.removeImage === "true") data.imageUrl = null;
      const updated = await storage.updateAlert(getParam(req, "id"), data);
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      if (req.body.serviceIds !== undefined) {
        const newServiceIds = parseServiceIds(req.body.serviceIds);
        if (newServiceIds.length === 0) {
          return res.status(400).json({ message: "At least one service is required" });
        }
        const previousServiceIds = updated.serviceIds;
        await storage.setAlertServices(getParam(req, "id"), newServiceIds);
        // Recompute every service that gained or lost this alert so statuses stay correct.
        await recomputeForServiceChange(previousServiceIds, newServiceIds, alertStatusDeps);
        const refreshed = await storage.getAlert(getParam(req, "id"));
        return res.json(refreshed ?? updated);
      }
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.post("/api/admin/alerts/:id/updates", requirePermission("alerts.view", "alerts.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const { sendPush, sendEmail, serviceImpact, ...updateData } = req.body;
      const parsedSendPush = sendPush === "false" ? false : sendPush !== false;
      const parsedSendEmail = sendEmail === "false" ? false : sendEmail !== false;
      const update = await storage.createAlertUpdate({
        alertId: getParam(req, "id"),
        message: updateData.message,
        status: updateData.status,
        ...(imageUrl ? { imageUrl } : {}),
      });
      if (updateData.status === "resolved") {
        await storage.updateAlert(getParam(req, "id"), { status: "resolved", resolvedAt: new Date() });
      } else {
        await storage.updateAlert(getParam(req, "id"), { status: updateData.status });
      }
      broadcast({ type: "alert_update", alertId: req.params.id, update });
      logActivity("alert", updateData.status === "resolved" ? "alert_resolved" : "alert_updated", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert ${updateData.status === "resolved" ? "resolved" : "updated"}: ${updateData.message?.substring(0, 100)}`, details: JSON.stringify({ status: updateData.status, message: updateData.message, serviceImpact }) });
      const alert = await storage.getAlert(getParam(req, "id"));
      if (alert) {
        const isResolved = updateData.status === "resolved";
        const impactLabels: Record<string, string> = { operational: "Operational", degraded: "Degraded", outage: "Outage", maintenance: "Maintenance" };
        const hasImpactChange = !isResolved && serviceImpact && serviceImpact !== "no_change";
        const impactLabel = hasImpactChange ? impactLabels[serviceImpact] || serviceImpact : null;
        // Persist the new impact on the alert so status recompute reflects it for all covered services.
        if (hasImpactChange) {
          await storage.updateAlert(getParam(req, "id"), { impact: serviceImpact });
        }
        const coveredServices = (await Promise.all(alert.serviceIds.map(sid => storage.getService(sid)))).filter((s): s is Service => !!s);
        const serviceNames = coveredServices.map(s => s.name);
        const serviceName = serviceNames.length > 0 ? serviceNames.join(", ") : "Service";
        // Recompute each covered service's status (handles resolve → operational
        // and impact changes, while keeping shared services at their worst active impact).
        await recomputeForCoveredServices(alert.serviceIds, alertStatusDeps);
        const pushTitle = isResolved
          ? `${serviceName}: Resolved — Now Operational`
          : impactLabel
            ? `${serviceName}: ${impactLabel} — ${alert.title}`
            : `${serviceName} Alert Update: ${alert.title}`;
        const emailTitle = isResolved
          ? `${serviceName}: Issue Resolved — Service Restored`
          : impactLabel
            ? `${serviceName}: ${impactLabel} — ${alert.title}`
            : `${serviceName} Update: ${alert.title}`;
        const allUsers = await storage.getAllUsers();
        const subscribers = allUsers.filter(u => u.id !== req.session.userId && u.subscribedServices?.some(sid => alert.serviceIds.includes(sid)));
        console.log(`[Alert Update] Alert ${req.params.id} — status=${updateData.status}, sendPush=${parsedSendPush}, ${subscribers.length} subscriber(s)`);
        for (const u of subscribers) {
          if ((parsedSendPush || isResolved) && customerWantsPush(u, "service_alert", alert.severity)) {
            await sendPushToUser(u.id, {
              title: pushTitle,
              body: updateData.message,
              url: `/alerts/${req.params.id}`,
              tag: `alert-${req.params.id}`,
              resourceLabel: `${serviceName} alert: ${alert.title}`,
              rollupNoun: "updates",
            }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: req.params.id } : undefined);
          }
          if ((parsedSendEmail || isResolved) && u.email && customerWantsEmail(u, "service_alert", alert.severity)) {
            sendTemplatedEmail(u.email, "customer_service_alert", {
              alert_title: emailTitle,
              alert_description: updateData.message,
              customer_name: u.fullName,
            }, u.fullName);
          }
        }
        const subIds = subscribers.filter(u => customerWantsInApp(u, "service_alert")).map(u => u.id);
        const notifMsg = isResolved
          ? `${serviceName}: Resolved — ${alert.title}`
          : `${serviceName} Update: ${alert.title}`;
        storage.createContentNotificationBulk(subIds, "alerts", notifMsg, alert.id).catch(() => {});
        fireDiscordForServices(coveredServices, composeDiscordAlertUpdate({
          serviceNames,
          title: alert.title,
          status: updateData.status,
          message: updateData.message,
          impact: hasImpactChange ? serviceImpact : null,
          alertId: alert.id,
          baseUrl: getBaseUrl(req),
        }));
        fireTelegram(composeAlertUpdate({
          serviceNames,
          title: alert.title,
          status: updateData.status,
          message: updateData.message,
          impact: hasImpactChange ? serviceImpact : null,
        }), "alert");
        if (isResolved) {
          for (const s of coveredServices) {
            void notifyServiceSubscribers(s.id, "resolved", {
              service_name: s.name,
              alert_title: alert.title,
              resolve_message: updateData.message,
            }, getBaseUrl(req));
          }
        } else if (hasImpactChange) {
          for (const s of coveredServices) {
            void notifyServiceSubscribers(s.id, "status", {
              service_name: s.name,
              alert_title: alert.title,
              alert_description: updateData.message,
              impact_label: impactLabel || "",
            }, getBaseUrl(req));
          }
        }
      }
      res.json(update);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/alerts/:alertId/updates/:updateId", requirePermission("alerts.view", "alerts.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const data: Record<string, any> = {};
      if (req.body.message !== undefined) data.message = req.body.message;
      if (imageUrl) data.imageUrl = imageUrl;
      if (req.body.removeImage === "true") data.imageUrl = null;
      const updated = await storage.updateAlertUpdate(getParam(req, "updateId"), data);
      if (!updated) return res.status(404).json({ message: "Alert update not found" });
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.patch("/api/admin/alerts/:id/resolve", requirePermission("alerts.view", "alerts.manage"), withUpload("image"), async (req, res) => {
    try {
      const imageUrl = req.file ? await saveUploadedFile(req.file) : undefined;
      const resolveMessage = req.body?.message || "Issue has been resolved.";
      const silent = req.body?.silent === "true" || req.body?.silent === true;
      const updated = await storage.updateAlert(getParam(req, "id"), { status: "resolved", resolvedAt: new Date() });
      if (!updated) return res.status(404).json({ message: "Alert not found" });
      await storage.createAlertUpdate({
        alertId: getParam(req, "id"),
        message: resolveMessage,
        status: "resolved",
        ...(imageUrl ? { imageUrl } : {}),
      });
      // Recompute each covered service: a shared service stays non-operational
      // if it still has another active alert.
      await recomputeForCoveredServices(updated.serviceIds, alertStatusDeps);
      const coveredServices = (await Promise.all(updated.serviceIds.map(sid => storage.getService(sid)))).filter((s): s is Service => !!s);
      const serviceNames = coveredServices.map(s => s.name);
      const serviceName = serviceNames.length > 0 ? serviceNames.join(", ") : "Service";
      logActivity("alert", "alert_resolved", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert resolved${silent ? " (silently)" : ""}: ${updated.title} (${serviceName})`, details: JSON.stringify({ title: updated.title, resolveMessage, services: serviceNames, silent }) });
      broadcast({ type: "alert_resolved", alertId: req.params.id });
      // Silent resolve: status + timeline + activity log + realtime refresh still
      // happen above, but skip every customer-facing notification channel below.
      if (silent) {
        console.log(`[Alert Resolve] Alert ${req.params.id} resolved silently — notifications suppressed`);
        return res.json(updated);
      }
      const allUsers = await storage.getAllUsers();
      const subscribers = allUsers.filter(u => u.id !== req.session.userId && u.subscribedServices?.some(sid => updated.serviceIds.includes(sid)));
      console.log(`[Alert Resolve] Alert ${req.params.id} — ${subscribers.length} subscriber(s) to notify`);
      for (const u of subscribers) {
        if (customerWantsPush(u, "service_alert", updated.severity)) {
          await sendPushToUser(u.id, {
            title: `${serviceName}: Resolved — Now Operational`,
            body: `${updated.title} has been resolved. Service is back to operational.`,
            url: `/alerts/${req.params.id}`,
            tag: `alert-${req.params.id}`,
            resourceLabel: `${serviceName} alert: ${updated.title}`,
            rollupNoun: "updates",
          }, u.role === "customer" ? { type: "alert", referenceType: "alert", referenceId: req.params.id } : undefined);
        }
        if (u.email && customerWantsEmail(u, "service_alert", updated.severity)) {
          sendTemplatedEmail(u.email, "customer_service_alert", {
            alert_title: `${serviceName}: Issue Resolved — Service Restored`,
            alert_description: `${updated.title} has been resolved. Service is back to operational.`,
            customer_name: u.fullName,
          }, u.fullName);
        }
      }
      const subIds = subscribers.filter(u => customerWantsInApp(u, "service_alert")).map(u => u.id);
      storage.createContentNotificationBulk(subIds, "alerts", `${serviceName}: Resolved — ${updated.title}`, updated.id).catch(() => {});
      fireDiscordForServices(coveredServices, composeDiscordAlertResolved({
        serviceNames,
        title: updated.title,
        resolveMessage,
        alertId: updated.id,
        baseUrl: getBaseUrl(req),
      }));
      fireTelegram(composeAlertResolved({
        serviceNames,
        title: updated.title,
        resolveMessage,
      }), "alert");
      for (const s of coveredServices) {
        void notifyServiceSubscribers(s.id, "resolved", {
          service_name: s.name,
          alert_title: updated.title,
          resolve_message: resolveMessage,
        }, getBaseUrl(req));
      }
      res.json(updated);
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });

  app.delete("/api/admin/alerts/:id", requirePermission("alerts.view", "alerts.manage"), async (req, res) => {
    try {
      // Capture the covered ids BEFORE deletion — the junction rows go away with the alert.
      const alertToDelete = await storage.getAlert(getParam(req, "id"));
      await storage.deleteAlert(getParam(req, "id"));
      await recomputeForCoveredServices(alertToDelete?.serviceIds || [], alertStatusDeps);
      logActivity("alert", "alert_deleted", { actorId: req.session.userId!, targetId: req.params.id, targetType: "alert", summary: `Alert deleted: ${alertToDelete?.title || req.params.id}` });
      res.json({ message: "Alert deleted" });
    } catch (e) {
      res.status(500).json({ message: getErrorMessage(e) });
    }
  });
}
