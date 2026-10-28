import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { isCustomerBookingReference, matchesCustomerBookingReference } from "../lib/customerBookingReference.js";
import { bookingPaymentCaseReference } from "../lib/bookingPaymentCaseReference.js";
import { paymentReportEligibility } from "../lib/bookingPaymentCaseEligibility.js";

const router = Router();
router.use(requireAuth as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

const reportSchema = z.object({
  bookingReference: z.string().min(1).max(80),
  transactionReference: z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_:#\/.\- ]*$/).optional(),
  paymentMethod: z.enum(["MOBILE_MONEY", "CARD", "BANK", "OTHER"]).optional(),
  approximatePaidAt: z.string().datetime({ offset: true }).optional(),
  payerPhoneLast4: z.string().regex(/^\d{4}$/).optional(),
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
    if (match) return prisma.booking.findUnique({
      where: { id: match.id },
      select: {
        id: true, status: true, code: { select: { status: true } },
        invoices: { select: {
          invoiceNumber: true, status: true, receiptNumber: true, updatedAt: true,
          paymentEvents: { select: { status: true, createdAt: true } },
        } },
      },
    });
    if (rows.length < 500) return null;
    cursor = rows[rows.length - 1].id;
  }
}

/** The account must own the booking; a reference alone grants nothing. */
router.post("/", (async (req: AuthedRequest, res) => {
  const parsed = reportSchema.safeParse(req.body ?? {});
  if (!parsed.success) return res.status(400).json({ error: "Check the payment details before sending." });
  const { bookingReference, transactionReference, paymentMethod, approximatePaidAt, payerPhoneLast4 } = parsed.data;

  try {
    const booking = await findOwnedBooking(bookingReference, req.user!.id);
    if (!booking) return res.status(404).json({ error: "Booking not found" });
    const bookingId = booking.id;

    const existing = await db.bookingPaymentCase.findUnique({ where: { bookingId } });
    if (existing) return res.json({ paymentCase: responseCase(existing), alreadyReported: true });

    const eligibility = paymentReportEligibility(booking);
    if (eligibility.state === "WAITING") return res.status(409).json({
      code: "PAYMENT_PROCESSING", availableAt: eligibility.availableAt,
      error: "Your payment is still processing. Please check again shortly; you can report it if no confirmation arrives.",
    });
    if (eligibility.state === "CODE_AVAILABLE") return res.status(409).json({
      code: "CODE_AVAILABLE", error: "Your check-in code is available in My Bookings.",
    });
    if (eligibility.state === "UNVERIFIED") {
      const paidAt = approximatePaidAt ? new Date(approximatePaidAt) : null;
      if (!paymentMethod || !paidAt || !Number.isFinite(paidAt.getTime())) {
        return res.status(400).json({ error: "Choose how and approximately when you paid." });
      }
      if (paidAt && (paidAt.getTime() > Date.now() + 5 * 60_000 || paidAt.getTime() < Date.now() - 365 * 24 * 60 * 60_000)) {
        return res.status(400).json({ error: "Check the approximate payment date and time." });
      }
    }

    let created: any;
    try {
      created = await db.bookingPaymentCase.create({
        data: {
          bookingId,
          customerId: req.user!.id,
          status: eligibility.state === "UNVERIFIED" ? "UNVERIFIED_REPORT" : "OPEN",
          customerReference: transactionReference || null,
          events: { create: { type: "CUSTOMER_REPORTED", actorId: req.user!.id, actorRole: "CUSTOMER", metadata: {
            referenceProvided: Boolean(transactionReference), paymentMethod: paymentMethod || null,
            approximatePaidAt: approximatePaidAt || null, payerPhoneLast4: payerPhoneLast4 || null,
            recordedAttempt: eligibility.state !== "UNVERIFIED",
          } } },
        },
      });
    } catch (error: any) {
      if (error?.code !== "P2002") throw error;
      const prior = await db.bookingPaymentCase.findUnique({ where: { bookingId } });
      if (!prior) throw error;
      return res.json({ paymentCase: responseCase(prior), alreadyReported: true });
    }

    return res.status(201).json({ paymentCase: responseCase(created) });
  } catch (error: any) {
    if (["P2021", "P2022"].includes(error?.code)) return res.status(503).json({ error: "Payment assistance is temporarily unavailable" });
    console.error("[booking-payment-case] report failed", error);
    return res.status(500).json({ error: "Could not open a payment assistance case" });
  }
}) as RequestHandler);

export default router;
