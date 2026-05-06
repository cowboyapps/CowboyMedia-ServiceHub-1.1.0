import type { Request, Response } from "express";
import "express-session";
import {
  updateTicketCategorySchema,
  type TicketCategory,
  type UpdateTicketCategoryData,
} from "@shared/schema";

export interface TicketCategoryStorage {
  updateTicketCategory(
    id: string,
    data: Partial<TicketCategory>,
  ): Promise<TicketCategory | undefined>;
}

export interface TicketCategoryDeps {
  storage: TicketCategoryStorage;
}

export function buildTicketCategoryPatch(data: UpdateTicketCategoryData): Partial<TicketCategory> {
  const patch: Partial<TicketCategory> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.description !== undefined) patch.description = data.description;
  if (data.assignedRoleIds !== undefined) patch.assignedRoleIds = data.assignedRoleIds;
  if (data.firstResponseTargetMinutes !== undefined) {
    patch.firstResponseTargetMinutes = data.firstResponseTargetMinutes;
  }
  if (data.resolutionTargetMinutes !== undefined) {
    patch.resolutionTargetMinutes = data.resolutionTargetMinutes;
  }
  return patch;
}

export function createTicketCategoryHandlers(deps: TicketCategoryDeps) {
  const { storage } = deps;

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateTicketCategorySchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid category", errors: parsed.error.flatten() });
      }
      const patch = buildTicketCategoryPatch(parsed.data);
      const updated = await storage.updateTicketCategory(String(req.params.id), patch);
      if (!updated) return res.status(404).json({ message: "Category not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { patchAdmin };
}
