import type { Request, Response } from "express";
import "express-session";
import {
  insertKbCategorySchema,
  updateKbCategorySchema,
  insertKbArticleSchema,
  updateKbArticleSchema,
  type KbCategory,
  type KbArticle,
  type InsertKbCategory,
  type UpdateKbCategory,
  type InsertKbArticle,
  type UpdateKbArticle,
} from "@shared/schema";

export interface KbAdminStorage {
  getKbCategory(id: string): Promise<KbCategory | undefined>;
  createKbCategory(data: InsertKbCategory): Promise<KbCategory>;
  updateKbCategory(id: string, data: UpdateKbCategory): Promise<KbCategory | undefined>;
  getKbArticleById(id: string): Promise<KbArticle | undefined>;
  createKbArticle(
    data: InsertKbArticle & { authorId: string | null },
  ): Promise<KbArticle>;
  updateKbArticle(id: string, data: UpdateKbArticle): Promise<KbArticle | undefined>;
}

export type LogActivityFn = (
  category: string,
  action: string,
  opts: {
    actorId?: string;
    targetId?: string;
    targetType?: string;
    recipientId?: string;
    summary: string;
    details?: string;
  },
) => void;

export interface KbAdminDeps {
  storage: KbAdminStorage;
  logActivity: LogActivityFn;
  sanitizeHtml: (html: string) => string;
}

function isDuplicateKey(e: any): boolean {
  return String(e?.message || "").includes("duplicate key");
}

export function createKbAdminHandlers(deps: KbAdminDeps) {
  const { storage, logActivity, sanitizeHtml } = deps;

  async function postCategory(req: Request, res: Response) {
    try {
      const parsed = insertKbCategorySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid category", errors: parsed.error.flatten() });
      }
      const created = await storage.createKbCategory(parsed.data);
      logActivity("system", "kb_category_created", {
        actorId: req.session.userId!,
        targetId: created.id,
        targetType: "kb_category",
        summary: `KB category created: ${created.name}`,
      });
      res.json(created);
    } catch (e: any) {
      if (isDuplicateKey(e)) return res.status(409).json({ message: "Slug already in use" });
      res.status(500).json({ message: e.message });
    }
  }

  async function patchCategory(req: Request, res: Response) {
    try {
      const parsed = updateKbCategorySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid category", errors: parsed.error.flatten() });
      }
      const updated = await storage.updateKbCategory(String(req.params.id), parsed.data);
      if (!updated) return res.status(404).json({ message: "Category not found" });
      logActivity("system", "kb_category_updated", {
        actorId: req.session.userId!,
        targetId: updated.id,
        targetType: "kb_category",
        summary: `KB category updated: ${updated.name}`,
      });
      res.json(updated);
    } catch (e: any) {
      if (isDuplicateKey(e)) return res.status(409).json({ message: "Slug already in use" });
      res.status(500).json({ message: e.message });
    }
  }

  async function postArticle(req: Request, res: Response) {
    try {
      const parsed = insertKbArticleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid article", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      const cat = await storage.getKbCategory(data.categoryId);
      if (!cat) return res.status(400).json({ message: "Category not found" });
      const created = await storage.createKbArticle({
        ...data,
        bodyHtml: sanitizeHtml(data.bodyHtml),
        authorId: req.session.userId!,
      });
      logActivity("system", "kb_article_created", {
        actorId: req.session.userId!,
        targetId: created.id,
        targetType: "kb_article",
        summary: `KB article created: ${created.title}`,
      });
      res.json(created);
    } catch (e: any) {
      if (isDuplicateKey(e)) return res.status(409).json({ message: "Slug already in use" });
      res.status(500).json({ message: e.message });
    }
  }

  async function patchArticle(req: Request, res: Response) {
    try {
      const parsed = updateKbArticleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: "Invalid article", errors: parsed.error.flatten() });
      }
      const data = parsed.data;
      if (data.categoryId !== undefined) {
        const cat = await storage.getKbCategory(data.categoryId);
        if (!cat) return res.status(400).json({ message: "Category not found" });
      }
      const patch: UpdateKbArticle = { ...data };
      if (patch.bodyHtml !== undefined) patch.bodyHtml = sanitizeHtml(patch.bodyHtml);
      const updated = await storage.updateKbArticle(String(req.params.id), patch);
      if (!updated) return res.status(404).json({ message: "Article not found" });
      logActivity("system", "kb_article_updated", {
        actorId: req.session.userId!,
        targetId: updated.id,
        targetType: "kb_article",
        summary: `KB article updated: ${updated.title}`,
      });
      res.json(updated);
    } catch (e: any) {
      if (isDuplicateKey(e)) return res.status(409).json({ message: "Slug already in use" });
      res.status(500).json({ message: e.message });
    }
  }

  return { postCategory, patchCategory, postArticle, patchArticle };
}
