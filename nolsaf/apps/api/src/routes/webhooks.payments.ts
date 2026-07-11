// apps/api/src/routes/webhooks.payments.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";

/** Read the global referral credit rate from SystemSetting (default 0.35%). */
async function getReferralCreditRate(): Promise<number> {
  try {
    const s = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { referralCreditPercent: true },
    });
    const v = Number(s?.referralCreditPercent ?? NaN);
    // Stored as decimal (e.g. 0.0035 = 0.35%) — use directly as rate
    if (Number.isFinite(v) && v > 0 && v <= 1) return v;
  } catch { /* fallback */ }
  return 0.0035; // 0.35% fallback only when DB is unavailable
}
import { makeQR } from "../lib/qr.js";
import bodyParser from "body-parser"; // for raw parser here
import { invalidateOwnerReports } from "../lib/cache.js";
import { sendSms } from "../lib/sms.js";
import { sendMail } from "../lib/mailer.js";
import { getBookingReceivedEmail, getTourBookingConfirmedEmail, getGroupStayConfirmedEmail, getOwnerNewBookingEmail, getOperatorTourBookedEmail } from "../lib/bookingEmailTemplates.js";
import { generateBookingReservationPdf } from "../lib/bookingPdfGen.js";
import { notifyUser } from "../lib/notifications.js";
import crypto from "crypto";
import { generateBookingCodeForBooking } from "../lib/bookingCodeService.js";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { safeEq } from "../lib/signature.js";
import { normalizePhone } from "../lib/azampay.helpers.js";
import { ensurePaidGroupStayAvailabilityBlock } from "../lib/groupStayAvailabilityBlocks.js";

const router = Router();

// Webhooks are authenticated via signature, but still rate-limit to reduce abuse/DoS.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { ok: false, error: "Too many requests" },
});

async function notifyOwnerInvoicePaid(params: {
  ownerId: number;
  invoiceId: number;
  bookingId: number;
  receiptNumber?: string | null;
  propertyTitle?: string | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  amount?: number | null;
}) {
  const { ownerId, invoiceId, bookingId, receiptNumber, propertyTitle, checkIn, checkOut, amount } = params;
  if (!ownerId) return;

  const title = "New paid booking";
  const body =
    `Booking #${bookingId} has been paid` +
    (propertyTitle ? ` for ${propertyTitle}` : "") +
    (receiptNumber ? `. Receipt: ${receiptNumber}` : ".") +
    (checkIn ? ` Check-in: ${new Date(checkIn).toISOString().slice(0, 10)}` : "") +
    (checkOut ? ` Check-out: ${new Date(checkOut).toISOString().slice(0, 10)}` : "") +
    (amount ? ` Amount: ${Number(amount).toLocaleString()} TZS` : "");

  let already = false;
  try {
    // Best-effort idempotency via JSON path. If DB doesn't support this filter, we'll fallback.
    const existing = await prisma.notification.findFirst({
      where: {
        ownerId,
        type: "invoice",
        meta: { path: ["invoiceId"], equals: invoiceId } as any,
      } as any,
      select: { id: true },
    });
    already = !!existing;
  } catch {
    already = false;
  }

  let createdId: number | null = null;
  if (!already) {
    try {
      const n = await prisma.notification.create({
        data: {
          ownerId,
          userId: ownerId, // also populate userId for future-proofing
          title,
          body,
          type: "invoice",
          meta: {
            kind: "invoice_paid",
            invoiceId,
            bookingId,
            actionUrl: "/owner/bookings/recent",
          },
        },
        select: { id: true },
      });
      createdId = Number(n.id);
    } catch {
      // non-fatal
    }

    // Email + SMS to the owner — so they know to prepare, not only at disbursement.
    // Gated on !already so duplicate webhooks don't re-notify.
    try {
      const [owner, booking] = await Promise.all([
        prisma.user.findUnique({ where: { id: ownerId }, select: { email: true, phone: true, name: true, fullName: true } }),
        prisma.booking.findUnique({ where: { id: bookingId }, select: { guestName: true, roomsQty: true } }),
      ]);
      const ownerName = owner?.fullName || owner?.name || "there";
      if (owner?.email) {
        const { subject, html } = getOwnerNewBookingEmail({
          ownerName,
          propertyName: propertyTitle || "your property",
          guestName: booking?.guestName || undefined,
          checkIn: checkIn || new Date(),
          checkOut: checkOut || new Date(),
          roomsQty: Number(booking?.roomsQty ?? 1),
          netPayout: amount ?? null,
          bookingId,
        });
        await sendMail(owner.email, subject, html, undefined, { replyTo: "support@nolsaf.com" });
      }
      if (owner?.phone) {
        const smsText =
          `NoLSAF: New booking!\n` +
          `Booking #${bookingId}` + (propertyTitle ? ` at ${String(propertyTitle).slice(0, 40)}` : "") + `\n` +
          (checkIn ? `Check-in: ${new Date(checkIn).toISOString().slice(0, 10)}\n` : "") +
          (amount ? `Your payout: ${Number(amount).toLocaleString("en-US")} TZS\n` : "") +
          `support@nolsaf.com`;
        await sendSms(owner.phone, smsText);
      }
    } catch (notifyErr) {
      console.error(`[Owner] Failed to email/SMS new booking ${bookingId}:`, (notifyErr as any)?.message ?? notifyErr);
    }
  }

  const io = (global as any).io;
  if (io) {
    // Targeted: owners can join owner room; payload has no sensitive data.
    io.to(`owner:${ownerId}`).emit("owner:bookings:updated", { bookingId, invoiceId });
    io.to(`owner:${ownerId}`).emit("notification:new", { id: createdId, title, type: "invoice" });
    // Backward-compat: some owner pages don't join rooms yet; broadcast a lightweight refresh signal.
    io.emit("owner:bookings:updated", { bookingId, invoiceId });
  }

}

async function notifyAdminsInvoicePaid(params: {
  invoiceId: number;
  invoiceNumber?: string | null;
  bookingId: number;
  ownerId?: number | null;
  receiptNumber?: string | null;
  propertyTitle?: string | null;
  totalPaid?: number | null;
  ownerPayout?: number | null;
  commissionAmount?: number | null;
  transportFare?: number | null;
  currency?: string | null;
}) {
  const {
    invoiceId,
    invoiceNumber,
    bookingId,
    ownerId,
    receiptNumber,
    propertyTitle,
    totalPaid,
    ownerPayout,
    commissionAmount,
    transportFare,
    currency,
  } = params;

  const admins = await prisma.user.findMany({
    where: { role: "ADMIN", isDisabled: { not: true } },
    select: { id: true },
  });
  if (!admins.length) return;

  const fmt = (v?: number | null) =>
    typeof v === "number" && Number.isFinite(v) ? `${Math.round(v).toLocaleString()} ${currency || "TZS"}` : null;

  const title = "Invoice paid";
  const body =
    `${invoiceNumber ? `Invoice ${invoiceNumber}` : `Invoice #${invoiceId}`} paid` +
    ` for Booking #${bookingId}` +
    (propertyTitle ? ` (${propertyTitle})` : "") +
    (receiptNumber ? `. Receipt: ${receiptNumber}` : ".") +
    (fmt(totalPaid) ? ` Customer paid: ${fmt(totalPaid)}.` : "") +
    (fmt(ownerPayout) ? ` Owner payout: ${fmt(ownerPayout)}.` : "") +
    (fmt(commissionAmount) ? ` NoLSAF commission: ${fmt(commissionAmount)}.` : "") +
    (fmt(transportFare) ? ` Transport: ${fmt(transportFare)}.` : "") +
    (ownerId ? ` OwnerId: ${ownerId}.` : "");

  try {
    await prisma.notification.createMany({
      data: admins.map((a) => ({
        userId: a.id,
        title,
        body,
        type: "invoice",
        meta: {
          kind: "invoice_paid_admin",
          invoiceId,
          invoiceNumber: invoiceNumber ?? null,
          bookingId,
          ownerId: ownerId ?? null,
          receiptNumber: receiptNumber ?? null,
          propertyTitle: propertyTitle ?? null,
          totals: {
            customerPaid: totalPaid ?? null,
            ownerPayout: ownerPayout ?? null,
            commission: commissionAmount ?? null,
            transport: transportFare ?? null,
            currency: currency ?? "TZS",
          },
          actionUrl: "/admin/invoices",
        },
      })),
    });
  } catch {
    // Best-effort.
  }
}

// raw parser just for webhooks
router.use(bodyParser.raw({ type: "*/*", limit: "1mb" }));

// naive sequences for receipt/invoice numbers if needed
function nextReceiptNumber(prefix = "RCPT", seq: number) {
  const y = new Date().getFullYear();
  return `${prefix}/${y}/${String(seq).padStart(5, "0")}`;
}

async function ensurePaidBookingReady(bookingId: number) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: { id: true, status: true },
  });
  if (!booking || booking.status === "CANCELED") return;

  if (booking.status === "NEW") {
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CONFIRMED" },
    });
  }

  if (["NEW", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT"].includes(booking.status)) {
    await generateBookingCodeForBooking(bookingId);
  }
}

async function notifyTravellerInvoicePaid(updatedInvoice: any, sourceInvoice: any, confirmedAmount?: number) {
  let context = { refCode: "?", guestEmail: false, guestPhone: false };
  try {
    const booking = sourceInvoice.booking;
    const bookingId = Number(updatedInvoice.bookingId ?? booking?.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0 || !booking) return;

    const guestEmail = booking.guestEmail || booking.user?.email || null;
    const guestPhone = booking.guestPhone || booking.user?.phone || null;
    if (!guestEmail && !guestPhone) return;

    const currency = booking.property?.currency || "TZS";
    const totalPaid = Number.isFinite(Number(confirmedAmount))
      ? Number(confirmedAmount)
      : Number(updatedInvoice.total ?? updatedInvoice.netPayable ?? booking.totalAmount ?? 0);
    const guestName = booking.guestName || booking.user?.name || "Guest";
    const roomsQty = Math.max(1, Number((booking as any).roomsQty ?? 1));
    const code = await generateBookingCodeForBooking(bookingId);
    const bookingCode = code.code;
    const refCode = bookingCode ?? `BK-${bookingId}`;
    context = { refCode, guestEmail: !!guestEmail, guestPhone: !!guestPhone };

    const pdfData = {
      guestName,
      propertyName: String(booking.property?.title || "your property"),
      bookingId,
      bookingCode,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      totalAmount: totalPaid,
      roomsQty,
      currency,
      paidAt: updatedInvoice.paidAt ?? new Date(),
    };

    const [{ subject, html }, reservationPdf] = await Promise.all([
      Promise.resolve(getBookingReceivedEmail({
        guestName: pdfData.guestName,
        propertyName: pdfData.propertyName,
        bookingId: pdfData.bookingId,
        bookingCode: pdfData.bookingCode,
        checkIn: pdfData.checkIn,
        checkOut: pdfData.checkOut,
        totalAmount: pdfData.totalAmount,
        roomsQty: pdfData.roomsQty,
      })),
      generateBookingReservationPdf(pdfData),
    ]);

    if (guestEmail) {
      await sendMail(guestEmail, subject, html, [
        { filename: `NolSAF-Booking-${refCode}.pdf`, content: reservationPdf },
      ], { replyTo: "bookings@nolsaf.com" });
    }

    if (guestPhone) {
      const ci = new Date(booking.checkIn).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const co = new Date(booking.checkOut).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
      const smsText =
        `NoLSAF: Payment Confirmed!\n` +
        `Ref: ${refCode}\n` +
        `Property: ${String(booking.property?.title || "").slice(0, 40)}\n` +
        `Check-in: ${ci}\n` +
        `Check-out: ${co}\n` +
        `Paid: ${currency} ${totalPaid.toLocaleString("en-US")}\n` +
        `Show your ref code on arrival. support@nolsaf.com`;
      await sendSms(guestPhone, smsText);
    }
  } catch (confirmErr) {
    console.error(
      `[PAYMENT_CONFIRMED] Guest notification FAILED for booking ${sourceInvoice.booking?.id ?? "?"} ` +
      `(invoiceId=${sourceInvoice.id}, refCode=${context.refCode}). ` +
      `guestEmail=${context.guestEmail ? "set" : "none"}, guestPhone=${context.guestPhone ? "set" : "none"}. ` +
      `Error: ${(confirmErr as any)?.message ?? String(confirmErr)}`
    );
  }
}

export async function markInvoicePaid(invId: number, method: string, paymentRef: string, phoneNumber?: string, provider?: string, transactionId?: string, confirmedAmount?: number) {
  const inv = await prisma.invoice.findUnique({
    where: { id: invId },
    include: { booking: { include: { property: true, user: true } } },
  });
  if (!inv) throw new Error("invoice not found");
  if (inv.status === "PAID") {
    await ensurePaidBookingReady(inv.bookingId);
    return inv;
  }

  const seq = await prisma.invoice.count({ where: { status: "PAID" } });
  const receiptNumber = inv.receiptNumber ?? nextReceiptNumber("RCPT", seq + 1);

  const payload = JSON.stringify({
    receipt: receiptNumber,
    invoice: inv.invoiceNumber,
    // Receipt/QR should reflect what the customer actually paid.
    amount: (inv as any).total ?? inv.netPayable,
    property: inv.booking.property?.title,
    bookingId: inv.bookingId,
    issuedAt: inv.issuedAt,
    ref: paymentRef,
    phoneNumber: phoneNumber || null,
    provider: provider || method,
  });
  const { png, payload: qrPayload } = await makeQR(payload);

  // Determine payment method from provider or method parameter
  const finalPaymentMethod = provider || method || inv.paymentMethod || "AZAMPAY";

  const updated = await prisma.invoice.update({
    where: { id: invId },
    data: {
      status: "PAID",
      paidBy: null, // webhook/system
      paidAt: new Date(),
      paymentMethod: finalPaymentMethod,
      paymentRef: paymentRef || inv.paymentRef,
      checkoutSessionId: transactionId || inv.checkoutSessionId,
      payerPhone:        phoneNumber  || inv.payerPhone,
      receiptNumber,
      receiptQrPayload: qrPayload,
      receiptQrPng: png,
    },
    include: { booking: true },
  });

  // A public booking is only confirmed after payment succeeds, and the check-in
  // code must exist before it appears in My Bookings.
  await ensurePaidBookingReady(updated.bookingId);
  await notifyTravellerInvoicePaid(updated, inv, confirmedAmount);

  // If the booking included scheduled transport, publish it to drivers now.
  try {
    const bookingId = Number(updated.bookingId);
    if (Number.isFinite(bookingId) && bookingId > 0) {
      const pending = await prisma.transportBooking.findMany({
        where: {
          paymentRef: `BOOKING:${bookingId}`,
          status: "PAYMENT_PENDING",
        },
        select: {
          id: true,
          vehicleType: true,
          scheduledDate: true,
          fromAddress: true,
          toAddress: true,
          amount: true,
        },
      });

      if (pending.length) {
        const activated = await prisma.transportBooking.updateMany({
          where: {
            paymentRef: `BOOKING:${bookingId}`,
            status: "PAYMENT_PENDING",
          },
          data: {
            status: "PENDING_ASSIGNMENT",
            paymentStatus: "PAID",
            paymentMethod: updated.paymentMethod ?? method ?? null,
            paymentRef: updated.paymentRef ?? paymentRef ?? `BOOKING:${bookingId}`,
          },
        });

        // NOTE: do not broadcast transport offers here.
        // The transport auto-dispatch worker issues targeted offers (top drivers) based on live locations.

        if (activated.count) {
          // no-op; activation succeeded
        }
      }
    }
  } catch (e) {
    console.warn("Failed to activate scheduled transport booking on invoice paid:", e);
  }

  await invalidateOwnerReports(updated.ownerId);
  // Notify owner ASAP (in-app notification + realtime refresh)
  try {
    await notifyOwnerInvoicePaid({
      ownerId: updated.ownerId,
      invoiceId: updated.id,
      bookingId: updated.bookingId,
      receiptNumber: updated.receiptNumber,
      propertyTitle: (inv as any).booking?.property?.title ?? null,
      checkIn: (inv as any).booking?.checkIn ?? null,
      checkOut: (inv as any).booking?.checkOut ?? null,
      // Notify owners with the amount they actually receive.
      amount:
        (updated as any).netPayable != null
          ? Number((updated as any).netPayable)
          : null,
    });
  } catch {}

  // Notify admins (classified breakdown: customer paid vs payout vs commission vs transport)
  try {
    const bookingAny = (inv as any).booking;
    await notifyAdminsInvoicePaid({
      invoiceId: updated.id,
      invoiceNumber: updated.invoiceNumber ?? null,
      bookingId: updated.bookingId,
      ownerId: updated.ownerId,
      receiptNumber: updated.receiptNumber ?? null,
      propertyTitle: bookingAny?.property?.title ?? null,
      totalPaid: (updated as any).total != null ? Number((updated as any).total) : null,
      ownerPayout: (updated as any).netPayable != null ? Number((updated as any).netPayable) : null,
      commissionAmount:
        (updated as any).commissionAmount != null ? Number((updated as any).commissionAmount) : null,
      transportFare: bookingAny?.transportFare != null ? Number(bookingAny.transportFare) : null,
      currency: "TZS",
    });
  } catch {}
  // Best-effort: create a payout record so paid invoices show up in payouts views.
  try {
    if ((prisma as any).payout) {
      const b = (updated as any).booking;
      await (prisma as any).payout.create({
        data: {
          invoiceId: updated.id,
          invoiceNumber: updated.invoiceNumber ?? null,
          tripCode: b?.tripCode ?? b?.code ?? null,
          paidAt: updated.paidAt ?? new Date(),
          paymentMethod: updated.paymentMethod ?? null,
          paymentRef: updated.paymentRef ?? null,
          gross: (updated as any).total ?? null,
          commissionAmount: (updated as any).commissionAmount ?? null,
          netPaid: (updated as any).netPayable ?? null,
          ownerId: updated.ownerId ?? null,
          driverId: b?.driverId ?? null,
          receiptNumber: updated.receiptNumber ?? null,
          createdAt: new Date(),
        },
      });
    }
  } catch (err) {
    console.warn('create payout (webhook) skipped or failed:', String(err));
  }
  // real-time toast for admins
  // Access io from global context (set in index.ts)
  const io = (global as any).io;
  if (io) {
    io.emit("admin:invoice:paid", {
      invoiceId: updated.id,
      ownerId: updated.ownerId,
      bookingId: updated.bookingId,
      receiptNumber: updated.receiptNumber ?? null,
      totalPaid: (updated as any).total ?? null,
      ownerPayout: (updated as any).netPayable ?? null,
      commissionAmount: (updated as any).commissionAmount ?? null,
      transportFare: (inv as any).booking?.transportFare ?? null,
    });
    
    // Emit referral credit update if booking belongs to a referred user
    try {
      const booking = updated.booking;
      if (booking?.userId) {
        // Check if this user was referred by a driver
        const user = await prisma.user.findUnique({
          where: { id: booking.userId },
          select: { referredBy: true, role: true }
        });
        
        if (user?.referredBy) {
          // Only emit for CUSTOMER/USER roles (they earn credits)
          if (user.role === 'CUSTOMER' || user.role === 'USER') {
            const bookingAmount = Number(updated.total || updated.netPayable || 0);
            const creditRate = await getReferralCreditRate();
            const creditsEarned = Math.round(bookingAmount * creditRate);
            io.to(`user:${booking.userId}`).emit('credits-earned', {
              message: `You earned ${creditsEarned.toLocaleString()} TZS credits from a booking!`,
              referralData: {
                userId: booking.userId,
                bookingId: booking.id,
                amount: bookingAmount,
                creditsEarned,
              }
            });
            
            // Emit referral update to refresh dashboard
            io.to(`driver:${user.referredBy}`).emit('referral-update', {
              driverId: user.referredBy,
              timestamp: Date.now(),
              action: 'credits_earned',
            });
          }
        }
      }
    } catch (e) {
      console.warn('Failed to emit referral credit update', e);
    }
  }

  return updated;
}

/** Helper: number close enough
 * Allows up to 1% drift OR 10 TZS absolute (whichever is larger), but never more than 500 TZS.
 * This catches legitimate rounding differences from payment gateways while blocking
 * deliberate underpayment of meaningful amounts. */
function near(a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return false;
  const percentTolerance = b * 0.01;          // 1% of expected
  const absTolerance = Math.min(Math.max(percentTolerance, 10), 500); // clamp: 10–500 TZS
  return Math.abs(a - b) <= absTolerance;
}

type GroupBookingDepositTarget = {
  id: number;
  userId: number;
  depositAmount: any;
  depositPaid: boolean;
  currency: string;
  assignedOwnerId: number | null;
  confirmedPropertyId?: number | null;
  checkIn?: Date | string | null;
  checkOut?: Date | string | null;
  roomsNeeded?: number | null;
  toRegion: string | null;
  toDistrict: string | null;
};

/** Mark a group booking's deposit as paid (idempotent), notify the customer/owner, and send an SMS receipt. */
export async function markGroupBookingDepositPaid(
  groupBooking: GroupBookingDepositTarget,
  amount: number,
  provider: string
): Promise<{ ok: boolean; reason?: "already_paid" | "amount_mismatch" }> {
  if (groupBooking.depositPaid) return { ok: false, reason: "already_paid" };
  const want = Math.round(Number(groupBooking.depositAmount || 0));
  if (!(want > 0 && near(amount, want))) return { ok: false, reason: "amount_mismatch" };

  await prisma.groupBooking.update({
    where: { id: groupBooking.id },
    data: {
      depositPaid: true,
      depositPaidAt: new Date(),
      status: "CONFIRMED",
      paymentProvider: provider,
    },
  });

  // Now that the deposit is in, finalize the winning owner's claim as ACCEPTED.
  // Before this point the claim sits in REVIEWING so the owner never sees a premature
  // "accepted" status (the customer selecting the offer is not yet a confirmed deal).
  if (groupBooking.confirmedPropertyId) {
    try {
      await prisma.groupBookingClaim.updateMany({
        where: {
          groupBookingId: groupBooking.id,
          propertyId: groupBooking.confirmedPropertyId,
          status: { notIn: ["WITHDRAWN", "REJECTED"] },
        },
        data: { status: "ACCEPTED", reviewedAt: new Date() },
      });
    } catch (err: any) {
      console.error(`[GroupStay] Failed to accept winning claim for booking #${groupBooking.id}:`, err?.message ?? err);
    }
  }

  try {
    await ensurePaidGroupStayAvailabilityBlock(groupBooking);
  } catch (err: any) {
    console.error(`[GroupStay] Failed to create paid availability hold for booking #${groupBooking.id}:`, err?.message ?? err);
  }

  const destination = [groupBooking.toDistrict, groupBooking.toRegion].filter(Boolean).join(", ");

  // Notify customer
  try {
    await notifyUser(groupBooking.userId, "group_stay_update", {
      title: "Deposit received — booking confirmed",
      body: `We received your deposit of ${groupBooking.currency} ${want.toLocaleString("en-US")} for your group stay${destination ? ` to ${destination}` : ""}. Your booking is now confirmed.`,
      groupBookingId: groupBooking.id,
    });
  } catch { /* non-fatal */ }

  // Notify assigned owner
  if (groupBooking.assignedOwnerId) {
    try {
      await notifyUser(groupBooking.assignedOwnerId, "group_stay_update", {
        title: "Congratulations — your offer was accepted!",
        body: `Great news! The guest paid the deposit for group stay #${groupBooking.id}${destination ? ` to ${destination}` : ""}, so your offer is now confirmed. Open the booking to view your guest's details and get in touch.`,
        groupBookingId: groupBooking.id,
      });
    } catch { /* non-fatal */ }
  }

  // SMS + email to customer
  try {
    const user = await prisma.user.findUnique({
      where: { id: groupBooking.userId },
      select: { phone: true, email: true, name: true, fullName: true },
    });

    if (user?.phone) {
      const smsText =
        `NoLSAF: Group Stay Confirmed!\n` +
        `Ref: #${groupBooking.id}\n` +
        (destination ? `Destination: ${destination.slice(0, 30)}\n` : "") +
        `Deposit paid: ${groupBooking.currency} ${want.toLocaleString("en-US")}\n` +
        `support@nolsaf.com`;
      await sendSms(user.phone, smsText);
    }

    if (user?.email) {
      let propertyName: string | undefined;
      if (groupBooking.confirmedPropertyId) {
        const prop = await prisma.property.findUnique({
          where: { id: groupBooking.confirmedPropertyId },
          select: { title: true },
        });
        propertyName = prop?.title || undefined;
      }
      const { subject, html } = getGroupStayConfirmedEmail({
        guestName: user.fullName || user.name || "Guest",
        propertyName,
        destination: destination || undefined,
        checkIn: groupBooking.checkIn ?? new Date(),
        checkOut: groupBooking.checkOut ?? new Date(),
        roomsNeeded: Number(groupBooking.roomsNeeded ?? 1),
        depositAmount: want,
        currency: groupBooking.currency || "TZS",
        bookingId: groupBooking.id,
      });
      await sendMail(user.email, subject, html, undefined, { replyTo: "bookings@nolsaf.com" });
    }
  } catch (notifyErr) {
    console.error(`[GroupStay] Failed to send deposit confirmation to customer for booking #${groupBooking.id}:`, (notifyErr as any)?.message ?? notifyErr);
  }

  return { ok: true };
}

/**
 * Mark a tour booking as paid and run all customer/operator notifications
 * (agent notify + guest SMS + guest email). Shared by every payment rail
 * (AzamPay MNO/bank webhook, CoralCommerce card) so a paid tour ALWAYS gets a
 * confirmation email regardless of how it was paid. Re-fetches the booking so
 * callers don't need a matching select. Idempotent + amount-guarded.
 */
export async function markTourBookingPaid(
  tourBookingId: number,
  amount: number,
  provider: string
): Promise<{ ok: boolean; reason?: "not_found" | "already_paid" | "amount_mismatch" }> {
  const tour = await prisma.tourBooking.findUnique({
    where: { id: tourBookingId },
    select: {
      id: true,
      bookingCode: true,
      grossAmount: true,
      currency: true,
      guestName: true,
      guestPhone: true,
      guestEmail: true,
      paymentStatus: true,
      paymentRef: true,
      customerPaymentRef: true,
      operatorAgentId: true,
      title: true,
      destination: true,
      startDate: true,
      travelerCount: true,
      operatorPayoutAmount: true,
    },
  });
  if (!tour) return { ok: false, reason: "not_found" };
  if (tour.paymentStatus === "PAID") return { ok: false, reason: "already_paid" };

  const want = Math.round(Number(tour.grossAmount));
  if (!(want > 0 && near(amount, want))) return { ok: false, reason: "amount_mismatch" };

  await prisma.tourBooking.update({
    where: { id: tour.id },
    data: {
      paymentStatus: "PAID",
      status: "CONFIRMED",
      paidAt: new Date(),
      paymentProvider: provider,
      customerPaymentRef: tour.customerPaymentRef ?? tour.paymentRef,
    },
  });

  const incomingRef = tour.customerPaymentRef ?? tour.paymentRef;
  if (incomingRef) {
    await prisma.tourFinancialTransaction.upsert({
      where: { reference: incomingRef },
      create: {
        tourBookingId: tour.id,
        kind: "PAYMENT",
        status: "PAID",
        provider,
        reference: incomingRef,
        currency: tour.currency,
        amount: tour.grossAmount,
      },
      update: { status: "PAID", provider },
    });
  }

  // Notify operator (agent): in-app + email + SMS, so they prepare immediately.
  if (tour.operatorAgentId) {
    try {
      const agent = await prisma.agent.findUnique({
        where: { id: tour.operatorAgentId },
        select: {
          userId: true,
          user: { select: { email: true, phone: true, name: true, fullName: true } },
        },
      });
      if (agent?.userId) {
        await notifyUser(agent.userId, "agent_tour_booking_paid", {
          kind: "tour_booking_paid",
          tourBookingId: tour.id,
          bookingCode: tour.bookingCode,
          guestName: tour.guestName,
          amount: want,
          currency: tour.currency,
        });
      }
      const operatorName = agent?.user?.fullName || agent?.user?.name || "there";
      if (agent?.user?.email) {
        const { subject, html } = getOperatorTourBookedEmail({
          operatorName,
          tourTitle: String(tour.title || "your tour"),
          destination: tour.destination || undefined,
          guestName: tour.guestName || undefined,
          startDate: tour.startDate,
          travelerCount: Number(tour.travelerCount ?? 1),
          operatorPayout: tour.operatorPayoutAmount != null ? Number(tour.operatorPayoutAmount) : null,
          bookingId: tour.id,
          bookingCode: tour.bookingCode || undefined,
          currency: tour.currency || "TZS",
        });
        await sendMail(agent.user.email, subject, html, undefined, { replyTo: "support@nolsaf.com" });
      }
      if (agent?.user?.phone) {
        const payout = tour.operatorPayoutAmount != null ? Number(tour.operatorPayoutAmount) : null;
        const smsText =
          `NoLSAF: New tour booking!\n` +
          `Tour: ${String(tour.title || "").slice(0, 40)}\n` +
          `Travelers: ${tour.travelerCount}\n` +
          (payout ? `Your payout: ${tour.currency} ${payout.toLocaleString("en-US")}\n` : "") +
          `support@nolsaf.com`;
        await sendSms(agent.user.phone, smsText);
      }
    } catch (notifyErr) {
      console.error(`[Operator] Failed to notify tour booking ${tour.id}:`, (notifyErr as any)?.message ?? notifyErr);
    }
  }

  // SMS to guest
  if (tour.guestPhone) {
    try {
      const smsText =
        `NoLSAF: Tour Booking Confirmed!\n` +
        `Ref: ${tour.bookingCode}\n` +
        `Tour: ${String(tour.title || "").slice(0, 40)}\n` +
        (tour.destination ? `Destination: ${String(tour.destination).slice(0, 30)}\n` : "") +
        `Travelers: ${tour.travelerCount}\n` +
        `Paid: ${tour.currency} ${want.toLocaleString("en-US")}\n` +
        `Keep this ref. support@nolsaf.com`;
      await sendSms(tour.guestPhone, smsText);
    } catch { /* non-fatal */ }
  }

  // Email to guest
  if (tour.guestEmail) {
    try {
      const { subject, html } = getTourBookingConfirmedEmail({
        guestName: tour.guestName || "Guest",
        tourTitle: String(tour.title || "your tour"),
        destination: tour.destination || undefined,
        startDate: tour.startDate,
        travelerCount: Number(tour.travelerCount ?? 1),
        totalAmount: want,
        currency: tour.currency || "TZS",
        bookingId: tour.id,
        bookingCode: tour.bookingCode || undefined,
      });
      await sendMail(tour.guestEmail, subject, html, undefined, { replyTo: "bookings@nolsaf.com" });
    } catch (mailErr) {
      console.error(`[Tour] Failed to email booking ${tour.id} confirmation:`, (mailErr as any)?.message ?? mailErr);
    }
  }

  return { ok: true };
}

// ── Webhook security helpers (exported for unit tests) ─────────

/**
 * Check whether a client IP is in the configured allowlist.
 * Returns true when no allowlist is configured (empty → allow all).
 * Strips IPv4-mapped IPv6 prefix (::ffff:) before comparing.
 */
export function isWebhookIpAllowed(clientIp: string, allowedIps: string[]): boolean {
  if (allowedIps.length === 0) return true;
  const normalized = clientIp.replace("::ffff:", "");
  return allowedIps.includes(normalized);
}

/**
 * Detect the AzamPay payment channel from a webhook payload.
 * Returns "MNO", "BANK", "CARD", or null (unknown).
 */
export function detectPaymentChannel(payload: any): "MNO" | "BANK" | "CARD" | null {
  const p = String(payload.provider || payload.paymentMethod || "").toLowerCase();
  if (["airtel", "mpesa", "mixx", "halopesa", "vodacom", "tigo"].some((x) => p.includes(x)))
    return "MNO";
  if (p === "card" || payload.cardType || payload.maskedPan)
    return "CARD";
  const bankCodes = ["crdb","nmb","nbc","stanbic","equity","im","absa","tcb","boa","dtb","uba","azania","kcb","ncba","yetu"];
  if (bankCodes.some((b) => p.includes(b)))
    return "BANK";
  // Presence of msisdn/phone strongly implies MNO
  if (payload.msisdn || payload.phoneNumber || String(payload.accountNumber || "").startsWith("+255"))
    return "MNO";
  return null;
}

/**
 * POST /webhooks/azampay
 * AzamPay webhook handler with signature verification
 */
router.post("/azampay", webhookLimiter, async (req: any, res) => {
  try {
    // ── Optional IP allowlist check ────
    const allowedIps = (process.env.AZAMPAY_WEBHOOK_ALLOWED_IPS || "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!isWebhookIpAllowed(String(req.ip || ""), allowedIps)) {
      console.warn("[Webhook] Request from non-allowlisted IP rejected");
      return res.status(403).json({ ok: false, error: "forbidden" });
    }

    // Reject non-JSON content types immediately (before touching body)
    const ct = req.header("content-type") || "";
    if (!ct.includes("application/json") && !ct.includes("text/plain")) {
      return res.status(415).json({ ok: false, error: "Unsupported content type" });
    }

    const rawBody =
      Buffer.isBuffer(req.body)
        ? req.body.toString("utf8")
        : typeof req.body === "string"
          ? req.body
          : JSON.stringify(req.body ?? {});
    const signature = req.header("X-Azampay-Signature") || req.header("x-azampay-signature");
    const secret = process.env.AZAMPAY_WEBHOOK_SECRET;

    if (!secret) {
      console.warn("AZAMPAY_WEBHOOK_SECRET not configured");
      return res.status(500).json({ ok: false, error: "Webhook secret not configured" });
    }

    if (!signature) {
      return res.status(400).json({ ok: false, error: "Signature missing" });
    }

    // Verify signature
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
    const sig = String(signature).trim().toLowerCase();
    if (!safeEq(computed, sig)) {
      console.warn("Invalid AzamPay webhook signature");
      return res.status(401).json({ ok: false, error: "Invalid signature" });
    }

    const payload = JSON.parse(rawBody);

    // ── Optional timestamp replay protection ────────
    if (process.env.AZAMPAY_WEBHOOK_ENFORCE_TIMESTAMP === "true") {
      const tsRaw = payload.timestamp ?? payload.createdAt ?? null;
      if (tsRaw) {
        const tsMs = Number(tsRaw) < 1e12 ? Number(tsRaw) * 1000 : Number(tsRaw);
        if (Number.isFinite(tsMs) && Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) {
          console.warn("[Webhook] Stale timestamp rejected");
          return res.status(400).json({ ok: false, error: "stale_request" });
        }
      }
    }

    // Normalize AzamPay payload
    const eventId    = payload.transactionId || payload.id || payload.externalId;
    const paymentRef = payload.externalId || payload.referenceId || payload.orderId;
    const amount     = Math.round(Number(payload.amount || payload.transactionAmount || 0));
    const status     = payload.status || payload.transactionStatus || "UNKNOWN";

    // Map AzamPay status to our internal status
    let normalizedStatus: "SUCCESS" | "FAILED" | "PENDING" = "PENDING";
    if (/success|completed|paid|approved/i.test(status)) {
      normalizedStatus = "SUCCESS";
    } else if (/failed|cancelled|rejected|declined/i.test(status)) {
      normalizedStatus = "FAILED";
    }

    // ── Detect channel, extract phone and raw status ─────
    const paymentChannel  = detectPaymentChannel(payload);
    const rawStatusStr    = String(status).slice(0, 80) || null;
    const phone           = normalizePhone(
      payload.msisdn || payload.phoneNumber || payload.accountNumber || ""
    );
    const checkoutUrlFromWebhook: string | null = payload.checkoutUrl
      ? String(payload.checkoutUrl).slice(0, 2048)
      : null;

    if (!eventId) {
      return res.status(400).json({ ok: false, error: "Missing eventId/transactionId" });
    }

    // Idempotency: if same event+status already recorded, skip
    const existing = await prisma.paymentEvent.findFirst({
      where: { provider: "AZAMPAY", eventId: eventId.toString() },
    });

    if (existing) {
      if (existing.status === normalizedStatus) {
        // Already processed with same outcome — safe to ack
        return res.json({ ok: true, id: existing.id, message: "Event already processed" });
      }
      // Status changed (e.g. PENDING → SUCCESS): update in place
      const updated = await prisma.paymentEvent.update({
        where: { id: existing.id },
        data:  {
          status:    normalizedStatus,
          rawStatus: rawStatusStr ?? undefined,
          // Only backfill channel if it was not already recorded
          ...(existing.paymentChannel ? {} : { paymentChannel: paymentChannel ?? undefined }),
          ...(existing.phone          ? {} : { phone: phone ?? undefined }),
        },
      });
      // Still run the paid-invoice logic below using the updated record id
      // by falling through with `recorded = updated`
      Object.assign(existing, updated);
    }

    // AzamPay's MNO callback does not reliably echo `externalId` (our paymentRef),
    // which previously meant tour/group payments were never matched here and the
    // customer never got a confirmation email. Fall back to the signals we DO
    // control at checkout: the additionalProperties we sent, and the stored
    // checkoutSessionId (== the transactionId / eventId).
    let extraProps: any = payload.additionalProperties ?? payload.metadata ?? null;
    if (typeof extraProps === "string") {
      try { extraProps = JSON.parse(extraProps); } catch { extraProps = null; }
    }
    const tourIdHint  = Number(extraProps?.tourBookingId);
    const groupIdHint = Number(extraProps?.groupBookingId);
    const sessionHint = eventId ? eventId.toString() : null;

    // Find invoice by paymentRef
    let invoice = null as any;
    if (paymentRef) {
      invoice = await prisma.invoice.findFirst({
        where: { paymentRef: paymentRef.toString() },
        include: { booking: { include: { user: true, property: true } } },
      });
    }

    // Also find tour booking (when no invoice found). Match on any signal we have:
    // paymentRef, the tourBookingId we sent in additionalProperties, or the
    // checkoutSessionId that equals this transactionId.
    let tourBooking = null as any;
    if (!invoice) {
      const tourOr: any[] = [];
      if (paymentRef) tourOr.push({ paymentRef: paymentRef.toString() });
      if (Number.isInteger(tourIdHint) && tourIdHint > 0) tourOr.push({ id: tourIdHint });
      if (sessionHint) tourOr.push({ checkoutSessionId: sessionHint });
      if (tourOr.length > 0) {
      tourBooking = await prisma.tourBooking.findFirst({
        where: { OR: tourOr },
        select: {
          id: true,
          bookingCode: true,
          grossAmount: true,
          currency: true,
          guestName: true,
          guestPhone: true,
          guestEmail: true,
          paymentStatus: true,
          status: true,
          operatorAgentId: true,
          title: true,
          destination: true,
          startDate: true,
          travelerCount: true,
        },
      });
      }
    }

    // Also find a group booking deposit (when no invoice/tour booking found). Same
    // robust matching as tours: paymentRef, groupBookingId hint, or checkoutSessionId.
    let groupBooking = null as any;
    if (!invoice && !tourBooking) {
      const groupOr: any[] = [];
      if (paymentRef) groupOr.push({ paymentRef: paymentRef.toString() });
      if (Number.isInteger(groupIdHint) && groupIdHint > 0) groupOr.push({ id: groupIdHint });
      if (sessionHint) groupOr.push({ checkoutSessionId: sessionHint });
      if (groupOr.length > 0) {
      groupBooking = await prisma.groupBooking.findFirst({
        where: { OR: groupOr },
        select: {
          id: true,
          userId: true,
          depositAmount: true,
          depositPaid: true,
          currency: true,
          status: true,
          assignedOwnerId: true,
          confirmedPropertyId: true,
          checkIn: true,
          checkOut: true,
          roomsNeeded: true,
          toRegion: true,
          toDistrict: true,
        },
      });
      }
    }

    // Visibility: which entity (if any) this callback resolved to, and via which signal.
    console.info(
      `[Webhook] match status=${normalizedStatus} ` +
      `invoice=${invoice?.id ?? "-"} tour=${tourBooking?.id ?? "-"} group=${groupBooking?.id ?? "-"} ` +
      `(paymentRef=${paymentRef ? "y" : "n"} tourHint=${Number.isInteger(tourIdHint) ? tourIdHint : "-"} ` +
      `groupHint=${Number.isInteger(groupIdHint) ? groupIdHint : "-"} session=${sessionHint ? "y" : "n"})`
    );

    // Record the payment event (only if not already existing)
    const recorded = existing ?? await prisma.paymentEvent.create({
      data: {
        provider:       "AZAMPAY",
        eventId:        eventId.toString(),
        invoiceId:      invoice?.id ?? null,
        tourBookingId:  tourBooking?.id ?? null,
        groupBookingId: groupBooking?.id ?? null,
        amount,
        currency:       payload.currency || "TZS",
        status:         normalizedStatus,
        paymentChannel: paymentChannel ?? undefined,
        phone:          phone ?? undefined,
        rawStatus:      rawStatusStr ?? undefined,
        checkoutUrl:    checkoutUrlFromWebhook ?? undefined,
        // Store only reconciliation fields — not full raw payload (PII)
        payload: {
          transactionId: eventId,
          paymentRef:    paymentRef ?? null,
          status:        payload.status ?? null,
          provider:      payload.provider ?? null,
        },
      },
    });

    // If payment is successful, mark invoice as paid
    if (invoice && normalizedStatus === "SUCCESS") {
      // TZS has no cents — compare as rounded integers to match what was sent to AzamPay.
      const want = Math.round(Number(invoice.total || invoice.netPayable || 0));
      
      // Extract phone number and provider from payment event payload or invoice
      const eventPayload = recorded.payload as any;
      const phoneNumber = eventPayload?.phoneNumber || eventPayload?.accountNumber || invoice.booking?.user?.phone || null;
      const provider = eventPayload?.provider || eventPayload?.paymentMethod || invoice.paymentMethod || "AZAMPAY";
      
      // Verify amount matches within tolerance
      if (near(amount, want)) {
        await markInvoicePaid(
          invoice.id,
          "AZAMPAY",
          paymentRef || eventId.toString(),
          phoneNumber || undefined,
          provider || undefined,
          eventId.toString(),
          amount
        );
      } else {
        // Suspicious underpayment — log with enough detail for admin investigation.
        console.warn(
          `[WEBHOOK] Amount mismatch on invoice ${invoice?.id ?? "?"}: ` +
          `expected ${want} TZS, received ${amount} TZS ` +
          `(diff ${Math.abs(amount - want)} TZS). Invoice NOT marked paid.`
        );
      }
    }

    // ── Tour booking payment success ──────────────────────────────────────────
    if (tourBooking && normalizedStatus === "SUCCESS" && tourBooking.paymentStatus !== "PAID") {
      try {
        const result = await markTourBookingPaid(tourBooking.id, amount, "AZAMPAY");
        if (!result.ok && result.reason === "amount_mismatch") {
          console.warn(
            `[WEBHOOK] Amount mismatch on tour booking ${tourBooking.id}: received ${amount} TZS.`
          );
        }
      } catch (tourErr) {
        console.error(`[WEBHOOK] Failed to confirm tour booking ${tourBooking.id}:`, (tourErr as any)?.message ?? tourErr);
      }
    }

    // ── Group stay deposit payment success ─────────────────────────────────────
    if (groupBooking && normalizedStatus === "SUCCESS" && !groupBooking.depositPaid) {
      try {
        const result = await markGroupBookingDepositPaid(groupBooking, amount, "AZAMPAY");
        if (!result.ok && result.reason === "amount_mismatch") {
          console.warn(
            `[WEBHOOK] Amount mismatch on group booking deposit ${groupBooking.id}: ` +
            `expected ${Math.round(Number(groupBooking.depositAmount || 0))} TZS, received ${amount} TZS.`
          );
        }
      } catch (groupErr) {
        console.error(`[WEBHOOK] Failed to mark group booking ${groupBooking.id} deposit as paid:`, (groupErr as any)?.message ?? groupErr);
      }
    }

    res.json({ ok: true, id: recorded.id });
  } catch (e: any) {
    if (process.env.NODE_ENV !== "production") {
      console.error("AzamPay webhook error:", e);
    } else {
      console.error("AzamPay webhook error:", e?.message ?? "unknown");
    }
    return res.status(400).json({ ok: false, error: "bad request" });
  }
});

export default router;
