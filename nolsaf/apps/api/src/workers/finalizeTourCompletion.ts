/**
 * finalizeTourCompletion: background worker
 *
 * A trip the operator finished (OPERATOR_COMPLETED) becomes COMPLETED when the
 * traveller confirms it, or here: once its dispute window has closed with no
 * open case. Without this, a traveller who never taps "confirm" left the
 * operator's balance unclaimable forever.
 *
 * The window (disputeWindowEndsAt) is 48 hours after the later of the timetable
 * being finished and the trip's last day (tourPayoutPolicy.balanceDisputeDeadline).
 * canFinalizeTour is the single rule; this worker only applies it.
 *
 * Each booking is flipped with a conditional update (still OPERATOR_COMPLETED),
 * so a traveller confirming at the same moment can never be overwritten.
 */
import { prisma } from "@nolsaf/prisma";
import { canFinalizeTour } from "../lib/tourLifecycle.js";
import { notifyUser } from "../lib/notifications.js";

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const BATCH_SIZE = 100;
const OPEN_CASE_STATUSES = ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"];

export async function finalizeDueTourBookings(now = new Date()): Promise<{ checked: number; finalized: number }> {
  const due = await prisma.tourBooking.findMany({
    where: { status: "OPERATOR_COMPLETED", disputeWindowEndsAt: { lte: now } },
    select: {
      id: true,
      bookingCode: true,
      status: true,
      customerConfirmedAt: true,
      disputeWindowEndsAt: true,
      operator: { select: { userId: true } },
      _count: { select: { cases: { where: { status: { in: OPEN_CASE_STATUSES } } } } },
    },
    orderBy: { disputeWindowEndsAt: "asc" },
    take: BATCH_SIZE,
  });

  let finalized = 0;
  for (const booking of due) {
    if (!canFinalizeTour({ ...booking, openCaseCount: booking._count.cases }, now)) continue;
    const result = await prisma.tourBooking.updateMany({
      where: { id: booking.id, status: "OPERATOR_COMPLETED" },
      data: { status: "COMPLETED", completedAt: now },
    });
    if (result.count !== 1) continue;
    finalized += 1;
    try {
      await prisma.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: "TOUR_AUTO_FINALIZED",
          entity: `tour-booking:${booking.id}`,
          entityId: booking.id,
          afterJson: { status: "COMPLETED", disputeWindowEndsAt: booking.disputeWindowEndsAt?.toISOString() ?? null, finalizedAt: now.toISOString() } as any,
        },
      });
    } catch {
      // An audit write never blocks the lifecycle.
    }
    if (booking.operator?.userId) {
      void notifyUser(booking.operator.userId, "agent_balance_claimable", {
        tourBookingId: booking.id,
        bookingCode: booking.bookingCode,
      }).catch(() => {});
    }
  }
  return { checked: due.length, finalized };
}

export function startFinalizeTourCompletionWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const result = await finalizeDueTourBookings();
      if (result.finalized > 0) {
        console.log(`[tour-finalize] completed ${result.finalized} of ${result.checked} trips whose dispute window closed`);
      }
    } catch (error) {
      console.error("[tour-finalize] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[tour-finalize] started, interval ${intervalMs / 1000}s`);
}
