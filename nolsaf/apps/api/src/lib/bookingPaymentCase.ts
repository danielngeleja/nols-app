import { expectedInvoicePaymentAmount, isPaymentAmountWithinTolerance } from "./paymentAmount.js";

export type PaymentCaseEventEvidence = {
  id: number;
  eventId: string;
  provider: string;
  status: string;
  amount: unknown;
  currency: string;
  phone?: string | null;
  payload?: unknown;
};

export type PaymentCaseInvoiceEvidence = {
  id: number;
  invoiceNumber: string | null;
  status: string;
  total: unknown;
  netPayable: unknown;
  paymentMethod?: string | null;
  paymentRef?: string | null;
  receiptNumber?: string | null;
  paymentEvents: PaymentCaseEventEvidence[];
};

const AUTHENTICATED_COLLECTION_PROVIDERS = new Set(["AZAMPAY", "CORALCOMMERCE"]);

function matchedSuccess(invoice: PaymentCaseInvoiceEvidence, providerFilter?: string): PaymentCaseEventEvidence | null {
  if (!invoice.invoiceNumber?.startsWith("INV-")) return null;
  const expected = expectedInvoicePaymentAmount(invoice);
  return invoice.paymentEvents.find((event) => {
    const provider = event.provider.toUpperCase();
    if (event.status !== "SUCCESS" || !AUTHENTICATED_COLLECTION_PROVIDERS.has(provider)) return false;
    if (providerFilter && provider !== providerFilter) return false;
    if (event.currency.toUpperCase() !== "TZS" || !event.eventId) return false;
    if (provider === "AZAMPAY") {
      const payload = event.payload && typeof event.payload === "object" ? event.payload as Record<string, unknown> : null;
      if (payload?.webhookVerified !== true || Number(payload.webhookAmount) !== Math.round(Number(event.amount)) ||
        String(payload.webhookCurrency || "").toUpperCase() !== "TZS") return false;
    }
    return isPaymentAmountWithinTolerance(Math.round(Number(event.amount)), expected);
  }) ?? null;
}

export function paidInvoiceForRepair(invoices: PaymentCaseInvoiceEvidence[]): PaymentCaseInvoiceEvidence | null {
  return invoices.find((invoice) => invoice.invoiceNumber?.startsWith("INV-") &&
    (invoice.status === "PAID" || (invoice.status === "CUSTOMER_PAID" && Boolean(invoice.receiptNumber))) &&
    matchedSuccess(invoice)) ?? null;
}

/** A linked, authenticated provider event is evidence only when the amount and
 * currency match the customer invoice. Unmatched events and screenshots never pass. */
export function verifiedSuccessForRepair(invoices: PaymentCaseInvoiceEvidence[]):
  { invoice: PaymentCaseInvoiceEvidence; event: PaymentCaseEventEvidence } | null {
  for (const invoice of invoices) {
    if (!invoice.invoiceNumber?.startsWith("INV-")) continue;
    // Coral's historical event amount is populated from the invoice rather
    // than the decrypted provider notice. Require a settled Coral invoice.
    const event = matchedSuccess(invoice, "AZAMPAY");
    if (event) return { invoice, event };
  }
  return null;
}

export function paymentCaseEvidenceState(booking: {
  status: string;
  code: { status: string } | null;
  invoices: PaymentCaseInvoiceEvidence[];
}): "CODE_READY" | "PAID_NEEDS_REPAIR" | "VERIFIED_EVENT" | "PROCESSING" | "AWAITING_PROVIDER" | "CLOSED_BOOKING" {
  if (booking.status === "CANCELED") return "CLOSED_BOOKING";
  if (booking.code?.status === "ACTIVE" && booking.status !== "NEW") return "CODE_READY";
  if (paidInvoiceForRepair(booking.invoices)) return "PAID_NEEDS_REPAIR";
  if (verifiedSuccessForRepair(booking.invoices)) return "VERIFIED_EVENT";
  if (booking.invoices.some((invoice) => invoice.status === "PROCESSING")) return "PROCESSING";
  return "AWAITING_PROVIDER";
}
