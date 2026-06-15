import type { Request, Response, NextFunction } from "express";

export interface RequirePermissionUser {
  role: string;
  adminRoleId?: string | null;
}

export interface RequirePermissionRole {
  permissions?: string[] | null;
}

export interface RequirePermissionDeps {
  getUser(id: string): Promise<RequirePermissionUser | undefined>;
  getAdminRole(id: string): Promise<RequirePermissionRole | undefined>;
}

const WRITE_METHODS = ["POST", "PATCH", "PUT", "DELETE"];

export interface AccessGuardUser {
  role: string;
}

export interface AccessGuardDeps {
  getUser(id: string): Promise<AccessGuardUser | undefined>;
}

export function requireAuth<P>(
  req: Request<P>,
  res: Response,
  next: NextFunction,
) {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
}

export function createRequireAdmin(deps: AccessGuardDeps) {
  return async function requireAdmin<P>(
    req: Request<P>,
    res: Response,
    next: NextFunction,
  ) {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await deps.getUser(req.session.userId);
    if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export function createRequireMasterAdmin(deps: AccessGuardDeps) {
  return async function requireMasterAdmin<P>(
    req: Request<P>,
    res: Response,
    next: NextFunction,
  ) {
    if (!req.session.userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const user = await deps.getUser(req.session.userId);
    if (!user || user.role !== "master_admin") {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}

export function createRequirePermission(deps: RequirePermissionDeps) {
  return function requirePermission(viewPerm: string, managePerm?: string) {
    return async <P>(req: Request<P>, res: Response, next: NextFunction) => {
      if (!req.session.userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await deps.getUser(req.session.userId);
      if (!user || (user.role !== "admin" && user.role !== "master_admin")) {
        return res.status(403).json({ message: "Forbidden" });
      }
      if (user.role === "master_admin") return next();
      const isWrite = WRITE_METHODS.includes(req.method);
      const requiredPerm = isWrite && managePerm ? managePerm : viewPerm;
      if (!user.adminRoleId) {
        return res.status(403).json({ message: "No admin role assigned" });
      }
      const role = await deps.getAdminRole(user.adminRoleId);
      if (!role || !role.permissions?.includes(requiredPerm)) {
        return res.status(403).json({ message: "Insufficient permissions" });
      }
      next();
    };
  };
}
