import type { Pool } from "pg";
import type { WebSocket } from "ws";

export interface SessionRow {
  sid: string;
  userId: string;
  userAgent: string | null;
  ip: string | null;
  createdAt: string | null;
  lastSeenAt: string | null;
  expire: string | null;
}

export function parseUserAgent(ua: string | null | undefined): { device: string; browser: string } {
  if (!ua) return { device: "Unknown", browser: "Unknown" };
  let device = "Desktop";
  if (/iPad/i.test(ua)) device = "iPad";
  else if (/iPhone/i.test(ua)) device = "iPhone";
  else if (/Android/i.test(ua)) device = /Mobile/i.test(ua) ? "Android Phone" : "Android Tablet";
  else if (/Mac OS X|Macintosh/i.test(ua)) device = "Mac";
  else if (/Windows/i.test(ua)) device = "Windows";
  else if (/Linux/i.test(ua)) device = "Linux";

  let browser = "Browser";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(ua)) browser = "Opera";
  else if (/Firefox\//i.test(ua)) browser = "Firefox";
  else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
  else if (/Safari\//i.test(ua)) browser = "Safari";
  return { device, browser };
}

export function deviceLabel(ua: string | null | undefined): string {
  const { device, browser } = parseUserAgent(ua);
  return `${browser} on ${device}`;
}

export async function getSessionsForUser(pool: Pool, userId: string): Promise<SessionRow[]> {
  const result = await pool.query(
    `SELECT sid, sess, expire FROM session
     WHERE sess->>'userId' = $1 AND expire > now()
     ORDER BY COALESCE(sess->>'lastSeenAt', sess->>'createdAt', '') DESC`,
    [userId]
  );
  return result.rows.map((r: any) => ({
    sid: r.sid,
    userId: r.sess?.userId,
    userAgent: r.sess?.userAgent ?? null,
    ip: r.sess?.ip ?? null,
    createdAt: r.sess?.createdAt ?? null,
    lastSeenAt: r.sess?.lastSeenAt ?? null,
    expire: r.expire?.toISOString?.() ?? null,
  }));
}

export async function deleteSession(pool: Pool, sid: string): Promise<void> {
  await pool.query("DELETE FROM session WHERE sid = $1", [sid]);
}

export async function deleteSessionsForUser(pool: Pool, userId: string, exceptSid: string): Promise<number> {
  const result = await pool.query(
    "DELETE FROM session WHERE sess->>'userId' = $1 AND sid <> $2",
    [userId, exceptSid]
  );
  return result.rowCount ?? 0;
}

// ----- Presence map -----

export interface PresenceEntry {
  userId: string;
  tabs: number;
  connectedAt: number;
  lastActivityAt: number;
  page: string | null;
}

export interface PresenceMap {
  add(ws: WebSocket, userId: string): void;
  remove(ws: WebSocket): { userId: string; remaining: number } | null;
  setPage(ws: WebSocket, page: string | null): void;
  touch(ws: WebSocket): void;
  snapshot(): PresenceEntry[];
  getUserId(ws: WebSocket): string | undefined;
  hasUser(userId: string): boolean;
}

export function createPresenceMap(now: () => number = () => Date.now()): PresenceMap {
  type Conn = { userId: string; connectedAt: number; lastActivityAt: number; page: string | null };
  const conns = new Map<WebSocket, Conn>();
  const byUser = new Map<string, Set<WebSocket>>();

  return {
    add(ws, userId) {
      const t = now();
      conns.set(ws, { userId, connectedAt: t, lastActivityAt: t, page: null });
      let set = byUser.get(userId);
      if (!set) { set = new Set(); byUser.set(userId, set); }
      set.add(ws);
    },
    remove(ws) {
      const c = conns.get(ws);
      if (!c) return null;
      conns.delete(ws);
      const set = byUser.get(c.userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) byUser.delete(c.userId);
        return { userId: c.userId, remaining: set.size };
      }
      return { userId: c.userId, remaining: 0 };
    },
    setPage(ws, page) {
      const c = conns.get(ws);
      if (c) { c.page = page; c.lastActivityAt = now(); }
    },
    touch(ws) {
      const c = conns.get(ws);
      if (c) c.lastActivityAt = now();
    },
    snapshot() {
      const out: PresenceEntry[] = [];
      byUser.forEach((set, userId) => {
        let connectedAt = Infinity;
        let lastActivityAt = 0;
        let page: string | null = null;
        set.forEach((ws) => {
          const c = conns.get(ws);
          if (!c) return;
          if (c.connectedAt < connectedAt) connectedAt = c.connectedAt;
          if (c.lastActivityAt > lastActivityAt) {
            lastActivityAt = c.lastActivityAt;
            page = c.page;
          }
        });
        out.push({
          userId,
          tabs: set.size,
          connectedAt: connectedAt === Infinity ? now() : connectedAt,
          lastActivityAt: lastActivityAt || now(),
          page,
        });
      });
      return out;
    },
    getUserId(ws) {
      return conns.get(ws)?.userId;
    },
    hasUser(userId) {
      return (byUser.get(userId)?.size ?? 0) > 0;
    },
  };
}
