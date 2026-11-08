/**
 * How long a room-booking payment may stay "processing", and how it ends.
 *
 * A booking invoice moves to PROCESSING when a provider accepts a checkout
 * (mobile money push, card or bank session). It must then end in one of:
 *   - PAID: a verified provider success (unchanged, see markInvoicePaid);
 *   - FAILED: the provider reported a failure, so the invoice is released at once;
 *   - NO RESULT: the provider stayed silent past the limit, so it is released.
 *
 * "Released" means the invoice goes back to PENDING, so the traveller can pay
 * again inside the 12 hour window and the normal expiry and 7 day clean-up
 * apply afterwards. It never deletes anything and never marks anything paid.
 * A late success still settles: markInvoicePaid claims any non-PAID invoice,
 * and the paymentRef the provider echoes is kept.
 */
import { prisma } from "@nolsaf/prisma";
import { retentionFields } from "./auditRetention.js";

/** A mobile money PIN prompt times out on the handset within about 2 minutes. */
export const MOBILE_MONEY_NO_RESULT_MS = 5 * 60_000;
/** Card and bank sessions (3-D Secure, bank page) close within about 15 minutes. */
export const CARD_NO_RESULT_MS = 15 * 60_000;
/** After this, the traveller sees "we have not heard back" instead of "processing". */
export const MOBILE_MONEY_SLOW_MS = 2 * 60_000;
export const CARD_SLOW_MS = 5 * 60_000;

/** The worker only touches attempts this recent. Older stuck rows wait for an approved tidy-up. */
export const NO_RESULT_LOOKBACK_MS = 48 * 60 * 60_000;

export const PROVIDER_FAILED_STATUSES = ["FAILED", "FAILURE", "CANCELLED", "CANCELED", "REJECTED", "EXPIRED", "DECLINED"];

export type PaymentChannelKind = "MOBILE_MONEY" | "CARD";

export function paymentChannelKind(paymentMethod?: string | null): PaymentChannelKind {
  return /card|bank|coral/i.test(String(paymentMethod || "")) ? "CARD" : "MOBILE_MONEY";
}

export function noResultLimitMs(paymentMethod?: string | null): number {
  return paymentChannelKind(paymentMethod) === "CARD" ? CARD_NO_RESULT_MS : MOBILE_MONEY_NO_RESULT_MS;
}

export function slowAfterMs(paymentMethod?: string | null): number {
  return paymentChannelKind(paymentMethod) === "CARD" ? CARD_SLOW_MS : MOBILE_MONEY_SLOW_MS;
}

type EventLike = { status: string; createdAt: Date | string };

/**
 * What the traveller should be told about the latest attempt on an unpaid
 * booking invoice. Display only: it never changes stored state.
 */
export function bookingPaymentOutcome(
  invoice: { status: string; paymentMethod?: string | null; updatedAt: Date | string; paymentEvents: EventLike[] } | null,
  now = new Date(),
): { state: "PROCESSING" | "SLOW" | "FAILED" | "NO_RESULT" | null; since: string | null } {
  if (!invoice) return { state: null, since: null };
  const events = [...invoice.paymentEvents].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  if (events.some((event) => event.status === "SUCCESS")) return { state: null, since: null };
  const latest = events[0];
  const latestFailed = latest ? PROVIDER_FAILED_STATUSES.includes(String(latest.status).toUpperCase()) : false;

  if (invoice.status === "PROCESSING") {
    if (latestFailed) return { state: "FAILED", since: new Date(latest!.createdAt).toISOString() };
    const startedAt = new Date(invoice.updatedAt).getTime();
    const age = now.getTime() - startedAt;
    if (age >= noResultLimitMs(invoice.paymentMethod)) return { state: "NO_RESULT", since: new Date(startedAt).toISOString() };
    return { state: age >= slowAfterMs(invoice.paymentMethod) ? "SLOW" : "PROCESSING", since: new Date(startedAt).toISOString() };
  }
  // Released back to PENDING after an attempt: say how that attempt ended.
  if (invoice.status === "PENDING" && invoice.paymentMethod && latest) {
    return { state: latestFailed ? "FAILED" : "NO_RESULT", since: new Date(latest.createdAt).toISOString() };
  }
  return { state: null, since: null };
}

/** Only a customer booking invoice on a still-unconfirmed booking can be released. */
function releasableWhere(invoiceId: number) {
  return {
    id: invoiceId,
    status: "PROCESSING",
    invoiceNumber: { startsWith: "INV-" },
    booking: { is: { status: "NEW" } },
    paymentEvents: { none: { status: "SUCCESS" } },
  };
}

async function auditRelease(invoiceId: number, bookingId: number | null, reason: "PROVIDER_FAILED" | "NO_RESULT", detail: Record<string, unknown>) {
  try {
    const at = new Date();
    await prisma.auditLog.create({
      data: {
        actorId: null,
        actorRole: "SYSTEM",
        action: reason === "PROVIDER_FAILED" ? "BOOKING_PAYMENT_FAILED_RELEASED" : "BOOKING_PAYMENT_NO_RESULT_RELEASED",
        entity: "INVOICE",
        entityId: invoiceId,
        beforeJson: { status: "PROCESSING" },
        afterJson: { status: "PENDING", bookingId, reason, ...detail },
        ip: null,
        ua: null,
        createdAt: at,
        ...retentionFields("OPERATIONAL", at),
      } as any,
    });
  } catch (error: any) {
    console.error("[booking-payment-attempt] audit failed", { invoiceId, message: error?.message });
  }
}

/**
 * The provider said this attempt failed: release the invoice now, unless a
 * different attempt on the same invoice is still waiting for its answer.
 * `attemptKeys` identify events of the failed attempt (its event id, or the
 * payment reference prefix the provider and our initiate step share).
 */
export async function releaseFailedBookingPayment(invoiceId: number | null | undefined, attemptKeys: Array<string | null | undefined>, provider: string): Promise<boolean> {
  if (!invoiceId) return false;
  const keys = attemptKeys.map((key) => String(key || "").trim()).filter((key) => key.length >= 6);
  try {
    const invoice = await prisma.invoice.findFirst({
      where: releasableWhere(invoiceId) as any,
      select: { id: true, bookingId: true, paymentMethod: true, updatedAt: true, paymentEvents: { where: { status: "PENDING" }, select: { eventId: true, createdAt: true } } },
    });
    if (!invoice) return false;
    const limit = noResultLimitMs(invoice.paymentMethod);
    const otherLive = invoice.paymentEvents.some((event) =>
      !keys.some((key) => String(event.eventId).startsWith(key)) && Date.now() - new Date(event.createdAt).getTime() < limit);
    if (otherLive) return false;
    const released = await prisma.invoice.updateMany({
      where: { ...releasableWhere(invoiceId), updatedAt: invoice.updatedAt } as any,
      data: { status: "PENDING" },
    });
    if (released.count !== 1) return false;
    await auditRelease(invoice.id, invoice.bookingId ?? null, "PROVIDER_FAILED", { provider });
    return true;
  } catch (error: any) {
    console.error("[booking-payment-attempt] failed-release error", { invoiceId, message: error?.message });
    return false;
  }
}

/**
 * Release attempts the provider never answered. Runs every minute. Only
 * recent attempts are touched; anything older is left for an approved tidy-up.
 */
export async function releaseSilentBookingPayments(now = new Date()): Promise<{ checked: number; released: number }> {
  const result = { checked: 0, released: 0 };
  const candidates = await prisma.invoice.findMany({
    where: {
      status: "PROCESSING",
      invoiceNumber: { startsWith: "INV-" },
      booking: { is: { status: "NEW" } },
      paymentEvents: { none: { status: "SUCCESS" } },
      updatedAt: { lt: new Date(now.getTime() - MOBILE_MONEY_NO_RESULT_MS), gte: new Date(now.getTime() - NO_RESULT_LOOKBACK_MS) },
    } as any,
    select: { id: true, bookingId: true, paymentMethod: true, updatedAt: true, paymentEvents: { where: { status: "PENDING" }, select: { createdAt: true } } },
    orderBy: { updatedAt: "asc" },
    take: 100,
  });

  for (const invoice of candidates) {
    result.checked++;
    const limit = noResultLimitMs(invoice.paymentMethod);
    if (now.getTime() - invoice.updatedAt.getTime() < limit) continue;
    // A newer push or callback still inside its limit keeps the attempt alive.
    if (invoice.paymentEvents.some((event) => now.getTime() - event.createdAt.getTime() < limit)) continue;
    const released = await prisma.invoice.updateMany({
      where: { ...releasableWhere(invoice.id), updatedAt: invoice.updatedAt } as any,
      data: { status: "PENDING" },
    });
    if (released.count !== 1) continue;
    result.released++;
    await auditRelease(invoice.id, invoice.bookingId ?? null, "NO_RESULT", {
      channel: paymentChannelKind(invoice.paymentMethod),
      waitedMinutes: Math.round((now.getTime() - invoice.updatedAt.getTime()) / 60_000),
    });
  }
  return result;
}

export function startBookingPaymentNoResultWorker({ intervalMs = 60_000 }: { intervalMs?: number } = {}): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await releaseSilentBookingPayments();
      if (r.released > 0) console.log(`[booking-payment-attempt] released ${r.released} of ${r.checked} silent payment attempt(s)`);
    } catch (error: any) {
      console.error("[booking-payment-attempt] worker failed", error?.message ?? error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[booking-payment-attempt] started, interval ${intervalMs / 1000}s`);
}
