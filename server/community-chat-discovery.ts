import type { RequestHandler } from "express";
import type { CommunityMessage } from "@shared/schema";

type DiscoveryUser = { id: string; role: string; chatBanned: boolean | null };
export function literalSearchPattern(query: string) {
  return `%${query.replace(/[\\%_]/g, "\\$&")}%`;
}

export interface CommunityDiscoveryDeps {
  getUser(id: string): Promise<DiscoveryUser | undefined>;
  search(query: string, limit: number): Promise<{ messages: CommunityMessage[]; truncated: boolean }>;
  getPin(): Promise<CommunityMessage | null>;
  setPin(messageId: string, userId: string): Promise<CommunityMessage | null>;
  clearPin(): Promise<void>;
  broadcast(data: { type: string }): void;
  audit(action: string, userId: string, messageId?: string): void;
  reportError(error: unknown): void;
}

export function createCommunityDiscoveryHandlers(deps: CommunityDiscoveryDeps) {
  const handler = (action: RequestHandler): RequestHandler => async (req, res, next) => {
    try {
      if (!req.session?.userId) return void res.status(401).json({ error: "Sign in to view Community Chat" });
      await action(req, res, next);
    } catch (error) {
      deps.reportError(error);
      res.status(500).json({ error: "Community Chat could not be loaded. Please try again." });
    }
  };
  const search = handler(async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (query.length < 2 || query.length > 120) {
      return void res.status(400).json({ error: "Search must contain between 2 and 120 characters" });
    }
    const rawLimit = req.query.limit === undefined ? 25 : Number(req.query.limit);
    if (Array.isArray(req.query.limit) || !Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 50) {
      return void res.status(400).json({ error: "Search limit must be between 1 and 50" });
    }
    res.set("Cache-Control", "no-store").json(await deps.search(query, rawLimit));
  });
  const getPin = handler(async (_req, res) => {
    res.set("Cache-Control", "no-store").json({ message: await deps.getPin() });
  });
  const requirePinAdmin = async (userId: string) => {
    const user = await deps.getUser(userId);
    return user && (user.role === "admin" || user.role === "master_admin") && !user.chatBanned;
  };
  const setPin = handler(async (req, res) => {
    const userId = req.session.userId!;
    if (!await requirePinAdmin(userId)) return void res.status(403).json({ error: "Only community admins can pin messages" });
    const messageId = typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";
    if (!messageId || messageId.length > 100) return void res.status(400).json({ error: "Choose a message to pin" });
    const message = await deps.setPin(messageId, userId);
    if (!message) return void res.status(404).json({ error: "This message is no longer available" });
    deps.audit("community_message_pinned", userId, messageId);
    deps.broadcast({ type: "community_pin_changed" });
    res.json({ message });
  });
  const clearPin = handler(async (req, res) => {
    const userId = req.session.userId!;
    if (!await requirePinAdmin(userId)) return void res.status(403).json({ error: "Only community admins can unpin messages" });
    await deps.clearPin();
    deps.audit("community_message_unpinned", userId);
    deps.broadcast({ type: "community_pin_changed" });
    res.json({ message: null });
  });
  return { search, getPin, setPin, clearPin };
}
