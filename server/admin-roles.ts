import type { Request, Response } from "express";
import "express-session";
import {
  createAdminRoleSchema,
  updateAdminRoleSchema,
  type AdminRole,
  type CreateAdminRoleData,
  type InsertAdminRole,
  type UpdateAdminRoleData,
} from "@shared/schema";

export interface AdminRoleStorage {
  createAdminRole(role: InsertAdminRole): Promise<AdminRole>;
  updateAdminRole(
    id: string,
    data: Partial<AdminRole>,
  ): Promise<AdminRole | undefined>;
}

export interface AdminRoleDeps {
  storage: AdminRoleStorage;
}

export function buildAdminRoleInsert(data: CreateAdminRoleData): InsertAdminRole {
  return {
    name: data.name,
    permissions: data.permissions ?? [],
  };
}

export function buildAdminRolePatch(data: UpdateAdminRoleData): Partial<AdminRole> {
  const patch: Partial<AdminRole> = {};
  if (data.name !== undefined) patch.name = data.name;
  if (data.permissions !== undefined) patch.permissions = data.permissions;
  return patch;
}

export function createAdminRoleHandlers(deps: AdminRoleDeps) {
  const { storage } = deps;

  async function postAdmin(req: Request, res: Response) {
    try {
      const parsed = createAdminRoleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
      }
      const insert = buildAdminRoleInsert(parsed.data);
      const created = await storage.createAdminRole(insert);
      res.json(created);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  async function patchAdmin(req: Request, res: Response) {
    try {
      const parsed = updateAdminRoleSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid role", errors: parsed.error.flatten() });
      }
      const patch = buildAdminRolePatch(parsed.data);
      const updated = await storage.updateAdminRole(String(req.params.id), patch);
      if (!updated) return res.status(404).json({ message: "Role not found" });
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  }

  return { postAdmin, patchAdmin };
}
