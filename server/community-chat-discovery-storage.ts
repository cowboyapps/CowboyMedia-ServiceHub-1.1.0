import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "./db";
import { communityChatPins, communityMessages } from "@shared/schema";
import { literalSearchPattern } from "./community-chat-discovery";

export async function searchCommunityMessages(query: string, limit: number) {
  const pattern = literalSearchPattern(query);
  const messages = await db.select().from(communityMessages)
    .where(or(ilike(communityMessages.content, pattern), ilike(communityMessages.chatUsername, pattern)))
    .orderBy(desc(communityMessages.createdAt), desc(communityMessages.id))
    .limit(limit + 1);
  return { messages: messages.slice(0, limit), truncated: messages.length > limit };
}

export async function getCommunityPin() {
  const [result] = await db.select({ message: communityMessages }).from(communityChatPins)
    .innerJoin(communityMessages, eq(communityChatPins.messageId, communityMessages.id))
    .where(eq(communityChatPins.id, "singleton"));
  return result?.message ?? null;
}

export async function setCommunityPin(messageId: string, userId: string) {
  return db.transaction(async tx => {
    // Serialize safely against moderation deleting the target mid-pin.
    const [message] = await tx.select().from(communityMessages)
      .where(eq(communityMessages.id, messageId)).for("key share");
    if (!message) return null;
    await tx.insert(communityChatPins).values({
      id: "singleton", messageId, pinnedBy: userId,
    }).onConflictDoUpdate({
      target: communityChatPins.id,
      set: { messageId, pinnedBy: userId, createdAt: new Date() },
    });
    return message;
  });
}

export async function clearCommunityPin() {
  await db.delete(communityChatPins).where(eq(communityChatPins.id, "singleton"));
}
