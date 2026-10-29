/** Admin-facing classification. The stored booking and invoice statuses remain
 * authoritative; this only decides where an unpaid checkout appears in the UI. */
export type BookingAttemptState =
  | "ABANDONED"
  | "AWAITING_PAYMENT"
  | "EXPIRED_UNPAID"
  | "PAYMENT_PROCESSING"
  | "PAYMENT_REVIEW";

export const BOOKING_PAYMENT_WINDOW_MS = 12 * 60 * 60 * 1000;

type InvoiceEvidence = { status: string; receiptNumber?: string | null; paymentEvents?: readonly { status: string }[] };
type BookingEvidence = {
  status: string;
  createdAt: Date | string;
  invoices?: readonly InvoiceEvidence[];
};

export function classifyBookingAttempt(
  booking: BookingEvidence,
  now = new Date(),
): { state: BookingAttemptState; expiresAt: Date; needsReview: boolean } | null {
  if (String(booking.status).toUpperCase() !== "NEW") return null;

  const expiresAt = new Date(new Date(booking.createdAt).getTime() + BOOKING_PAYMENT_WINDOW_MS);
  const invoices = booking.invoices ?? [];
  if (invoices.length === 0) return { state: "ABANDONED", expiresAt, needsReview: false };

  const statuses = invoices.map((invoice) => String(invoice.status).toUpperCase());
  // A payment signal on a still-NEW booking requires reconciliation; it must
  // never be represented as a successful stay or silently purged.
  if (statuses.some((status) => status === "PAID" || status === "CUSTOMER_PAID") || invoices.some((invoice) => invoice.paymentEvents?.some((event) => String(event.status).toUpperCase() === "SUCCESS"))) {
    return { state: "PAYMENT_REVIEW", expiresAt, needsReview: true };
  }
  if (statuses.includes("PROCESSING")) {
    return {
      state: "PAYMENT_PROCESSING",
      expiresAt,
      needsReview: now.getTime() >= expiresAt.getTime(),
    };
  }
  return {
    state: now.getTime() < expiresAt.getTime() ? "AWAITING_PAYMENT" : "EXPIRED_UNPAID",
    expiresAt,
    needsReview: false,
  };
}
