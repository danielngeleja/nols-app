/**
 * Payout Eligibility — reads the four existing money-out flows
 *
 * Each of Owner/Operator (Invoice), Tours (TourBooking), Drivers
 * (TransportPayout) and Sales Partners (SalesPayoutRequest) already runs
 * its own approval workflow before a payout is ready to leave NoLSAF. This
 * module is the single place that knows how to read "is this source ready
 * to be disbursed, and who gets paid" from each of those four tables, so
 * the shared Disbursement ledger (ledger.ts) never has to special-case a
 * flow itself.
 *
 * A source is eligible only when its own flow has already reached its
 * approved-but-unpaid state — this module never approves anything itself,
 * it only reads a decision made elsewhere.
 */

import { prisma } from "@nolsaf/prisma";
import type { Prisma } from "@prisma/client";

export type PayoutSourceType = "OWNER_INVOICE" | "TOUR_BOOKING" | "DRIVER_TRIP" | "SALES_PAYOUT";

export class PayoutIneligibleError extends Error {
  constructor(
    readonly sourceType: PayoutSourceType,
    readonly sourceId: number,
    reason: string
  ) {
    super(`Payout source ${sourceType}:${sourceId} is not eligible: ${reason}`);
    this.name = "PayoutIneligibleError";
  }
}

export interface EligiblePayoutSource {
  sourceType: PayoutSourceType;
  sourceId: number;
  /** User who should be paid — must own the PayoutAccount used for this disbursement. */
  payeeUserId: number;
  amount: Prisma.Decimal;
  currency: string;
}

async function loadOwnerInvoice(sourceId: number): Promise<EligiblePayoutSource> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: sourceId },
    select: { id: true, ownerId: true, status: true, netPayable: true, total: true },
  });
  if (!invoice) throw new PayoutIneligibleError("OWNER_INVOICE", sourceId, "invoice not found");
  if (invoice.status !== "APPROVED") {
    throw new PayoutIneligibleError("OWNER_INVOICE", sourceId, `invoice status is ${invoice.status}, expected APPROVED`);
  }
  const amount = invoice.netPayable ?? invoice.total;
  return { sourceType: "OWNER_INVOICE", sourceId, payeeUserId: invoice.ownerId, amount, currency: "TZS" };
}

async function loadTourBooking(sourceId: number): Promise<EligiblePayoutSource> {
  const booking = await prisma.tourBooking.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      payoutStatus: true,
      operatorPayoutAmount: true,
      currency: true,
      operator: { select: { userId: true } },
    },
  });
  if (!booking) throw new PayoutIneligibleError("TOUR_BOOKING", sourceId, "tour booking not found");
  if (booking.payoutStatus !== "APPROVED") {
    throw new PayoutIneligibleError("TOUR_BOOKING", sourceId, `payoutStatus is ${booking.payoutStatus}, expected APPROVED`);
  }

  // Never release operator money while a traveller case is unresolved — it
  // turns a simple payout hold into a post-disbursement recovery debt. This
  // was previously enforced only in the retired manual "disburse" action;
  // it must live here now since this is the only remaining path to a payout.
  const openCase = await prisma.tourCase.findFirst({
    where: {
      tourBookingId: sourceId,
      status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE", "APPROVED"] },
    },
    select: { id: true, type: true },
  });
  if (openCase) {
    throw new PayoutIneligibleError(
      "TOUR_BOOKING",
      sourceId,
      `case #${openCase.id} (${String(openCase.type).toLowerCase()}) is open for this booking, resolve it first`
    );
  }

  return {
    sourceType: "TOUR_BOOKING",
    sourceId,
    payeeUserId: booking.operator.userId,
    amount: booking.operatorPayoutAmount,
    currency: booking.currency,
  };
}

async function loadDriverTrip(sourceId: number): Promise<EligiblePayoutSource> {
  const payout = await prisma.transportPayout.findUnique({
    where: { id: sourceId },
    select: { id: true, status: true, driverId: true, netPaid: true, currency: true },
  });
  if (!payout) throw new PayoutIneligibleError("DRIVER_TRIP", sourceId, "transport payout not found");
  if (payout.status !== "APPROVED") {
    throw new PayoutIneligibleError("DRIVER_TRIP", sourceId, `status is ${payout.status}, expected APPROVED`);
  }
  return { sourceType: "DRIVER_TRIP", sourceId, payeeUserId: payout.driverId, amount: payout.netPaid, currency: payout.currency };
}

async function loadSalesPayout(sourceId: number): Promise<EligiblePayoutSource> {
  const request = await prisma.salesPayoutRequest.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      status: true,
      approvedAmount: true,
      requestedAmount: true,
      currency: true,
      salesPartner: { select: { userId: true } },
    },
  });
  if (!request) throw new PayoutIneligibleError("SALES_PAYOUT", sourceId, "sales payout request not found");
  if (request.status !== "APPROVED") {
    throw new PayoutIneligibleError("SALES_PAYOUT", sourceId, `status is ${request.status}, expected APPROVED`);
  }
  return {
    sourceType: "SALES_PAYOUT",
    sourceId,
    payeeUserId: request.salesPartner.userId,
    amount: request.approvedAmount ?? request.requestedAmount,
    currency: request.currency,
  };
}

/** Loads and validates a payout source. Throws PayoutIneligibleError if it is not found or not yet approved-but-unpaid in its own flow. */
export async function loadEligiblePayoutSource(
  sourceType: PayoutSourceType,
  sourceId: number
): Promise<EligiblePayoutSource> {
  switch (sourceType) {
    case "OWNER_INVOICE":
      return loadOwnerInvoice(sourceId);
    case "TOUR_BOOKING":
      return loadTourBooking(sourceId);
    case "DRIVER_TRIP":
      return loadDriverTrip(sourceId);
    case "SALES_PAYOUT":
      return loadSalesPayout(sourceId);
    default:
      throw new PayoutIneligibleError(sourceType, sourceId, `unknown source type`);
  }
}
