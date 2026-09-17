/**
 * twigaAutoResolve — background worker
 *
 * Resolves Twiga support threads that an agent took over and then left: status
 * AGENT_ACTIVE with no message from the visitor or the agent for 12 hours (see
 * AGENT_ACTIVE_AUTO_RESOLVE_MS). Nothing is deleted. The thread moves to the
 * Resolved view, keeps its transcript, and a new visitor message goes to Twiga,
 * which can hand it to a person again.
 *
 * The cut-off reads message times, not the conversation's updatedAt: opening a
 * thread writes a read receipt, which bumps updatedAt, and merely looking at a
 * chat must not keep it open.
 */
import { prisma } from "@nolsaf/prisma";
import { AGENT_ACTIVE_AUTO_RESOLVE_MS, CONVERSATION_STATUS } from "../lib/twiga/handoff.js";

/** Milliseconds: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

/** Enough for any real backlog; a larger one simply drains over several ticks. */
const BATCH = 200;

type StartOptions = { intervalMs?: number };

export async function autoResolveQuietTwigaThreads(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AGENT_ACTIVE_AUTO_RESOLVE_MS);

  // @ts-ignore - Prisma Client needs regeneration after schema changes
  const quiet: Array<{ id: number }> = await prisma.chatbotConversation.findMany({
    where: {
      status: CONVERSATION_STATUS.AGENT_ACTIVE,
      // Guard for a thread with no messages at all: fall back to its own age.
      createdAt: { lt: cutoff },
      messages: { none: { createdAt: { gte: cutoff } } },
    },
    select: { id: true },
    take: BATCH,
  });
  if (quiet.length === 0) return 0;

  // Re-check the status in the write so a reply that lands mid-tick wins.
  // @ts-ignore - Prisma Client needs regeneration after schema changes
  const result = await prisma.chatbotConversation.updateMany({
    where: { id: { in: quiet.map((c) => c.id) }, status: CONVERSATION_STATUS.AGENT_ACTIVE },
    data: { status: CONVERSATION_STATUS.RESOLVED, resolvedAt: now, needsFollowUp: false },
  });
  return result.count;
}

async function runOnce(): Promise<void> {
  const resolved = await autoResolveQuietTwigaThreads();
  if (resolved > 0) console.log(`[twigaAutoResolve] Resolved ${resolved} quiet support thread(s).`);
}

export function startTwigaAutoResolveWorker({ intervalMs = DEFAULT_INTERVAL_MS }: StartOptions = {}): void {
  void runOnce().catch((err) => console.error("[twigaAutoResolve] Error on startup run:", err?.message));
  setInterval(() => {
    void runOnce().catch((err) => console.error("[twigaAutoResolve] Error:", err?.message));
  }, intervalMs);
  console.log(`[twigaAutoResolve] Started, interval: ${intervalMs / 60000}min`);
}
