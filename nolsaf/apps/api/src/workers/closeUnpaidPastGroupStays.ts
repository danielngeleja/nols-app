/**
 * closeUnpaidPastGroupStays — background worker
 *
 * expireGroupBookingDeposits only catches offers that carry a depositDueAt.
 * Requests that were never priced, or were assigned without a deadline, stay
 * PENDING or AWAITING_DEPOSIT forever once their dates pass, still holding
 * the owner's rooms and still showing as live on every screen.
 *
 * Once the whole arrival day (East Africa Time) has passed with no deposit,
 * this worker cancels the request, frees the held dates, closes any open
 * owner offers and tells the guest and the assigned owner.
 */
import { prisma } from "@nolsaf/prisma";
import { notifyUser } from "../lib/notifications.js";
import { groupStayHoldNotes } from "../lib/groupStayAvailabilityBlocks.js";

const DEFAULT_INTERVAL_MS = 30 * 60 * 1000;
const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;
/** A deposit checkout started this recently may still be confirming. Leave it alone. */
export const PAYMENT_GRACE_MS = 2 * 60 * 60 * 1000;
export const CLOSABLE_STATUSES = ["PENDING", "AWAITING_DEPOSIT"];
export const CANCEL_REASON = "Closed automatically: the arrival date passed and the deposit was never paid.";

/** Midnight East Africa Time of the day containing `now`, as a UTC instant. */
export function startOfEatDay(now: Date): Date {
  const shifted = new Date(now.getTime() + EAT_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - EAT_OFFSET_MS);
}

type Candidate = {
  status: string;
  depositPaid: boolean;
  checkIn: Date | null;
  paymentRef: string | null;
  checkoutSessionId: string | null;
  updatedAt: Date;
};

/** True when the stay's arrival day is over, nothing was paid and no payment is still confirming. */
export function shouldCloseUnpaidStay(stay: Candidate, now: Date): boolean {
  if (!CLOSABLE_STATUSES.includes(String(stay.status).toUpperCase())) return false;
  if (stay.depositPaid) return false;
  if (!stay.checkIn || stay.checkIn.getTime() >= startOfEatDay(now).getTime()) return false;
  const paymentStarted = Boolean(stay.paymentRef || stay.checkoutSessionId);
  if (paymentStarted && now.getTime() - stay.updatedAt.getTime() < PAYMENT_GRACE_MS) return false;
  return true;
}

export async function closeUnpaidPastGroupStays(now = new Date()): Promise<number> {
  const candidates = await prisma.groupBooking.findMany({
    where: {
      status: { in: CLOSABLE_STATUSES },
      depositPaid: false,
      checkIn: { lt: startOfEatDay(now) },
    },
    select: {
      id: true,
      status: true,
      depositPaid: true,
      checkIn: true,
      paymentRef: true,
      checkoutSessionId: true,
      updatedAt: true,
      userId: true,
      assignedOwnerId: true,
      confirmedPropertyId: true,
      toRegion: true,
      toDistrict: true,
    },
    take: 200,
  });

  let closed = 0;
  for (const stay of candidates) {
    if (!shouldCloseUnpaidStay(stay, now)) continue;
    try {
      // Guarded write: a deposit that lands between the read and here wins.
      const result = await prisma.groupBooking.updateMany({
        where: { id: stay.id, status: { in: CLOSABLE_STATUSES }, depositPaid: false },
        data: { status: "CANCELED", cancelReason: CANCEL_REASON, canceledAt: now, isOpenForClaims: false },
      });
      if (result.count !== 1) continue;
      closed += 1;

      if (stay.confirmedPropertyId) {
        await prisma.propertyAvailabilityBlock.deleteMany({
          where: { propertyId: stay.confirmedPropertyId, source: "GROUP_STAY", notes: groupStayHoldNotes(stay.id) },
        }).catch((err: any) => console.warn(`[closeUnpaidPastGroupStays] Could not free dates for #${stay.id}:`, err?.message));
      }

      await prisma.groupBookingClaim.updateMany({
        where: { groupBookingId: stay.id, status: { in: ["PENDING", "REVIEWING"] } },
        data: { status: "REJECTED", reviewedAt: now },
      }).catch(() => {});

      await prisma.groupBookingMessage.create({
        data: {
          groupBookingId: stay.id,
          senderRole: "SYSTEM",
          senderName: "System",
          messageType: "Auto-Closed",
          body: CANCEL_REASON,
          isInternal: true,
        },
      }).catch(() => {});

      const destination = [stay.toDistrict, stay.toRegion].filter(Boolean).join(", ");
      await notifyUser(stay.userId, "group_stay_update", {
        title: "Group stay request closed",
        body: `Your group stay${destination ? ` to ${destination}` : ""} was closed because the arrival date passed and the deposit was not paid. You can send a new request any time.`,
        groupBookingId: stay.id,
      }).catch(() => {});

      if (stay.assignedOwnerId) {
        await notifyUser(stay.assignedOwnerId, "group_stay_update", {
          title: "Group stay closed, dates released",
          body: `A group stay${destination ? ` in ${destination}` : ""} was closed because the guest never paid the deposit and the arrival date has passed. Any rooms held for it are free again.`,
          groupBookingId: stay.id,
        }).catch(() => {});
      }

      console.log(`[closeUnpaidPastGroupStays] Closed group booking #${stay.id}`);
    } catch (err: any) {
      console.error(`[closeUnpaidPastGroupStays] Failed on #${stay.id}:`, err?.message || err);
    }
  }
  return closed;
}

export function startCloseUnpaidPastGroupStays({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  void closeUnpaidPastGroupStays().catch((err) => console.error("[closeUnpaidPastGroupStays] Startup run failed:", err?.message));
  setInterval(() => {
    void closeUnpaidPastGroupStays().catch((err) => console.error("[closeUnpaidPastGroupStays] Run failed:", err?.message));
  }, intervalMs);
  console.log(`[closeUnpaidPastGroupStays] Started, every ${intervalMs / 60000} min`);
}
