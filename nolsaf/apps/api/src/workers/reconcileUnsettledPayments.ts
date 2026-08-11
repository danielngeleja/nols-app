/**
 * Money-in reconciliation — the counterpart to reconcileProcessingDisbursements.
 *
 * The payout side already has a fallback for missed provider callbacks. The
 * collection side did not, and that was the gap: the AzamPay webhook writes the
 * PaymentEvent row BEFORE it runs settlement (markInvoicePaid and friends), and
 * those are not in the same transaction. A crash, deploy, DB blip or a receipt
 * number collision between the two leaves a SUCCESS event whose invoice was
 * never marked paid. The customer's money is gone and the booking never confirms.
 *
 * The webhook itself no longer short-circuits on the event row alone (it checks
 * whether the target actually settled), so an AzamPay retry can now heal this.
 * But AzamPay does not retry forever, and for some flows it never retries at all.
 * This worker is the backstop: find SUCCESS events whose target is still
 * unsettled past a grace window, re-run the same idempotent settlement path the
 * webhook uses, and escalate to admins anything that will not settle.
 *
 * It never invents a payment. It only re-runs settlement for money a verified,
 * signature-checked provider callback already told us arrived, and every
 * settlement helper it calls re-checks the amount itself.
 */

import { prisma } from "@nolsaf/prisma";
import { notifyAdmins } from "../lib/notifications.js";
import {
  markInvoicePaid,
  markTourBookingPaid,
  markGroupBookingDepositPaid,
} from "../routes/webhooks.payments.js";
import { expectedInvoicePaymentAmount, isPaymentAmountWithinTolerance } from "../lib/paymentAmount.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000;

/**
 * How long to leave a SUCCESS event alone before treating it as stuck. The
 * webhook settles synchronously, so anything still unsettled after this either
 * failed mid-flight or was never matched. Long enough not to race a slow
 * in-flight request, short enough that a guest is not left waiting.
 */
const DEFAULT_GRACE_MS = 10 * 60_000;

/** Stop retrying and escalate instead once an event has been stuck this long. */
const DEFAULT_ESCALATE_AFTER_MS = 60 * 60_000;

/** Never scan the whole table; the backlog is drained across runs. */
const BATCH_SIZE = 100;

export interface UnsettledPaymentResult {
  checked: number;
  settled: number;
  stillStuck: number;
  escalated: number;
  errors: number;
}

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

/** Has an admin already been told about this event? One alert per event, ever. */
async function alreadyEscalated(paymentEventId: number): Promise<boolean> {
  try {
    const existing = await prisma.notification.findFirst({
      where: {
        userId: null,
        ownerId: null,
        AND: [
          { meta: { path: "$.paymentEventId", equals: paymentEventId } as any },
          { meta: { path: "$.notificationKind", equals: "payment_stuck_unsettled" } as any },
        ],
      } as any,
      select: { id: true },
    });
    return !!existing;
  } catch {
    // If the JSON filter is unavailable, prefer a duplicate alert over silence.
    return false;
  }
}

export async function reconcileUnsettledPayments(now = new Date()): Promise<UnsettledPaymentResult> {
  const graceMs = envMs("PAYMENT_RECONCILE_GRACE_MS", DEFAULT_GRACE_MS);
  const escalateAfterMs = envMs("PAYMENT_RECONCILE_ESCALATE_AFTER_MS", DEFAULT_ESCALATE_AFTER_MS);

  const result: UnsettledPaymentResult = { checked: 0, settled: 0, stillStuck: 0, escalated: 0, errors: 0 };

  // Only events that resolved to something. Events that matched nothing are a
  // different problem (they alert at webhook time and surface under the admin
  // unmatched tab); this worker cannot settle what it cannot identify.
  const candidates = await prisma.paymentEvent.findMany({
    where: {
      status: "SUCCESS",
      createdAt: { lt: new Date(now.getTime() - graceMs) },
      OR: [
        { invoice: { is: { status: { not: "PAID" } } } },
        { tourBooking: { is: { paymentStatus: { not: "PAID" } } } },
        { groupBooking: { is: { depositPaid: false } } },
      ],
    },
    select: {
      id: true,
      provider: true,
      eventId: true,
      amount: true,
      phone: true,
      createdAt: true,
      payload: true,
      invoiceId: true,
      tourBookingId: true,
      groupBookingId: true,
      invoice: { select: { id: true, status: true, paymentMethod: true, total: true, netPayable: true } },
      tourBooking: { select: { id: true, paymentStatus: true } },
      groupBooking: {
        select: {
          id: true, userId: true, depositAmount: true, depositPaid: true, currency: true,
          assignedOwnerId: true, confirmedPropertyId: true, checkIn: true, checkOut: true,
          roomsNeeded: true, toRegion: true, toDistrict: true,
        },
      },
    },
    orderBy: { id: "asc" },
    take: BATCH_SIZE,
  });

  for (const event of candidates) {
    result.checked++;
    const amount = Math.round(Number(event.amount ?? 0));
    const stuckForMs = now.getTime() - event.createdAt.getTime();
    const payloadRef = (event.payload as any)?.paymentRef ?? null;
    const ref = String(payloadRef || event.eventId);

    let settled = false;
    try {
      if (event.invoice && event.invoice.status !== "PAID") {
        const expected = expectedInvoicePaymentAmount(event.invoice);
        if (!isPaymentAmountWithinTolerance(amount, expected)) {
          console.error(
            `[payment-reconciliation] Refusing amount mismatch for invoice ${event.invoice.id}: ` +
            `expected ${expected} TZS, received ${amount} TZS (event ${event.id}).`
          );
        } else {
          await markInvoicePaid(
            event.invoice.id,
            event.provider,
            ref,
            event.phone ?? undefined,
            event.invoice.paymentMethod ?? event.provider,
            event.eventId,
            amount
          );
          const after = await prisma.invoice.findUnique({
            where: { id: event.invoice.id },
            select: { status: true },
          });
          settled = after?.status === "PAID";
        }
      } else if (event.tourBooking && event.tourBooking.paymentStatus !== "PAID") {
        const r = await markTourBookingPaid(event.tourBooking.id, amount, event.provider);
        settled = r.ok;
      } else if (event.groupBooking && !event.groupBooking.depositPaid) {
        const r = await markGroupBookingDepositPaid(event.groupBooking as any, amount, event.provider);
        settled = r.ok;
      } else {
        // Settled by something else between the query and now.
        settled = true;
      }
    } catch (e: any) {
      result.errors++;
      console.error(
        `[payment-reconciliation] Event ${event.id} (${event.eventId}) failed to settle:`,
        e?.message ?? e
      );
    }

    if (settled) {
      result.settled++;
      console.info(
        `[payment-reconciliation] Recovered stranded payment: event ${event.id} (${event.eventId}) ` +
        `settled after ${Math.round(stuckForMs / 60_000)} min stuck.`
      );
      continue;
    }

    result.stillStuck++;

    // Past the escalation window it is not a transient failure. A human has to
    // look at it, because the customer has already paid.
    if (stuckForMs >= escalateAfterMs && !(await alreadyEscalated(event.id))) {
      const target =
        event.invoiceId ? `Invoice ${event.invoiceId}`
        : event.tourBookingId ? `Tour booking ${event.tourBookingId}`
        : event.groupBookingId ? `Group booking ${event.groupBookingId}`
        : "Unknown target";
      await notifyAdmins("payment_stuck_unsettled", {
        paymentEventId: event.id,
        eventId: event.eventId,
        target,
        amount,
        stuckMinutes: Math.round(stuckForMs / 60_000),
        actionUrl: "/admin/payments",
      }).catch(() => { /* alerting must never break the loop */ });
      result.escalated++;
      console.error(
        `[payment-reconciliation] ESCALATED: ${target} still unsettled ${Math.round(stuckForMs / 60_000)} min ` +
        `after a SUCCESS callback (event ${event.id}, amount ${amount}).`
      );
    }
  }

  return result;
}

export function startUnsettledPaymentReconciliationWorker(
  { intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number } = {}
): void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const r = await reconcileUnsettledPayments();
      if (r.checked > 0) {
        console.log(
          `[payment-reconciliation] checked ${r.checked}, settled ${r.settled}, ` +
          `still stuck ${r.stillStuck}, escalated ${r.escalated}, errors ${r.errors}`
        );
      }
    } catch (error) {
      console.error("[payment-reconciliation] worker failed", error);
    } finally {
      running = false;
    }
  };
  void run();
  setInterval(() => void run(), intervalMs);
  console.log(`[payment-reconciliation] started, interval ${intervalMs / 1000}s`);
}
