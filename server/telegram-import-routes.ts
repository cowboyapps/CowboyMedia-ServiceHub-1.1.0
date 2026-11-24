import type { Express, RequestHandler, Request } from "express";
import { z } from "zod";
import sanitizeHtml from "sanitize-html";
import { stripHtmlPreserveBreaks } from "@shared/html-text";
import { TelegramImportStore, ImportConflict } from "./telegram-import-store";
import { TelegramImporter } from "./telegram-import";
import { getParam } from "./http-params";
import type { ServiceUpdate } from "@shared/schema";

interface Dependencies {
  store: TelegramImportStore;
  importer: TelegramImporter;
  master: RequestHandler;
  drafts: RequestHandler;
  serviceExists: (id: string) => Promise<boolean>;
  published: (update: ServiceUpdate, req: Request) => Promise<void>;
  audit: (actor: string, action: string, id?: string) => void;
}

const draftFields = z.object({
  title: z.string().max(300),
  description: z.string().max(100000),
  serviceId: z.string().max(100),
  matureContent: z.boolean(),
});

export function registerTelegramImportRoutes(app: Express, deps: Dependencies) {
  const base = "/api/admin/telegram-import";
  // Authentication and rate limits apply before every account operation.
  const handle = (fn: RequestHandler): RequestHandler => async (req, res, next) => {
    try { await fn(req, res, next); }
    catch (error) {
      if (error instanceof z.ZodError) return void res.status(400).json({ message: "Invalid or incomplete Telegram import fields." });
      if (error instanceof ImportConflict) return void res.status(409).json({ message: error.message });
      // Only deliberately safe account errors reach this layer; raw provider errors do not.
      res.status(400).json({ message: "Unable to complete this action. Check the Telegram connection and try again." });
    }
  };
  app.get(`${base}/status`, deps.master, handle(async (req, res) => {
    res.json(await deps.importer.status(req.session.userId!));
  }));
  app.get(`${base}/channels`, deps.master, handle(async (_req, res) => { res.json(await deps.importer.channels()); }));
  for (const kind of ["start", "code", "password"] as const) {
    app.post(`${base}/login/${kind}`, deps.master, handle(async (req, res) => {
      const key = kind === "start" ? "phoneNumber" : kind;
      const value = z.string().min(1).max(256).parse(req.body?.[key]);
      if (kind === "start" && !/^\+[1-9]\d{6,14}$/.test(value)) {
        return void res.status(400).json({ message: "Enter the dedicated account’s phone number in international format." });
      }
      try {
        const status = await deps.importer.login(req.session.userId!, kind, value);
        deps.audit(req.session.userId!, "telegram_import_account_setup");
        res.json(status);
      } catch (error) {
        // Importer login deliberately replaces all provider errors with safe messages.
        res.status(400).json({ message: error instanceof Error ? error.message : "Telegram sign-in failed." });
      }
    }));
  }
  app.put(`${base}/settings`, deps.master, handle(async (req, res) => {
    const fields = z.object({ enabled: z.boolean(), channelId: z.string().max(100).optional() }).parse(req.body);
    try {
      res.json(await deps.importer.configure(req.session.userId!, fields.enabled, fields.channelId));
      deps.audit(req.session.userId!, "telegram_import_settings_updated");
    } catch {
      res.status(400).json({ message: "Could not save import settings. Select a joined channel different from ServiceHub’s outbound Telegram channel." });
    }
  }));
  app.post(`${base}/disconnect`, deps.master, handle(async (req, res) => {
    res.json(await deps.importer.disconnect(req.session.userId!));
    deps.audit(req.session.userId!, "telegram_import_disconnected");
  }));
  app.get(`${base}/drafts`, deps.drafts, handle(async (_req, res) => { res.json(await deps.store.pending()); }));
  app.get(`${base}/drafts/:id`, deps.drafts, handle(async (req, res) => {
    const draft = await deps.store.getDraft(getParam(req, "id"));
    if (!draft || draft.status === "deleted") return void res.status(404).json({ message: "This draft was deleted or is no longer available." });
    res.json(draft);
  }));
  const validatedFields = (body: unknown) => {
    const fields = draftFields.parse(body);
    return {
      ...fields, title: fields.title.trim(), serviceId: fields.serviceId.trim(),
      description: sanitizeHtml(fields.description, {
        allowedTags: ["p", "br", "strong", "em", "u", "s", "span", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "a", "code", "pre"],
        allowedAttributes: { a: ["href", "target", "rel"] }, allowedSchemes: ["http", "https", "mailto"],
      }),
    };
  };
  app.patch(`${base}/drafts/:id`, deps.drafts, handle(async (req, res) => {
    const fields = validatedFields(req.body);
    if (fields.serviceId && !await deps.serviceExists(fields.serviceId)) {
      return void res.status(400).json({ message: "The selected service is no longer available." });
    }
    res.json(await deps.store.saveDraft(getParam(req, "id"), fields));
    deps.audit(req.session.userId!, "telegram_import_draft_saved", getParam(req, "id"));
  }));
  app.post(`${base}/drafts/:id/publish`, deps.drafts, handle(async (req, res) => {
    const fields = validatedFields(req.body);
    if (!fields.title || !fields.serviceId || !stripHtmlPreserveBreaks(fields.description).trim()) {
      return void res.status(400).json({ message: "Title, body, and service are required before publishing." });
    }
    if (!await deps.serviceExists(fields.serviceId)) return void res.status(400).json({ message: "Select an available service." });
    const result = await deps.store.publish(getParam(req, "id"), fields);
    if (result.created && result.update) {
      // Publishing is committed exactly once; a retry never creates a second update.
      deps.audit(req.session.userId!, "telegram_import_draft_published", getParam(req, "id"));
      try {
        await deps.published(result.update, req);
      } catch {
        deps.audit(req.session.userId!, "telegram_import_publication_notifications_failed", getParam(req, "id"));
        return void res.json({
          id: result.id,
          notificationWarning: "The update was published, but subscriber notifications could not be completed. Review the activity log before arranging delivery.",
        });
      }
    }
    res.json({ id: result.id });
  }));
  app.delete(`${base}/drafts/:id`, deps.drafts, handle(async (req, res) => {
    await deps.store.deleteDraft(getParam(req, "id"));
    deps.audit(req.session.userId!, "telegram_import_draft_deleted", getParam(req, "id"));
    res.status(204).end();
  }));
}
