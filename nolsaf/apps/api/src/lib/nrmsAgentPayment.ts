/**
 * NRMS Agent B2B — prepaid payment (v1).
 *
 * Agents pay upfront. On a CONFIRMED agent reservation (instant confirm, or once
 * the hotel approves a request-to-book), we raise a NrmsGuestPaymentRequest for
 * the full amount and hand the agent its public token. That reuses the exact
 * payment surface guests use (mobile-money instructions + the hotel's existing
 * settlement flow), so no new payment rails are introduced. Credit/on-account is
 * a later phase.
 */
import crypto from "node:crypto";
import { lockPropertyInventory } from "./nrmsAvailability.js";

// B2B agents commonly pay by bank transfer, which does not clear in an hour, so
// the prepaid window defaults to 24h (not the 30-minute guest hold). Configurable
// via NRMS_AGENT_PREPAY_MINUTES, clamped to [30 min, 7 days].
export const AGENT_PREPAY_DEFAULT_MINUTES = 24 * 60;
const configuredPrepayMinutes = Number(process.env.NRMS_AGENT_PREPAY_MINUTES || AGENT_PREPAY_DEFAULT_MINUTES);
export const AGENT_PREPAY_TTL_MS = Math.min(7 * 24 * 60, Math.max(30, Number.isFinite(configuredPrepayMinutes) ? configuredPrepayMinutes : AGENT_PREPAY_DEFAULT_MINUTES)) * 60_000;

type Db = {
  nrmsGuestPaymentRequest: { findFirst: (a: any) => Promise<any | null>; create: (a: any) => Promise<any>; update: (a: any) => Promise<any> };
};

export type AgentPrepayInput = {
  reservationId: number;
  amount: number;
  currency: string;
  instructions?: unknown;
  dueAt?: Date | null;
};

/**
 * Ensure a single live prepay request exists for the reservation. Idempotent: a
 * repeated call (e.g. re-approval) returns the existing open request rather than
 * raising a duplicate.
 */
export async function ensureAgentPrepayRequest(tx: Db, input: AgentPrepayInput): Promise<{ id: number; publicToken: string }> {
  const existing = await tx.nrmsGuestPaymentRequest.findFirst({
    where: { reservationId: input.reservationId, status: { in: ["PENDING", "PROCESSING"] }, cancelledAt: null },
    select: { id: true, publicToken: true, dueAt: true },
  });
  if (existing) {
    if (!existing.dueAt) {
      await tx.nrmsGuestPaymentRequest.update({ where: { id: existing.id }, data: { dueAt: input.dueAt ?? new Date(Date.now() + AGENT_PREPAY_TTL_MS) } });
    }
    return { id: existing.id, publicToken: existing.publicToken };
  }

  const publicToken = crypto.randomBytes(24).toString("base64url");
  return tx.nrmsGuestPaymentRequest.create({
    data: {
      reservationId: input.reservationId,
      kind: "AGENT_PREPAY",
      amount: input.amount,
      currency: input.currency,
      publicToken,
      dueAt: input.dueAt ?? new Date(Date.now() + AGENT_PREPAY_TTL_MS),
      instructions: input.instructions ?? undefined,
    },
    select: { id: true, publicToken: true },
  });
}

/** Cancel confirmed agent inventory whose prepaid deadline elapsed unpaid. */
export async function expireUnpaidAgentBookings(client: any, opts: { batchSize?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const stale = await client.nrmsGuestPaymentRequest.findMany({
    where: {
      kind: "AGENT_PREPAY", status: { in: ["PENDING", "PROCESSING"] }, cancelledAt: null, dueAt: { lt: now },
      reservation: { status: "CONFIRMED", agentPropertyLinkId: { not: null } },
    },
    select: { id: true, reservationId: true, reservation: { select: { propertyId: true } } },
    take: opts.batchSize ?? 200,
  });
  let expired = 0;
  for (const row of stale) {
    await client.$transaction(async (tx: any) => {
      await lockPropertyInventory(tx, row.reservation.propertyId);
      const request = await tx.nrmsGuestPaymentRequest.findUnique({
        where: { id: row.id },
        select: { id: true, status: true, dueAt: true, cancelledAt: true, amount: true, reservationId: true, reservation: { select: { id: true, status: true, amountPaid: true, agentBookingRequest: { select: { id: true, status: true } } } } },
      });
      if (!request || request.cancelledAt || !["PENDING", "PROCESSING"].includes(request.status) || !request.dueAt || request.dueAt >= now) return;
      if (!request.reservation || request.reservation.status !== "CONFIRMED" || Number(request.reservation.amountPaid) >= Number(request.amount)) return;
      const paymentChanged = await tx.nrmsGuestPaymentRequest.updateMany({ where: { id: request.id, status: { in: ["PENDING", "PROCESSING"] }, cancelledAt: null, dueAt: { lt: now } }, data: { status: "EXPIRED", cancelledAt: now } });
      if (paymentChanged.count !== 1) return;
      const reservationChanged = await tx.reservation.updateMany({ where: { id: request.reservation.id, status: "CONFIRMED" }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Agent prepayment deadline expired" } });
      if (reservationChanged.count !== 1) throw new Error("AGENT_PAYMENT_EXPIRY_STATE_RACE");
      await tx.reservationRoomAllocation.updateMany({ where: { reservationId: request.reservation.id, status: "ACTIVE" }, data: { status: "RELEASED" } });
      await tx.reservationEvent.create({ data: { reservationId: request.reservation.id, type: "CANCELLED", actorId: null, data: { via: "AGENT_PREPAY_EXPIRED", paymentRequestId: request.id } } });
      if (request.reservation.agentBookingRequest?.id) {
        await tx.nrmsAgentBookingRequest.updateMany({ where: { id: request.reservation.agentBookingRequest.id, status: "CONFIRMED" }, data: { status: "EXPIRED", decidedAt: now, decisionReason: "Prepayment deadline expired" } });
      }
      expired += 1;
    });
  }
  return expired;
}
