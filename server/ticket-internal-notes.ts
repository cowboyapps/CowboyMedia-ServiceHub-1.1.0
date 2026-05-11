import type { TicketMessage, User } from "../shared/schema";

export const INTERNAL_NOTE_EDIT_WINDOW_MS = 5 * 60 * 1000;

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

export function canPostInternalNote(role: string | null | undefined): boolean {
  return isAdminRole(role);
}

export function parseIsInternalFlag(value: unknown): boolean {
  return value === true || value === "true";
}

export function filterMessagesForViewer<T extends Pick<TicketMessage, "isInternal">>(
  messages: T[],
  viewerRole: string | null | undefined,
): T[] {
  if (isAdminRole(viewerRole)) return messages;
  return messages.filter((m) => !m.isInternal);
}

export type InternalNoteMutationCheck =
  | { ok: true }
  | { ok: false; status: 400 | 403 | 404; message: string };

export function canMutateInternalNote(
  msg: Pick<TicketMessage, "id" | "ticketId" | "senderId" | "isInternal" | "createdAt"> | null | undefined,
  ticketId: string,
  actor: Pick<User, "id" | "role"> | null | undefined,
  now: Date = new Date(),
): InternalNoteMutationCheck {
  if (!msg || msg.ticketId !== ticketId) {
    return { ok: false, status: 404, message: "Message not found" };
  }
  if (!msg.isInternal) {
    return { ok: false, status: 400, message: "Only internal notes can be modified" };
  }
  if (!actor || !isAdminRole(actor.role)) {
    return { ok: false, status: 403, message: "Admin access required" };
  }
  if (msg.senderId !== actor.id) {
    return { ok: false, status: 403, message: "You can only modify your own internal notes" };
  }
  const ageMs = now.getTime() - new Date(msg.createdAt).getTime();
  if (ageMs > INTERNAL_NOTE_EDIT_WINDOW_MS) {
    return { ok: false, status: 403, message: "Edit window has expired (5 minutes)" };
  }
  return { ok: true };
}
