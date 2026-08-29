/**
 * expireAgentHolds — background worker
 *
 * Flips agent request-to-book holds whose window has lapsed (PENDING with
 * holdExpiresAt in the past) to EXPIRED, releasing their HELD reservations.
 *
 * Availability does NOT depend on this: the shared kernel already ignores an
 * expired hold. This worker only keeps the hotel's approval queue honest so a
 * request nobody can still accept does not linger as actionable. Cheap when
 * idle — a single indexed query per tick when nothing has expired.
 */
import { prisma } from "@nolsaf/prisma";
import { expireAgentHolds } from "../lib/nrmsAgentInventory.js";
import { expireUnpaidAgentBookings } from "../lib/nrmsAgentPayment.js";

/** Milliseconds: 5 minutes */
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

type StartOptions = { intervalMs?: number };

async function runOnce(): Promise<void> {
  const expired = await expireAgentHolds(prisma);
  if (expired > 0) console.log(`[expireAgentHolds] Expired ${expired} lapsed agent hold(s).`);
  const unpaidExpired = await expireUnpaidAgentBookings(prisma);
  if (unpaidExpired > 0) console.log(`[expireAgentHolds] Released ${unpaidExpired} unpaid agent booking(s).`);
}

export function startExpireAgentHoldsWorker({ intervalMs = DEFAULT_INTERVAL_MS }: StartOptions = {}): void {
  void runOnce().catch((err) => console.error("[expireAgentHolds] Error on startup run:", err?.message));
  setInterval(() => {
    void runOnce().catch((err) => console.error("[expireAgentHolds] Error:", err?.message));
  }, intervalMs);
  console.log(`[expireAgentHolds] Started — interval: ${intervalMs / 60000}min`);
}
