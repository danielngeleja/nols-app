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
// Value import, not `import type`: confirmedCustomerPayment constructs a
// Prisma.Decimal at runtime when an invoice has no settled payment events.
import { Prisma } from "@prisma/client";
import { isAdvanceRow, loadAdvanceTotalsFor } from "../../lib/tourPayouts.js";
import { ADVANCE_MAX_PERCENT, balanceAfterAdvances } from "../../lib/tourPayoutPolicy.js";

/**
 * TOUR_BOOKING pays a tour's balance after the trip; TOUR_ADVANCE pays one
 * pre-trip advance tranche (sourceId = TourFinancialTransaction.id). Keeping
 * the advance its own source lets a booking carry two disbursements without
 * breaking the "one live payout per source" guarantee (activeSourceKey).
 */
export type PayoutSourceType = "OWNER_INVOICE" | "TOUR_BOOKING" | "TOUR_ADVANCE" | "DRIVER_TRIP" | "SALES_PAYOUT";

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

/** Decimal comparison tolerance, matching the callback amount check in azampay/disbursement/contract.ts. */
const AMOUNT_TOLERANCE = 0.01;
const OWNER_INVOICE_PAYOUT_CURRENCY = "TZS";

export class PaymentCurrencyMismatchError extends Error {
  constructor(
    readonly invoiceId: number,
    readonly expectedCurrency: string,
    readonly receivedCurrencies: readonly string[]
  ) {
    super(
      `Invoice ${invoiceId} has successful payment events in ${receivedCurrencies.join(", ")}, ` +
        `but its payout currency is ${expectedCurrency}`
    );
    this.name = "PaymentCurrencyMismatchError";
  }
}

/**
 * How much confirmed customer money NoLSAF holds against one invoice.
 *
 * Reads PaymentEvent, not Invoice.status. Invoice.status is not evidence of
 * collection: POST /admin/invoices/:id/pay sets it to PAID with an
 * admin-supplied paymentRef and no provider confirmation, and the same PAID
 * value is also written at the END of the owner payout by
 * ledger.writeBackSourcePaid, so the column carries two opposite meanings.
 *
 * PaymentEvent rows are written only by the provider webhook and carry a
 * unique provider eventId, so no admin route can mint one. That is the
 * property this gate depends on.
 */
export async function confirmedCustomerPayment(
  invoiceId: number,
  expectedCurrency: string
): Promise<Prisma.Decimal> {
  const normalizedExpected = expectedCurrency.trim().toUpperCase();
  const settledByCurrency = await prisma.paymentEvent.groupBy({
    by: ["currency"],
    where: { invoiceId, status: "SUCCESS" },
    _sum: { amount: true },
  });

  const unexpectedCurrencies: string[] = settledByCurrency
    .map((row): string => String(row.currency).trim().toUpperCase())
    .filter((currency: string) => currency !== normalizedExpected);
  if (unexpectedCurrencies.length > 0) {
    throw new PaymentCurrencyMismatchError(
      invoiceId,
      normalizedExpected,
      [...new Set(unexpectedCurrencies)]
    );
  }

  return settledByCurrency
    .filter((row) => String(row.currency).trim().toUpperCase() === normalizedExpected)
    .reduce(
      (sum, row) => sum.plus(row._sum.amount ?? 0),
      new Prisma.Decimal(0)
    );
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

  // netPayable is the owner's share and the only payable figure. This used to
  // fall back to `total`, which is the customer-paid gross INCLUDING NoLSAF's
  // commission and the driver's transport fare — so a row with a null
  // netPayable did not pay slightly too much, it paid away the commission and
  // the fare as well. A missing net amount is a refusal, never a larger number.
  if (invoice.netPayable == null) {
    throw new PayoutIneligibleError(
      "OWNER_INVOICE",
      sourceId,
      "netPayable is not set; `total` is the customer-paid gross including commission and transport fare and must never be disbursed to the owner"
    );
  }
  if (!(Number(invoice.netPayable) > 0)) {
    throw new PayoutIneligibleError("OWNER_INVOICE", sourceId, `netPayable is ${invoice.netPayable.toString()}, expected a positive amount`);
  }

  // Solvency gate: never pay out more than was actually collected for this
  // booking. Approval alone is not evidence of payment — the invoice approve
  // action is gated on the owner having validated a check-in code, which is a
  // guest-arrival signal, and codes can be issued by an admin outside the
  // payment path. Without this check an unpaid booking could be walked to an
  // APPROVED invoice and settled out of NoLSAF's own float.
  let collected: Prisma.Decimal;
  try {
    collected = await confirmedCustomerPayment(sourceId, OWNER_INVOICE_PAYOUT_CURRENCY);
  } catch (error) {
    if (error instanceof PaymentCurrencyMismatchError) {
      throw new PayoutIneligibleError("OWNER_INVOICE", sourceId, error.message);
    }
    throw error;
  }
  if (Number(collected) + AMOUNT_TOLERANCE < Number(invoice.netPayable)) {
    throw new PayoutIneligibleError(
      "OWNER_INVOICE",
      sourceId,
      `confirmed customer payment is ${collected.toString()} but the owner payout is ${invoice.netPayable.toString()}; ` +
        `no disbursement may exceed the money actually collected for this booking`
    );
  }

  return {
    sourceType: "OWNER_INVOICE",
    sourceId,
    payeeUserId: invoice.ownerId,
    amount: invoice.netPayable,
    currency: OWNER_INVOICE_PAYOUT_CURRENCY,
  };
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

  // The balance is the net share minus every advance already paid, and it
  // waits for any advance still moving through finance so the two can never
  // be paid against the same money twice.
  const advances = await loadAdvanceTotalsFor(sourceId);
  if (advances.inFlight > 0) {
    throw new PayoutIneligibleError("TOUR_BOOKING", sourceId, "an advance for this booking is still being processed, pay or reject it first");
  }
  const balance = balanceAfterAdvances(Number(booking.operatorPayoutAmount), advances.paid);
  if (balance <= 0) {
    throw new PayoutIneligibleError("TOUR_BOOKING", sourceId, "advances already cover the full operator share, there is no balance to pay");
  }

  return {
    sourceType: "TOUR_BOOKING",
    sourceId,
    payeeUserId: booking.operator.userId,
    amount: new Prisma.Decimal(balance),
    currency: booking.currency,
  };
}

/**
 * A pre-trip advance tranche. Eligible when NoLSAF finance approved the
 * advance row, the booking is still live, no case is open, and the advances
 * paid plus this one stay within the policy cap of the operator's net share.
 */
async function loadTourAdvance(sourceId: number): Promise<EligiblePayoutSource> {
  const row = await prisma.tourFinancialTransaction.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      kind: true,
      status: true,
      amount: true,
      currency: true,
      metadata: true,
      booking: {
        select: {
          id: true,
          status: true,
          operatorPayoutAmount: true,
          operator: { select: { userId: true } },
        },
      },
    },
  });
  if (!row || row.kind !== "PAYOUT" || !isAdvanceRow(row.metadata)) {
    throw new PayoutIneligibleError("TOUR_ADVANCE", sourceId, "advance record not found");
  }
  if (row.status !== "APPROVED") {
    throw new PayoutIneligibleError("TOUR_ADVANCE", sourceId, `advance status is ${row.status}, expected APPROVED`);
  }
  const bookingStatus = String(row.booking.status || "").toUpperCase();
  if (["CANCELED", "CANCELLED", "REFUNDED"].includes(bookingStatus)) {
    throw new PayoutIneligibleError("TOUR_ADVANCE", sourceId, `booking is ${bookingStatus}, an advance can no longer be paid`);
  }
  const openCase = await prisma.tourCase.findFirst({
    where: {
      tourBookingId: row.booking.id,
      status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE", "APPROVED"] },
    },
    select: { id: true, type: true },
  });
  if (openCase) {
    throw new PayoutIneligibleError(
      "TOUR_ADVANCE",
      sourceId,
      `case #${openCase.id} (${String(openCase.type).toLowerCase()}) is open for this booking, resolve it first`
    );
  }
  const advances = await loadAdvanceTotalsFor(row.booking.id);
  const cap = (Number(row.booking.operatorPayoutAmount) * ADVANCE_MAX_PERCENT) / 100;
  if (advances.paid + Number(row.amount) > cap + AMOUNT_TOLERANCE) {
    throw new PayoutIneligibleError(
      "TOUR_ADVANCE",
      sourceId,
      `advances would reach ${advances.paid + Number(row.amount)}, above the ${ADVANCE_MAX_PERCENT}% cap of ${cap}`
    );
  }

  return {
    sourceType: "TOUR_ADVANCE",
    sourceId,
    payeeUserId: row.booking.operator.userId,
    amount: row.amount,
    currency: row.currency,
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
      deductionAmount: true,
      withholdingTaxAmount: true,
      netPaidAmount: true,
      requestedAmount: true,
      currency: true,
      salesPartner: { select: { userId: true } },
    },
  });
  if (!request) throw new PayoutIneligibleError("SALES_PAYOUT", sourceId, "sales payout request not found");
  if (request.status !== "APPROVED") {
    throw new PayoutIneligibleError("SALES_PAYOUT", sourceId, `status is ${request.status}, expected APPROVED`);
  }

  // netPaidAmount is the payable figure. This used to read
  // `approvedAmount ?? requestedAmount`, both of which are GROSS of the
  // deduction that admin.sales.finance.ts records at approval time — so every
  // approved advance recovery, penalty and clawback was audited, shown back in
  // the response, and then silently not applied when the money went out.
  if (request.netPaidAmount == null) {
    throw new PayoutIneligibleError(
      "SALES_PAYOUT",
      sourceId,
      "netPaidAmount is not set; approvedAmount and requestedAmount are gross of deductions and must never be disbursed"
    );
  }
  if (!(Number(request.netPaidAmount) > 0)) {
    throw new PayoutIneligibleError("SALES_PAYOUT", sourceId, `netPaidAmount is ${request.netPaidAmount.toString()}, expected a positive amount`);
  }

  // The row carries its own arithmetic, so verify it still reconciles rather
  // than trusting one column in isolation. A row whose net no longer equals
  // approved minus deduction was edited outside the approval path, which is
  // the one thing a stored-total design cannot otherwise detect.
  if (request.approvedAmount != null) {
    // Withholding tax is part of the approval arithmetic (it stays with NoLSAF
    // for remittance to TRA), so it must be subtracted here too.
    const expected =
      Number(request.approvedAmount) - Number(request.deductionAmount ?? 0) - Number(request.withholdingTaxAmount ?? 0);
    if (Math.abs(expected - Number(request.netPaidAmount)) > AMOUNT_TOLERANCE) {
      throw new PayoutIneligibleError(
        "SALES_PAYOUT",
        sourceId,
        `amounts do not reconcile: approved ${request.approvedAmount.toString()} minus deduction ` +
          `${request.deductionAmount?.toString() ?? "0"} minus withholding tax ${request.withholdingTaxAmount?.toString() ?? "0"} ` +
          `is ${expected}, but netPaidAmount is ${request.netPaidAmount.toString()}`
      );
    }
  }

  return {
    sourceType: "SALES_PAYOUT",
    sourceId,
    payeeUserId: request.salesPartner.userId,
    amount: request.netPaidAmount,
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
    case "TOUR_ADVANCE":
      return loadTourAdvance(sourceId);
    case "DRIVER_TRIP":
      return loadDriverTrip(sourceId);
    case "SALES_PAYOUT":
      return loadSalesPayout(sourceId);
    default:
      throw new PayoutIneligibleError(sourceType, sourceId, `unknown source type`);
  }
}
