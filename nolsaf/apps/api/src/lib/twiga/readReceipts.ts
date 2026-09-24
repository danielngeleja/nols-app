import { prisma } from "@nolsaf/prisma";

/*
 * Read receipts for Twiga support chats.
 *
 * Backed by chatbot_conversations.agentLastReadAt / visitorLastReadAt, added in
 * migration 20260916150000_add_twiga_read_receipts.
 *
 * Deliberately raw SQL, each call wrapped so a failure returns quietly:
 *   - Before the migration is applied the columns do not exist. Selecting them
 *     through Prisma would throw inside the visitor's poll and the agent's reply
 *     transaction, taking the whole chat down for a cosmetic feature. Here the
 *     receipt is simply absent and the ticks fall back to "delivered".
 *   - Raw updates do not touch updatedAt, so reading a thread never reorders
 *     the admin queue.
 */

export type Receipts = { agentLastReadAt: Date | null; visitorLastReadAt: Date | null };

/** An admin opened or replied in the thread. */
export async function markAgentRead(conversationId: number): Promise<Date | null> {
  try {
    await prisma.$executeRaw`UPDATE chatbot_conversations SET agentLastReadAt = NOW(3) WHERE id = ${conversationId}`;
    return new Date();
  } catch {
    return null;
  }
}

/**
 * The visitor has the chat open and visible. Written at most every 15 seconds
 * per conversation, since every open widget polls. Returns true when a new
 * receipt was actually recorded.
 */
export async function markVisitorRead(conversationId: number): Promise<boolean> {
  try {
    const changed = await prisma.$executeRaw`
      UPDATE chatbot_conversations
      SET visitorLastReadAt = NOW(3)
      WHERE id = ${conversationId}
        AND (visitorLastReadAt IS NULL OR visitorLastReadAt < NOW(3) - INTERVAL 15 SECOND)`;
    return Number(changed) > 0;
  } catch {
    return false;
  }
}

export async function readReceipts(conversationId: number): Promise<Receipts> {
  try {
    const rows = await prisma.$queryRaw<Array<{ agentLastReadAt: Date | null; visitorLastReadAt: Date | null }>>`
      SELECT agentLastReadAt, visitorLastReadAt FROM chatbot_conversations WHERE id = ${conversationId} LIMIT 1`;
    return { agentLastReadAt: rows[0]?.agentLastReadAt ?? null, visitorLastReadAt: rows[0]?.visitorLastReadAt ?? null };
  } catch {
    return { agentLastReadAt: null, visitorLastReadAt: null };
  }
}
