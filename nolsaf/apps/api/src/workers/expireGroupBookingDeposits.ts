/**
 * expireGroupBookingDeposits — background worker
 *
 * Group stay offers move to AWAITING_DEPOSIT once a customer accepts an
 * owner's offer (auction-confirm), with a 24h depositDueAt deadline and a
 * propertyAvailabilityBlock holding the dates for the assigned owner.
 *
 * If the deposit is not paid before depositDueAt, this worker:
 *  - flips the booking to EXPIRED
 *  - releases the propertyAvailabilityBlock created for the offer
 *  - notifies the customer (offer expired, request a new one)
 *  - notifies the assigned owner (dates released)
 */
import { prisma } from "@nolsaf/prisma";
import { notifyUser } from "../lib/notifications.js";
import { notifyAgencyPartnerAboutGroup } from "../lib/salesAgencyGroups.js";

type StartOptions = {
  /** How often the cleanup runs. Default: 15 minutes. */
  intervalMs?: number;
};

/** Milliseconds: 15 minutes */
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

async function expireGroupBookingDeposits(): Promise<void> {
  const now = new Date();

  const expired = await prisma.groupBooking.findMany({
    where: {
      status: "AWAITING_DEPOSIT",
      depositPaid: false,
      depositDueAt: { lt: now },
    },
    select: {
      id: true,
      userId: true,
      assignedOwnerId: true,
      confirmedPropertyId: true,
      toRegion: true,
      toDistrict: true,
      paymentMode: true,
    },
  });

  for (const booking of expired) {
    try {
      await prisma.groupBooking.update({
        where: { id: booking.id },
        data: { status: "EXPIRED", isOpenForClaims: false },
      });

      if (booking.confirmedPropertyId) {
        await prisma.propertyAvailabilityBlock.deleteMany({
          where: {
            propertyId: booking.confirmedPropertyId,
            source: "GROUP_STAY",
            notes: `Reserved for group stay request #${booking.id}`,
          },
        });
      }

      const destination = [booking.toDistrict, booking.toRegion].filter(Boolean).join(", ");

      const isAgencyFull = (booking as any).paymentMode === "FULL";
      await notifyUser(booking.userId, "group_stay_update", {
        title: "Group stay offer expired",
        body: isAgencyFull
          ? `The payment window for your group stay${destination ? ` to ${destination}` : ""} has ended and the held dates were released. Your NoLSAF sales partner can prepare a new request if you still want to travel.`
          : `Your 24-hour window to pay the deposit for group stay #${booking.id}${destination ? ` to ${destination}` : ""} has expired. Please request a new group stay if you'd still like to book.`,
        groupBookingId: booking.id,
      }).catch(() => {});
      if (isAgencyFull) await notifyAgencyPartnerAboutGroup(prisma, booking.id, "expired");

      if (booking.assignedOwnerId) {
        await notifyUser(booking.assignedOwnerId, "group_stay_update", {
          title: "Group stay dates released",
          body: `The customer did not pay the deposit for group stay #${booking.id}${destination ? ` (${destination})` : ""} in time. The held dates have been released.`,
          groupBookingId: booking.id,
        }).catch(() => {});
      }

      console.log(`[expireGroupBookingDeposits] Expired group booking #${booking.id}`);
    } catch (err: any) {
      console.error(`[expireGroupBookingDeposits] Failed to expire booking #${booking.id}:`, err?.message || err);
    }
  }
}

export function startExpireGroupBookingDeposits({ intervalMs = DEFAULT_INTERVAL_MS }: StartOptions = {}): void {
  void expireGroupBookingDeposits().catch((err) =>
    console.error("[expireGroupBookingDeposits] Error on startup run:", err?.message)
  );

  setInterval(() => {
    void expireGroupBookingDeposits().catch((err) =>
      console.error("[expireGroupBookingDeposits] Error:", err?.message)
    );
  }, intervalMs);

  console.log(`[expireGroupBookingDeposits] Started — interval: ${intervalMs / 60000}min`);
}
