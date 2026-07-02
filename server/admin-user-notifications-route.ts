import type { Request, Response } from "express";
import type { UserNotification } from "@shared/schema";
import { getParam } from "./http-params";
import { queryInt, queryString } from "./request-utils";
import { getErrorMessage } from "./error-utils";

// Admin read-only view of a specific customer's in-app (bell) notification
// history. Unlike the customer's own feed this includes DISMISSED rows (support
// needs the full record) and every notification type, newest-first, paginated.
// Extracted as a handler factory so the user-scoping (404), dismissed-inclusion,
// pagination, and type-filter contracts are testable without a live DB. Never
// writes — strictly read-only.

export interface AdminUserNotificationsDeps {
  getUser: (id: string) => Promise<{ id: string } | undefined>;
  listNotifications: (
    userId: string,
    limit: number,
    offset: number,
    type: string | null,
  ) => Promise<UserNotification[]>;
}

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 30;

export function createAdminUserNotificationsHandler(deps: AdminUserNotificationsDeps) {
  return async (req: Request, res: Response) => {
    try {
      const user = await deps.getUser(getParam(req, "id"));
      if (!user) return res.status(404).json({ message: "User not found" });

      const limit = Math.min(Math.max(queryInt(req.query.limit, DEFAULT_LIMIT), 1), MAX_LIMIT);
      const offset = Math.max(queryInt(req.query.offset, 0), 0);
      const typeRaw = queryString(req.query.type);
      const type = typeRaw && typeRaw.trim() ? typeRaw.trim() : null;

      // Fetch one extra row to tell the client whether another page exists,
      // without a second count query.
      const rows = await deps.listNotifications(user.id, limit + 1, offset, type);
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;

      return res.json({
        notifications: page.map((r) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          body: r.body,
          referenceType: r.referenceType,
          referenceId: r.referenceId,
          url: r.url,
          createdAt: r.createdAt,
          readAt: r.readAt,
          dismissedAt: r.dismissedAt,
        })),
        hasMore,
      });
    } catch (e) {
      return res.status(500).json({ message: getErrorMessage(e) });
    }
  };
}
