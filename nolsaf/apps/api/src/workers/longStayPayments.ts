/**
 * Long-stay timing (docs/LONG_STAY_RENTALS.md, milestone 6), every 15 minutes:
 *  - a signed lease whose first month was not paid within 48 hours is closed,
 *    and both sides are told (a checkout opened in time gets 30 more minutes);
 *  - a reserved tenancy whose move-in day has come opens its move-in step.
 * Runs only on the leader instance, like the other workers.
 */
import { prisma } from "@nolsaf/prisma";
import { notifyOwner, notifyUser } from "../lib/notifications.js";
import { lapseUnansweredReservations } from "../lib/longStay/offerService.js";
import { expireUnpaidTenancies, openMoveInDay } from "../lib/longStay/payment.js";
import { autoConfirmMoveIns } from "../lib/longStay/moveIn.js";
import { sweepTenancyEndings } from "../lib/longStay/lifecycle.js";
import { escalateOverdueClaims } from "../lib/longStay/claims.js";
import { notifyAdmins } from "../lib/notifications.js";
import { todayInEat } from "../lib/longStay/listing.js";

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;

async function propertyTitle(propertyId: number): Promise<string | null> {
  const p = await prisma.property.findUnique({ where: { id: propertyId }, select: { title: true } });
  return p?.title ?? null;
}

export async function runLongStayPayments(now = new Date()) {
  // Reservations the landlord left unanswered for 24 hours lapse.
  for (const lapsed of await lapseUnansweredReservations(prisma, now)) {
    const property = await prisma.property.findUnique({ where: { id: lapsed.propertyId }, select: { title: true } });
    await notifyUser(lapsed.tenantId, "long_stay_reservation_lapsed", { propertyTitle: property?.title ?? null }).catch(() => undefined);
    await notifyOwner(lapsed.landlordId, "long_stay_reservation_lapsed_owner", { propertyTitle: property?.title ?? null }).catch(() => undefined);
  }
  const expired = await expireUnpaidTenancies(prisma, now, async (tenancy) => {
    const title = await propertyTitle(tenancy.propertyId);
    await notifyUser(tenancy.tenantId, "long_stay_payment_expired", { propertyTitle: title }).catch(() => undefined);
    await notifyOwner(tenancy.landlordId, "long_stay_payment_expired_owner", { propertyTitle: title }).catch(() => undefined);
  });
  const moveIn = await openMoveInDay(prisma, todayInEat(now));
  // One side confirmed and the other stayed silent 72 hours: let it on that confirmation.
  const confirmed = await autoConfirmMoveIns(prisma, now, async (tenancy) => {
    await notifyAdmins("long_stay_move_in_silent", { tenancyRef: tenancy.publicRef }).catch(() => undefined);
  });
  if (confirmed.auto) {
    await notifyAdmins("long_stay_payout_ready", { count: confirmed.auto, auto: true }).catch(() => undefined);
  }
  // Past the end with no move-out: overdue. Entering the notice window: one renewal reminder.
  await sweepTenancyEndings(prisma, todayInEat(now), async (kind, tenancy) => {
    const title = await propertyTitle(tenancy.propertyId);
    if (kind === "overdue") {
      await notifyUser(tenancy.tenantId, "long_stay_overdue", { propertyTitle: title }).catch(() => undefined);
      await notifyOwner(tenancy.landlordId, "long_stay_overdue_owner", { propertyTitle: title }).catch(() => undefined);
      await notifyAdmins("long_stay_overdue_admin", { tenancyRef: tenancy.publicRef, propertyTitle: title }).catch(() => undefined);
    } else {
      await notifyUser(tenancy.tenantId, "long_stay_renewal_reminder", { propertyTitle: title }).catch(() => undefined);
      await notifyOwner(tenancy.landlordId, "long_stay_renewal_reminder_owner", { propertyTitle: title }).catch(() => undefined);
    }
  });
  // Claims unpaid past 14 days: pause the landlord, recover from future payouts.
  await escalateOverdueClaims(prisma, now, async (claim) => {
    await notifyAdmins("long_stay_claim_overdue", { claimId: claim.id }).catch(() => undefined);
    await notifyOwner(claim.landlordId, "long_stay_claim_overdue_owner", { amount: Number(claim.amount), currency: claim.currency }).catch(() => undefined);
  });
  if (expired.closed || moveIn.opened) {
    console.log(`[longStayPayments] closed ${expired.closed} unpaid, opened ${moveIn.opened} move-in days`);
  }
}

export function startLongStayPaymentsWorker({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}): void {
  void runLongStayPayments().catch((err) => console.error("[longStayPayments] startup run failed:", err?.message));
  setInterval(() => {
    void runLongStayPayments().catch((err) => console.error("[longStayPayments] run failed:", err?.message));
  }, intervalMs);
  console.log(`[longStayPayments] Started, every ${intervalMs / 60000} min`);
}
