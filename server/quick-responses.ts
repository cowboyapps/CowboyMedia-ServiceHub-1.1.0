import type { Request, Response } from "express";
import "express-session";
import type {
  QuickResponse,
  InsertQuickResponse,
  QuickResponseCategory,
  InsertQuickResponseCategory,
} from "@shared/schema";

export interface QuickResponseStorage {
  getQuickResponse(id: string): Promise<QuickResponse | undefined>;
  createQuickResponse(qr: InsertQuickResponse): Promise<QuickResponse>;
  updateQuickResponse(id: string, data: Partial<QuickResponse>): Promise<QuickResponse | undefined>;
  deleteQuickResponse(id: string): Promise<void>;
  bumpQuickResponseUsage(id: string): Promise<QuickResponse | undefined>;

  getAllQuickResponseCategories(): Promise<QuickResponseCategory[]>;
  getQuickResponseCategory(id: string): Promise<QuickResponseCategory | undefined>;
  createQuickResponseCategory(data: InsertQuickResponseCategory): Promise<QuickResponseCategory>;
  updateQuickResponseCategory(id: string, data: Partial<QuickResponseCategory>): Promise<QuickResponseCategory | undefined>;
  deleteQuickResponseCategory(id: string): Promise<void>;
  reorderQuickResponseCategories(orderedIds: string[]): Promise<void>;

  getQuickResponseFavoriteIds(adminId: string): Promise<string[]>;
  addQuickResponseFavorite(adminId: string, responseId: string): Promise<void>;
  removeQuickResponseFavorite(adminId: string, responseId: string): Promise<void>;
}

function cleanCategoryId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createQuickResponseHandlers({ storage }: { storage: QuickResponseStorage }) {
  return {
    async create(req: Request, res: Response) {
      try {
        const { title, message, categoryId } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof title !== "string" || !title.trim() || typeof message !== "string" || !message.trim()) {
          return res.status(400).json({ message: "Title and message are required" });
        }
        const cat = cleanCategoryId(categoryId);
        if (cat) {
          const found = await storage.getQuickResponseCategory(cat);
          if (!found) return res.status(400).json({ message: "Unknown category" });
        }
        const created = await storage.createQuickResponse({ title, message, categoryId: cat });
        res.json(created);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async update(req: Request, res: Response) {
      try {
        const { title, message, categoryId } = (req.body ?? {}) as Record<string, unknown>;
        const data: Partial<{ title: string; message: string; categoryId: string | null }> = {};
        if (typeof title === "string") data.title = title;
        if (typeof message === "string") data.message = message;
        if (categoryId !== undefined) {
          const cat = cleanCategoryId(categoryId);
          if (cat) {
            const found = await storage.getQuickResponseCategory(cat);
            if (!found) return res.status(400).json({ message: "Unknown category" });
          }
          data.categoryId = cat;
        }
        const updated = await storage.updateQuickResponse(String(req.params.id), data);
        if (!updated) return res.status(404).json({ message: "Quick response not found" });
        res.json(updated);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async remove(req: Request, res: Response) {
      try {
        await storage.deleteQuickResponse(String(req.params.id));
        res.json({ message: "Quick response deleted" });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async bumpUsage(req: Request, res: Response) {
      try {
        const updated = await storage.bumpQuickResponseUsage(String(req.params.id));
        if (!updated) return res.status(404).json({ message: "Quick response not found" });
        res.json(updated);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async listCategories(_req: Request, res: Response) {
      try {
        res.json(await storage.getAllQuickResponseCategories());
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async createCategory(req: Request, res: Response) {
      try {
        const { name } = (req.body ?? {}) as Record<string, unknown>;
        if (typeof name !== "string" || !name.trim()) {
          return res.status(400).json({ message: "Name is required" });
        }
        const existing = await storage.getAllQuickResponseCategories();
        const created = await storage.createQuickResponseCategory({ name: name.trim(), sortOrder: existing.length });
        res.json(created);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async updateCategory(req: Request, res: Response) {
      try {
        const { name } = (req.body ?? {}) as Record<string, unknown>;
        const data: Partial<{ name: string }> = {};
        if (typeof name === "string") {
          if (!name.trim()) return res.status(400).json({ message: "Name cannot be empty" });
          data.name = name.trim();
        }
        const updated = await storage.updateQuickResponseCategory(String(req.params.id), data);
        if (!updated) return res.status(404).json({ message: "Category not found" });
        res.json(updated);
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async removeCategory(req: Request, res: Response) {
      try {
        await storage.deleteQuickResponseCategory(String(req.params.id));
        res.json({ message: "Category deleted" });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async reorderCategories(req: Request, res: Response) {
      try {
        const { orderedIds } = (req.body ?? {}) as Record<string, unknown>;
        if (!Array.isArray(orderedIds) || !orderedIds.every((x) => typeof x === "string")) {
          return res.status(400).json({ message: "orderedIds must be an array of strings" });
        }
        await storage.reorderQuickResponseCategories(orderedIds as string[]);
        res.json({ message: "Reordered" });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async listFavorites(req: Request, res: Response) {
      try {
        const adminId = req.session?.userId;
        if (!adminId) return res.status(401).json({ message: "Not authenticated" });
        res.json(await storage.getQuickResponseFavoriteIds(adminId));
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async addFavorite(req: Request, res: Response) {
      try {
        const adminId = req.session?.userId;
        if (!adminId) return res.status(401).json({ message: "Not authenticated" });
        const qr = await storage.getQuickResponse(String(req.params.id));
        if (!qr) return res.status(404).json({ message: "Quick response not found" });
        await storage.addQuickResponseFavorite(adminId, String(req.params.id));
        res.json({ message: "Favorited" });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },

    async removeFavorite(req: Request, res: Response) {
      try {
        const adminId = req.session?.userId;
        if (!adminId) return res.status(401).json({ message: "Not authenticated" });
        await storage.removeQuickResponseFavorite(adminId, String(req.params.id));
        res.json({ message: "Unfavorited" });
      } catch (e: any) {
        res.status(500).json({ message: e.message });
      }
    },
  };
}
