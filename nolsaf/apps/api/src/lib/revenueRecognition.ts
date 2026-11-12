// apps/api/src/lib/revenueRecognition.ts
//
// One function per recognition and reversal point (docs/REVENUE_LEDGER.md).
// Each reads its source row through the `db` it is given, decides whether the
// source is in a recognizable state, and hands the amounts to revenueLedger.
// The settlement paths call these inside the transaction that flips the source
// status; the backfill script calls the same functions, so a live write and a
// replayed one can never disagree on the amounts.
//
// The amount rules mirror lib/financeOverview.ts on purpose, so the ledger can
// be reconciled against today's recomputed figures before anything reads it.

import { isOwnerSubmittedInvoice } from "./accommodationPayout.js";
import { moneyStageOf } from "./invoiceMoneyStage.js";
import { recognizeRevenue, reverseRevenue, type LedgerResult } from "./revenueLedger.js";

/** Interactive transaction options for status change plus ledger write. */
export const REVENUE_TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 } as const;

/** Money stages in which a booking invoice's guest has paid (no disbursement rows needed). */
const GUEST_PAID_STAGES = new Set(["GUEST_PAID", "IN_REVIEW", "DISBURSING", "ON_HOLD", "FAILED", "DISBURSED"]);

const n = (v: unknown): number => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

const skipped = (reason: string): LedgerResult => ({ status: "skipped", entry: null, reason });

export type RecognitionOptions = {
  /** Provider event that settled the source. Looked up when undefined; pass null for none. */
  paymentEventId?: number | null;
  /** Override the recognition instant (the backfill passes the historical paid time). */
  recognizedAt?: Date;
};

async function latestSuccessEventId(db: any, where: Record<string, unknown>): Promise<number | null> {
  const row = await db.paymentEvent.findFirst({ where: { ...where, status: "SUCCESS" }, orderBy: { id: "desc" }, select: { id: true } });
  return row?.id ?? null;
}

async function eventIdFor(db: any, opts: RecognitionOptions, where: Record<string, unknown>) {
  return opts.paymentEventId !== undefined ? opts.paymentEventId : latestSuccessEventId(db, where);
}

// ── Accommodation ────────────────────────────────────────────────────────────

/**
 * A booking invoice the guest has paid. Owner claims (OINV-) are payouts, not
 * revenue, and are skipped.
 *
 * `priorStatus` is the invoice status before the caller's PAID write. When the
 * guest had already paid (the invoice was moving through the owner's claim),
 * a later PAID is the owner being paid and is not a new recognition.
 * `assumeGuestPaid` lets the backfill pass its own disbursement-aware stage.
 */
export async function recognizeInvoiceRevenue(
  db: any,
  invoiceId: number,
  opts: RecognitionOptions & { priorStatus?: string | null; assumeGuestPaid?: boolean } = {},
): Promise<LedgerResult> {
  const inv = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, invoiceNumber: true, status: true, total: true, commissionAmount: true, netPayable: true, paidAt: true, issuedAt: true },
  });
  if (!inv) return skipped("NOT_FOUND");
  if (isOwnerSubmittedInvoice(inv.invoiceNumber)) return skipped("OWNER_CLAIM");
  if (opts.priorStatus != null && GUEST_PAID_STAGES.has(moneyStageOf({ status: String(opts.priorStatus), invoiceNumber: inv.invoiceNumber }, []).stage)) {
    return skipped("ALREADY_GUEST_PAID");
  }
  if (!opts.assumeGuestPaid && !GUEST_PAID_STAGES.has(moneyStageOf(inv, []).stage)) return skipped("NOT_PAID");

  return recognizeRevenue(db, {
    stream: "ACCOMMODATION",
    sourceType: "INVOICE",
    sourceId: inv.id,
    currency: "TZS",
    gross: n(inv.total),
    commission: n(inv.commissionAmount),
    partnerNet: n(inv.netPayable),
    recognizedAt: opts.recognizedAt ?? inv.paidAt ?? inv.issuedAt ?? new Date(),
    paymentEventId: await eventIdFor(db, opts, { invoiceId: inv.id }),
  });
}

/** The booking's guest invoice that carries (or should carry) the recognition. */
async function recognizedBookingInvoice(db: any, bookingId: number): Promise<number | null> {
  const invoices = await db.invoice.findMany({
    where: { bookingId, OR: [{ invoiceNumber: null }, { NOT: { invoiceNumber: { startsWith: "OINV-" } } }] },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  for (const inv of invoices) {
    const result = await recognizeInvoiceRevenue(db, inv.id, { paymentEventId: undefined });
    if (result.entry) return inv.id;
  }
  return null;
}

/** A refund paid on an accommodation cancellation (CancellationRequest REFUNDED). */
export async function reverseAccommodationRefund(db: any, cancellationRequestId: number): Promise<LedgerResult> {
  const request = await db.cancellationRequest.findUnique({
    where: { id: cancellationRequestId },
    select: { id: true, bookingId: true, status: true, refundAmount: true, refundChargesJson: true, refundedAt: true },
  });
  if (!request) return skipped("NOT_FOUND");
  if (request.status !== "REFUNDED") return skipped("NOT_REFUNDED");
  // The money that actually went back to the guest, after policy 8.4 charges.
  const charges = (request.refundChargesJson ?? null) as { netRefundAmount?: number } | null;
  const returned = n(charges?.netRefundAmount ?? request.refundAmount);
  if (!(returned > 0)) return skipped("ZERO_AMOUNT");

  const invoiceId = await recognizedBookingInvoice(db, request.bookingId);
  if (!invoiceId) return skipped("NOT_RECOGNIZED");
  return reverseRevenue(db, {
    original: { stream: "ACCOMMODATION", sourceType: "INVOICE", sourceId: invoiceId },
    sourceType: "CANCELLATION_REFUND",
    sourceId: request.id,
    gross: returned,
    reason: `Refund on cancellation request ${request.id}`,
    recognizedAt: request.refundedAt ?? new Date(),
  });
}

/** A card chargeback recorded from the provider's notice (OwnerPayoutRecovery kind CHARGEBACK). */
export async function reverseAccommodationChargeback(
  db: any,
  recovery: { id: number; bookingId: number; guestAmount: unknown; createdAt?: Date | null },
): Promise<LedgerResult> {
  const amount = n(recovery.guestAmount);
  if (!(amount > 0)) return skipped("ZERO_AMOUNT");
  const invoiceId = await recognizedBookingInvoice(db, recovery.bookingId);
  if (!invoiceId) return skipped("NOT_RECOGNIZED");
  return reverseRevenue(db, {
    original: { stream: "ACCOMMODATION", sourceType: "INVOICE", sourceId: invoiceId },
    sourceType: "CHARGEBACK",
    sourceId: recovery.id,
    gross: amount,
    reason: `Card chargeback (recovery ${recovery.id})`,
    recognizedAt: recovery.createdAt ?? new Date(),
  });
}

// ── Tours ────────────────────────────────────────────────────────────────────

/** A paid tour booking. Multi-currency: the booking's frozen FX rate wins. */
export async function recognizeTourRevenue(db: any, tourBookingId: number, opts: RecognitionOptions = {}): Promise<LedgerResult> {
  const tour = await db.tourBooking.findUnique({
    where: { id: tourBookingId },
    select: { id: true, paymentStatus: true, currency: true, grossAmount: true, commissionAmount: true, fxTzsPerUnit: true, paidAt: true },
  });
  if (!tour) return skipped("NOT_FOUND");
  const status = String(tour.paymentStatus || "").toUpperCase();
  // REFUNDED was paid first; it is recognized so its reversal has something to reverse.
  if (status !== "PAID" && !(status === "REFUNDED" && tour.paidAt)) return skipped("NOT_PAID");

  const gross = n(tour.grossAmount);
  const commission = n(tour.commissionAmount);
  return recognizeRevenue(db, {
    stream: "TOUR",
    sourceType: "TOUR_BOOKING",
    sourceId: tour.id,
    currency: tour.currency,
    gross,
    commission,
    partnerNet: Math.max(0, gross - commission),
    fxTzsPerUnit: tour.fxTzsPerUnit,
    recognizedAt: opts.recognizedAt ?? tour.paidAt ?? new Date(),
    paymentEventId: await eventIdFor(db, opts, { tourBookingId: tour.id }),
  });
}

/** A tour refund recorded as paid (TourFinancialTransaction kind REFUND, status REFUNDED). */
export async function reverseTourRefund(db: any, refundTransactionId: number): Promise<LedgerResult> {
  const refund = await db.tourFinancialTransaction.findUnique({
    where: { id: refundTransactionId },
    select: { id: true, tourBookingId: true, kind: true, status: true, amount: true, metadata: true, updatedAt: true },
  });
  if (!refund) return skipped("NOT_FOUND");
  if (refund.kind !== "REFUND" || refund.status !== "REFUNDED") return skipped("NOT_REFUNDED");
  const meta = (refund.metadata ?? {}) as any;
  const returned = n(meta?.channelCharges?.netRefundAmount ?? refund.amount);
  if (!(returned > 0)) return skipped("ZERO_AMOUNT");

  const original = await recognizeTourRevenue(db, refund.tourBookingId, { paymentEventId: undefined });
  if (!original.entry) return skipped("NOT_RECOGNIZED");
  const recordedAt = meta?.recordedAt ? new Date(meta.recordedAt) : null;
  return reverseRevenue(db, {
    original: { stream: "TOUR", sourceType: "TOUR_BOOKING", sourceId: refund.tourBookingId },
    sourceType: "TOUR_REFUND",
    sourceId: refund.id,
    gross: returned,
    reason: `Tour refund ${refund.id}`,
    recognizedAt: recordedAt && !Number.isNaN(recordedAt.getTime()) ? recordedAt : refund.updatedAt ?? new Date(),
  });
}

// ── Group stay ───────────────────────────────────────────────────────────────

/**
 * A group stay whose deposit is paid. Mirrors the finance overview: the take
 * is totalAmount - ownerAmount, recognized at deposit.
 */
export async function recognizeGroupStayRevenue(db: any, groupBookingId: number, opts: RecognitionOptions = {}): Promise<LedgerResult> {
  const gb = await db.groupBooking.findUnique({
    where: { id: groupBookingId },
    select: { id: true, depositPaid: true, depositPaidAt: true, totalAmount: true, ownerAmount: true, currency: true },
  });
  if (!gb) return skipped("NOT_FOUND");
  if (!gb.depositPaid) return skipped("NOT_PAID");
  const gross = n(gb.totalAmount);
  const partnerNet = n(gb.ownerAmount);
  return recognizeRevenue(db, {
    stream: "GROUP_STAY",
    sourceType: "GROUP_BOOKING",
    sourceId: gb.id,
    currency: gb.currency,
    gross,
    commission: Math.max(0, gross - partnerNet),
    partnerNet,
    recognizedAt: opts.recognizedAt ?? gb.depositPaidAt ?? new Date(),
    paymentEventId: await eventIdFor(db, opts, { groupBookingId: gb.id }),
  });
}

/** A refund paid on a cancelled group stay (GroupBooking refundStatus REFUNDED). */
export async function reverseGroupStayRefund(db: any, groupBookingId: number): Promise<LedgerResult> {
  const gb = await db.groupBooking.findUnique({
    where: { id: groupBookingId },
    select: { id: true, refundStatus: true, refundAmount: true, refundedAt: true },
  });
  if (!gb) return skipped("NOT_FOUND");
  if (gb.refundStatus !== "REFUNDED") return skipped("NOT_REFUNDED");
  const returned = n(gb.refundAmount);
  if (!(returned > 0)) return skipped("ZERO_AMOUNT");
  const original = await recognizeGroupStayRevenue(db, gb.id, { paymentEventId: undefined });
  if (!original.entry) return skipped("NOT_RECOGNIZED");
  return reverseRevenue(db, {
    original: { stream: "GROUP_STAY", sourceType: "GROUP_BOOKING", sourceId: gb.id },
    sourceType: "GROUP_STAY_REFUND",
    sourceId: gb.id,
    gross: returned,
    reason: `Refund on cancelled group stay ${gb.id}`,
    recognizedAt: gb.refundedAt ?? new Date(),
  });
}

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * A paid transport trip with a driver payout row. The customer pays inside the
 * accommodation invoice; the commission is only fixed when the payout row is
 * created, so that is the recognition point.
 */
export async function recognizeTransportRevenue(db: any, transportBookingId: number, opts: RecognitionOptions = {}): Promise<LedgerResult> {
  const trip = await db.transportBooking.findUnique({
    where: { id: transportBookingId },
    select: {
      id: true,
      paymentStatus: true,
      payout: { select: { id: true, currency: true, grossAmount: true, commissionAmount: true, netPaid: true, createdAt: true } },
    },
  });
  if (!trip) return skipped("NOT_FOUND");
  if (String(trip.paymentStatus || "").toUpperCase() !== "PAID") return skipped("NOT_PAID");
  if (!trip.payout) return skipped("NO_PAYOUT");
  return recognizeRevenue(db, {
    stream: "TRANSPORT",
    sourceType: "TRANSPORT_BOOKING",
    sourceId: trip.id,
    currency: trip.payout.currency,
    gross: n(trip.payout.grossAmount),
    commission: n(trip.payout.commissionAmount),
    partnerNet: n(trip.payout.netPaid),
    recognizedAt: opts.recognizedAt ?? trip.payout.createdAt ?? new Date(),
    paymentEventId: opts.paymentEventId ?? null,
  });
}

// ── Subscriptions (NRMS pay as you go) ───────────────────────────────────────

/** A verified NRMS service payment. The whole amount is NoLSAF revenue. */
export async function recognizeNrmsPaymentRevenue(db: any, paymentId: number, opts: RecognitionOptions = {}): Promise<LedgerResult> {
  const payment = await db.nrmsServicePayment.findUnique({
    where: { id: paymentId },
    select: { id: true, amount: true, currency: true, status: true, verifiedAt: true, provider: true, providerRef: true },
  });
  if (!payment) return skipped("NOT_FOUND");
  if (!["VERIFIED", "MANUALLY_VERIFIED"].includes(String(payment.status))) return skipped("NOT_PAID");

  let paymentEventId = opts.paymentEventId;
  if (paymentEventId === undefined) {
    // AzamPay and Coral both store the provider transaction id as providerRef.
    const event = payment.providerRef
      ? await db.paymentEvent.findUnique({ where: { eventId: String(payment.providerRef) }, select: { id: true, provider: true } })
      : null;
    paymentEventId = event && event.provider === payment.provider ? event.id : null;
  }

  const amount = n(payment.amount);
  return recognizeRevenue(db, {
    stream: "SUBSCRIPTION",
    sourceType: "NRMS_SERVICE_PAYMENT",
    sourceId: payment.id,
    currency: payment.currency,
    gross: amount,
    commission: amount,
    partnerNet: 0,
    recognizedAt: opts.recognizedAt ?? payment.verifiedAt ?? new Date(),
    paymentEventId,
  });
}
