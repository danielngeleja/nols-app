/** Allow the signed webhook and the existing reconciliation worker to finish
 * before inviting a traveller to report a still-processing accommodation. */
export const PAYMENT_CASE_REPORT_WAIT_MS = 15 * 60_000;

type AttemptEvent = { status: string; createdAt: Date | string };
type AttemptInvoice = {
  invoiceNumber?: string | null;
  status: string;
  receiptNumber?: string | null;
  updatedAt: Date | string;
  paymentEvents: AttemptEvent[];
};

export type PaymentReportEligibility = {
  state: "CODE_AVAILABLE" | "READY" | "WAITING" | "UNVERIFIED";
  availableAt: string | null;
};

export function paymentReportEligibility(booking: {
  status: string;
  code: { status: string } | null;
  invoices: AttemptInvoice[];
}, now = new Date()): PaymentReportEligibility {
  if (booking.code?.status === "ACTIVE" && booking.status !== "NEW") {
    return { state: "CODE_AVAILABLE", availableAt: null };
  }

  const customerInvoices = booking.invoices.filter((invoice) => invoice.invoiceNumber?.startsWith("INV-"));
  if (customerInvoices.some((invoice) => invoice.status === "PAID" ||
    (invoice.status === "CUSTOMER_PAID" && Boolean(invoice.receiptNumber)) ||
    invoice.paymentEvents.some((event) => event.status === "SUCCESS"))) {
    return { state: "READY", availableAt: null };
  }

  // A failed provider result is not an in-flight payment. The customer may
  // still dispute it, but the report starts as unverified.
  const inFlight = customerInvoices.flatMap((invoice) => {
    const latest = [...invoice.paymentEvents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
    if (latest) return latest.status === "PENDING" ? [new Date(latest.createdAt).getTime()] : [];
    return invoice.status === "PROCESSING" ? [new Date(invoice.updatedAt).getTime()] : [];
  }).filter(Number.isFinite);
  if (inFlight.length) {
    const availableAt = new Date(Math.max(...inFlight) + PAYMENT_CASE_REPORT_WAIT_MS);
    if (availableAt.getTime() > now.getTime()) return { state: "WAITING", availableAt: availableAt.toISOString() };
    return { state: "READY", availableAt: null };
  }
  return { state: "UNVERIFIED", availableAt: null };
}
