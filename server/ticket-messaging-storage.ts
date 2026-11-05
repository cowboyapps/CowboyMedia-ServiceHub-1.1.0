import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { db } from "./db";
import { ticketMessages, ticketMessageReactions, users, type Ticket, type User } from "@shared/schema";
import { TICKET_REACTION_EMOJIS, type TicketReactionSummary } from "@shared/ticket-reactions";

export async function getTicketReactions(messageIds: string[], actorId: string): Promise<Record<string, TicketReactionSummary[]>> {
  if (!messageIds.length) return {};
  const rows = await db.select({
    messageId: ticketMessageReactions.messageId,
    emoji: ticketMessageReactions.emoji,
    count: sql<number>`count(*)::int`,
    reacted: sql<boolean>`bool_or(${ticketMessageReactions.userId} = ${actorId})`,
  }).from(ticketMessageReactions)
    .innerJoin(ticketMessages, eq(ticketMessages.id, ticketMessageReactions.messageId))
    .where(and(inArray(ticketMessageReactions.messageId, messageIds), eq(ticketMessages.isInternal, false)))
    .groupBy(ticketMessageReactions.messageId, ticketMessageReactions.emoji);
  const result: Record<string, TicketReactionSummary[]> = {};
  for (const row of rows) (result[row.messageId] ??= []).push({ emoji: row.emoji, count: row.count, reacted: row.reacted });
  for (const reactions of Object.values(result)) reactions.sort((a, b) =>
    TICKET_REACTION_EMOJIS.indexOf(a.emoji) - TICKET_REACTION_EMOJIS.indexOf(b.emoji));
  return result;
}

export async function setTicketReaction(ticketId: string, messageId: string, actorId: string, emoji: string | null) {
  // Lock the parent so a concurrent delete cannot leave an orphan reaction.
  // Set/clear rather than toggle makes retrying an interrupted request safe.
  return db.transaction(async tx => {
    const [message] = await tx.select().from(ticketMessages).where(and(
      eq(ticketMessages.id, messageId), eq(ticketMessages.ticketId, ticketId), eq(ticketMessages.isInternal, false),
    )).for("update");
    if (!message) return false;
    if (emoji === null) {
      await tx.delete(ticketMessageReactions).where(and(
        eq(ticketMessageReactions.messageId, messageId), eq(ticketMessageReactions.userId, actorId)));
    } else {
      await tx.insert(ticketMessageReactions).values({ messageId, userId: actorId, emoji })
        .onConflictDoUpdate({
          target: [ticketMessageReactions.messageId, ticketMessageReactions.userId],
          set: { emoji, createdAt: new Date() },
        });
    }
    return true;
  });
}

export async function markVisibleTicketMessagesRead(ticket: Ticket, actor: User, messageIds: string[]): Promise<boolean> {
  if (!messageIds.length) return false;
  const counterparty = actor.id === ticket.customerId
    ? and(ne(ticketMessages.senderId, ticket.customerId),
        sql`exists (select 1 from ${users} where ${users.id} = ${ticketMessages.senderId} and ${users.role} in ('admin', 'master_admin'))`)
    : eq(ticketMessages.senderId, ticket.customerId);
  const changed = await db.update(ticketMessages).set({ readAt: new Date() }).where(and(
    eq(ticketMessages.ticketId, ticket.id), eq(ticketMessages.isInternal, false),
    inArray(ticketMessages.id, messageIds), isNull(ticketMessages.readAt), counterparty,
  )).returning({ id: ticketMessages.id });
  return changed.length > 0;
}
