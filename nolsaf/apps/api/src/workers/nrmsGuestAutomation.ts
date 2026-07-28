import { typedPrisma as prisma } from "@nolsaf/prisma";
import { sendSms } from "../lib/sms.js";
import { runNrmsWorker } from "../lib/nrmsWorkerHealth.js";

const BATCH_SIZE = 20;
const webOrigin = () => String(process.env.WEB_ORIGIN || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/$/, "");

export async function processNrmsGuestAutomation(now = new Date()): Promise<{ expiredHolds: number; journeys: number; reviews: number; payments: number }> {
  let expiredHolds = 0;
  const staleHolds = await prisma.reservation.findMany({ where: { source: "DIRECT", status: "HELD", holdExpiresAt: { lte: now } }, select: { id: true }, take: BATCH_SIZE });
  for (const hold of staleHolds) {
    const changed = await prisma.reservation.updateMany({ where: { id: hold.id, status: "HELD", holdExpiresAt: { lte: now } }, data: { status: "EXPIRED" } }); if (!changed.count) continue;
    await prisma.$transaction([prisma.nrmsGuestPaymentRequest.updateMany({ where: { reservationId: hold.id, status: "PENDING" }, data: { status: "CANCELLED", cancelledAt: now } }), prisma.reservationEvent.create({ data: { reservationId: hold.id, type: "EXPIRED", data: { reason: "DIRECT_HOLD_TIMEOUT" } } })]); expiredHolds += 1;
  }
  let journeyCount = 0; let reviewCount = 0; let paymentCount = 0;
  const journeys = await prisma.nrmsJourneyDelivery.findMany({ where: { status: "QUEUED", scheduledAt: { lte: now } }, include: { template: true, guestProfile: { select: { phone: true } } }, orderBy: { scheduledAt: "asc" }, take: BATCH_SIZE });
  for (const delivery of journeys) {
    const claimed = await prisma.nrmsJourneyDelivery.updateMany({ where: { id: delivery.id, status: "QUEUED" }, data: { status: "SENDING", errorMessage: null } }); if (!claimed.count) continue;
    if (delivery.template.channel !== "SMS" || !delivery.guestProfile?.phone) { await prisma.nrmsJourneyDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", failedAt: now, errorMessage: delivery.template.channel !== "SMS" ? "Configured channel is not available" : "Guest phone is missing" } }); continue; }
    const result = await sendSms(delivery.guestProfile.phone, delivery.renderedMessage);
    await prisma.nrmsJourneyDelivery.update({ where: { id: delivery.id }, data: result.success && result.provider !== "suppressed" ? { status: "SENT", sentAt: now, providerMessageId: result.messageId ?? null } : { status: "FAILED", failedAt: now, errorMessage: String(result.error || "Message was suppressed").slice(0, 500) } });
    journeyCount += 1;
  }

  const reviews = await prisma.nrmsReviewRequest.findMany({ where: { status: "SCHEDULED", sendAfter: { lte: now }, guestProfile: { phone: { not: null } } }, include: { guestProfile: { select: { phone: true } }, property: { select: { title: true } } }, orderBy: { sendAfter: "asc" }, take: BATCH_SIZE });
  for (const review of reviews) {
    const claimed = await prisma.nrmsReviewRequest.updateMany({ where: { id: review.id, status: "SCHEDULED" }, data: { status: "SENDING" } }); if (!claimed.count || !review.guestProfile?.phone) continue;
    const result = await sendSms(review.guestProfile.phone, `Thank you for staying at ${review.property.title}. Share your verified feedback: ${webOrigin()}/nrms/guest/review/${review.publicToken}`);
    await prisma.nrmsReviewRequest.update({ where: { id: review.id }, data: result.success && result.provider !== "suppressed" ? { status: "SENT", sentAt: now } : { status: "FAILED" } }); reviewCount += 1;
  }

  const reminderBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const payments = await prisma.nrmsGuestPaymentRequest.findMany({ where: { status: "PENDING", reminderCount: { lt: 3 }, OR: [{ lastReminderAt: null }, { lastReminderAt: { lte: reminderBefore }, dueAt: { lte: now } }], reservation: { guestProfile: { phone: { not: null } } } }, include: { reservation: { include: { guestProfile: { select: { phone: true } }, property: { select: { title: true } } } } }, orderBy: { createdAt: "asc" }, take: BATCH_SIZE });
  for (const payment of payments) {
    if (!payment.reservation.guestProfile?.phone) continue;
    const result = await sendSms(payment.reservation.guestProfile.phone, `${payment.reservation.property.title} requests ${Number(payment.amount).toLocaleString()} ${payment.currency} for your stay. View the hotel's payment instructions: ${webOrigin()}/nrms/guest/payment/${payment.publicToken}`);
    if (result.success && result.provider !== "suppressed") await prisma.nrmsGuestPaymentRequest.update({ where: { id: payment.id }, data: { reminderCount: { increment: 1 }, lastReminderAt: now } }); paymentCount += 1;
  }
  return { expiredHolds, journeys: journeyCount, reviews: reviewCount, payments: paymentCount };
}

export function startNrmsGuestAutomationWorker(): void {
  const intervalMs = Math.max(30_000, Number(process.env.NRMS_GUEST_AUTOMATION_INTERVAL_MS || 60_000));
  const run = () => runNrmsWorker("guest-automation", () => processNrmsGuestAutomation()).catch((error) => console.error("[nrms-guest-automation] worker failed", error));
  void run(); setInterval(() => void run(), intervalMs);
  console.log(`[nrms-guest-automation] Started, interval: ${intervalMs / 1000}s`);
}
