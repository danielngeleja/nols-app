import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { isCustomerBookingReference, matchesCustomerBookingReference } from "../lib/customerBookingReference.js";
import { bookingPaymentCaseReference } from "../lib/bookingPaymentCaseReference.js";
import { deliverBookingCaseConfirmation } from "../lib/bookingPaymentCaseDelivery.js";

const router = Router();
router.use(requireAuth as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

const reportSchema = z.object({
  bookingReference: z.string().min(1).max(80),
  transactionReference: z.string().trim().max(100).regex(/^[A-Za-z0-9_:#\/.\- ]*$/).optional(),
});

function responseCase(row: any) {
  return {
    reference: bookingPaymentCaseReference(row.id),
    status: row.status,
    resolution: row.resolution,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    resolvedAt: row.resolvedAt,
  };
}

async function findOwnedBooking(reference: string, userId: number) {
  if (!isCustomerBookingReference(reference)) return null;
  let cursor: number | undefined;
  for (;;) {
    const rows = await prisma.booking.findMany({
      where: { userId }, select: { id: true, status: true, code: { select: { status: true } } },
      orderBy: { id: "desc" }, take: 500,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const match = rows.find((row) => matchesCustomerBookingReference(reference, row.id));
    if (match) return match;
    if (rows.length < 500) return null;
    cursor = rows[rows.length - 1].id;
  }
}

/** The account must own the booking; a reference alone grants nothing. */
router.post("/", (async (req: AuthedRequest, res) => {
  const parsed = reportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the booking and transaction reference" });
  const { bookingReference, transactionReference } = parsed.data;

  try {
    const booking = await findOwnedBooking(bookingReference, req.user!.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const bookingId = booking.id;

    const existing = await db.bookingPaymentCase.findUnique({ where: { bookingId } });
    if (existing) return res.json({ paymentCase: responseCase(existing), alreadyReported: true });

    let created: any;
    try {
      created = await db.bookingPaymentCase.create({
        data: {
          bookingId,
          customerId: req.user!.id,
          status: "OPEN",
          customerReference: transactionReference || null,
          events: { create: { type: "CUSTOMER_REPORTED", actorId: req.user!.id, actorRole: "CUSTOMER", metadata: { referenceProvided: Boolean(transactionReference) } } },
        },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const prior = await db.bookingPaymentCase.findUnique({ where: { bookingId } });
      if (!prior) throw error;
      return res.json({ paymentCase: responseCase(prior), alreadyReported: true });
    }

    // A confirmed booking with an active code is a delivery problem, so try
    // the original verified channels once without waiting for a staff member.
    if (["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN"].includes(booking.status) && booking.code?.status === "ACTIVE") {
      try {
        const delivery = await deliverBookingCaseConfirmation(bookingId);
        await db.bookingPaymentCaseEvent.create({ data: {
          caseId: created.id, type: "AUTO_RESEND", actorRole: "SYSTEM",
          metadata: { channels: delivery.channels, destinationMasked: delivery.destinationMasked, ownerPhoneOverlap: delivery.ownerPhoneOverlap },
        } });
        if (delivery.channels.length) {
          created = await db.bookingPaymentCase.update({ where: { id: created.id }, data: { status: "RESOLVED", resolution: "CODE_DELIVERED", resolvedAt: new Date() } });
        }
      } catch (error: any) {
        console.warn("[booking-payment-case] automatic delivery deferred", { bookingId, message: error?.message });
      }
    }

    return res.status(201).json({ paymentCase: responseCase(created) });
  } catch (error: any) {
    if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Payment assistance is temporarily unavailable" });
    console.error("[booking-payment-case] report failed", error);
    return res.status(500).json({ error: "Could not open a payment assistance case" });
  }
}) as RequestHandler);

export default router;
