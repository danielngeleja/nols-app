/**
 * NRMS Agent B2B — inventory holds.
 *
 * An agent request-to-book hold is deliberately modelled as an ordinary HELD
 * Reservation (source "AGENT", tagged agentPropertyLinkId, with holdExpiresAt)
 * plus its ReservationRoomAllocation rows. That means the shared availability
 * kernel already:
 *   - counts the hold as consuming inventory while holdExpiresAt > now, and
 *   - lazily stops counting it the moment the hold expires (no worker needed
 *     for availability to be correct — same rule a direct guest hold gets).
 *
 * So there is NO new inventory-consumer branch here. This module only provides
 * the state transitions (create hold / instant confirm / approve / decline) and
 * a housekeeping sweep that flips already-expired holds to a terminal status so
 * the hotel's request queue does not show stale rows.
 *
 * Every operation is keyed by a NrmsAgentPropertyLink (one agency x one hotel),
 * so a hold can never cross hotels. Callers pass a link the requester owns.
 */

import { getRoomTypeAvailability, lockPropertyInventory } from "./nrmsAvailability.js";
import { findRestrictionBlocks } from "./nrmsRestrictions.js";

/** Default life of a request-to-book hold before it lapses. */
export const AGENT_HOLD_TTL_MS = 48 * 60 * 60 * 1000; // 48h

export type AgentLinkContext = {
  id: number;
  propertyId: number;
  ownerId: number;
  /** "REQUEST" (request-to-book) or "INSTANT" (instant confirm). */
  bookingMode: string;
};

export type AgentQuoteSnapshot = {
  currency: string;
  nightly: Array<{ date: string; rate: number }>;
  subtotal: number;
  tax: number;
  fees: number;
  total: number;
};

export type CreateAgentHoldInput = {
  link: AgentLinkContext;
  /** Stable per-attempt key supplied by the agent client. */
  clientMutationId: string;
  roomTypeId: number;
  ratePlanId: number | null;
  mealPlan?: string | null;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  roomsRequested: number;
  incidentalBilling: "AGENCY" | "INDIVIDUAL_GUEST";
  quote: AgentQuoteSnapshot;
  createdByUserId?: number | null;
  /** Override the hold TTL (request-to-book only). */
  holdTtlMs?: number;
  /** The caller already holds the shared property inventory row lock. */
  inventoryLocked?: boolean;
  notes?: string | null;
};

export type CreateAgentHoldResult =
  | { ok: true; reservationId: number; requestId: number; status: "HELD" | "CONFIRMED"; holdExpiresAt: Date | null }
  | { ok: false; reason: "NO_AVAILABILITY" | "RESTRICTED"; message: string };

const isInstant = (mode: string) => String(mode).toUpperCase() === "INSTANT";

/**
 * Hold (request-to-book) or directly confirm (instant) inventory for an agent.
 * MUST run inside an interactive transaction; the property inventory lock is
 * taken here so a concurrent booking on the same rooms cannot also pass the
 * availability check.
 */
export async function createAgentHold(tx: any, input: CreateAgentHoldInput): Promise<CreateAgentHoldResult> {
  const rooms = Math.max(1, Math.floor(input.roomsRequested));
  if (!input.inventoryLocked) await lockPropertyInventory(tx, input.link.propertyId);

  // The negotiated quote was computed before the lock. Re-check both live
  // availability and rate restrictions after it so a stop-sell or a sell-out
  // that landed during the request wins over this in-flight hold.
  const availability = await getRoomTypeAvailability(tx, input.link.propertyId, input.roomTypeId, input.checkIn, input.checkOut);
  if (availability.available < rooms) {
    return { ok: false, reason: "NO_AVAILABILITY", message: "Those rooms are no longer available for the selected dates." };
  }
  const restrictionBlocks = await findRestrictionBlocks(tx, {
    propertyId: input.link.propertyId,
    roomTypeId: input.roomTypeId,
    ratePlanId: input.ratePlanId,
    checkIn: input.checkIn,
    checkOut: input.checkOut,
    channelCode: "AGENT",
  });
  if (restrictionBlocks.length) {
    return { ok: false, reason: "RESTRICTED", message: restrictionBlocks[0]!.message };
  }

  const instant = isInstant(input.link.bookingMode);
  const now = new Date();
  const holdExpiresAt = instant ? null : new Date(now.getTime() + (input.holdTtlMs ?? AGENT_HOLD_TTL_MS));
  const status: "HELD" | "CONFIRMED" = instant ? "CONFIRMED" : "HELD";
  // The quote is per room for the stay; the booking is that times the room count.
  const bookingTax = Number((input.quote.tax * rooms).toFixed(2));
  const bookingTotal = Number((input.quote.total * rooms).toFixed(2));

  const reservation = await tx.reservation.create({
    data: {
      propertyId: input.link.propertyId,
      ownerId: input.link.ownerId,
      agentPropertyLinkId: input.link.id,
      source: "AGENT",
      attribution: "OWNER_DIRECT", // hotel's own B2B channel, not the marketplace
      status,
      holdExpiresAt,
      confirmedAt: instant ? now : null,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: input.adults,
      children: input.children,
      currency: input.quote.currency,
      roomRate: input.quote.nightly[0]?.rate ?? 0,
      taxAmount: bookingTax,
      totalAmount: bookingTotal,
      notes: input.notes ?? null,
      createdById: input.createdByUserId ?? null,
      allocations: {
        create: Array.from({ length: rooms }, () => ({
          roomTypeId: input.roomTypeId,
          startDate: input.checkIn,
          endDate: input.checkOut,
          ratePlanId: input.ratePlanId,
          mealPlan: input.mealPlan ?? null,
        })),
      },
      events: {
        create: {
          type: instant ? "CONFIRMED" : "CREATED",
          actorId: input.createdByUserId ?? null,
          data: { source: "AGENT", agentPropertyLinkId: input.link.id, ratePlanId: input.ratePlanId, rooms },
        },
      },
    },
    select: { id: true },
  });

  // Uniform history: a PENDING request for the queue, or a CONFIRMED record for
  // instant. The hotel's approval queue filters on status = PENDING.
  const request = await tx.nrmsAgentBookingRequest.create({
    data: {
      linkId: input.link.id,
      propertyId: input.link.propertyId,
      clientMutationId: input.clientMutationId,
      status: instant ? "CONFIRMED" : "PENDING",
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      adults: input.adults,
      children: input.children,
      roomTypeId: input.roomTypeId,
      roomsRequested: rooms,
      currency: input.quote.currency,
      quotedTotal: bookingTotal,
      holdExpiresAt,
      reservationId: reservation.id,
      decidedByUserId: instant ? (input.createdByUserId ?? null) : null,
      decidedAt: instant ? now : null,
      notes: input.notes ?? null,
      incidentalBilling: input.incidentalBilling,
    },
    select: { id: true },
  });

  return { ok: true, reservationId: reservation.id, requestId: request.id, status, holdExpiresAt };
}

export type DecideAgentHoldResult =
  | { ok: true; reservationId: number }
  | { ok: false; reason: "NOT_PENDING" | "HOLD_EXPIRED" | "NOT_FOUND"; message: string };

/**
 * Approve a request-to-book hold: PENDING -> CONFIRMED. The rooms are already
 * held by the HELD reservation, so approval only flips state — no re-check and
 * no extra consumption. A hold that already lapsed cannot be approved.
 */
export async function approveAgentHold(tx: any, requestId: number, decidedByUserId: number, reason?: string): Promise<DecideAgentHoldResult> {
  const seed = await tx.nrmsAgentBookingRequest.findUnique({ where: { id: requestId }, select: { propertyId: true } });
  if (!seed) return { ok: false, reason: "NOT_FOUND", message: "Request not found." };
  await lockPropertyInventory(tx, seed.propertyId);
  const request = await tx.nrmsAgentBookingRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, reservationId: true, propertyId: true, reservation: { select: { id: true, status: true, holdExpiresAt: true } } },
  });
  if (!request || !request.reservation) return { ok: false, reason: "NOT_FOUND", message: "Request not found." };
  if (request.status !== "PENDING") return { ok: false, reason: "NOT_PENDING", message: "This request is no longer pending." };
  const res = request.reservation;
  if (res.status !== "HELD" || (res.holdExpiresAt && res.holdExpiresAt <= new Date())) {
    return { ok: false, reason: "HOLD_EXPIRED", message: "The inventory hold has expired." };
  }

  const now = new Date();
  const changed = await tx.reservation.updateMany({
    where: { id: res.id, status: "HELD" },
    data: { status: "CONFIRMED", confirmedAt: now, holdExpiresAt: null },
  });
  if (changed.count !== 1) return { ok: false, reason: "HOLD_EXPIRED", message: "The inventory hold has expired." };

  const requestChanged = await tx.nrmsAgentBookingRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "CONFIRMED", decidedByUserId, decidedAt: now, decisionReason: reason ?? null },
  });
  if (requestChanged.count !== 1) throw new Error("AGENT_REQUEST_STATE_RACE");
  await tx.reservationEvent.create({ data: { reservationId: res.id, type: "CONFIRMED", actorId: decidedByUserId, data: { via: "AGENT_REQUEST_APPROVED" } } });
  return { ok: true, reservationId: res.id };
}

/**
 * Decline a request-to-book hold (hotel reject) or cancel it (agent withdraw):
 * request -> DECLINED/CANCELLED, reservation HELD -> CANCELLED, allocations
 * RELEASED so the rooms free up immediately rather than waiting for expiry.
 */
export async function releaseAgentHold(
  tx: any,
  requestId: number,
  opts: { status: "DECLINED" | "CANCELLED"; decidedByUserId?: number | null; reason?: string | null },
): Promise<DecideAgentHoldResult> {
  const seed = await tx.nrmsAgentBookingRequest.findUnique({ where: { id: requestId }, select: { propertyId: true } });
  if (!seed) return { ok: false, reason: "NOT_FOUND", message: "Request not found." };
  await lockPropertyInventory(tx, seed.propertyId);
  const request = await tx.nrmsAgentBookingRequest.findUnique({
    where: { id: requestId },
    select: { id: true, status: true, reservation: { select: { id: true, status: true } } },
  });
  if (!request || !request.reservation) return { ok: false, reason: "NOT_FOUND", message: "Request not found." };
  if (request.status !== "PENDING") return { ok: false, reason: "NOT_PENDING", message: "This request is no longer pending." };

  const now = new Date();
  const released = await releaseReservationHold(tx, request.reservation.id, { toStatus: "CANCELLED", reason: opts.reason ?? null, actorId: opts.decidedByUserId ?? null, decisionType: opts.status });
  if (!released) return { ok: false, reason: "NOT_PENDING", message: "This request is no longer pending." };
  const requestChanged = await tx.nrmsAgentBookingRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: opts.status, decidedByUserId: opts.decidedByUserId ?? null, decidedAt: now, decisionReason: opts.reason ?? null },
  });
  if (requestChanged.count !== 1) throw new Error("AGENT_REQUEST_STATE_RACE");
  return { ok: true, reservationId: request.reservation.id };
}

/** Flip a HELD reservation to a terminal status and release its active allocations. Idempotent. */
async function releaseReservationHold(
  tx: any,
  reservationId: number,
  opts: { toStatus: "CANCELLED" | "EXPIRED"; reason: string | null; actorId: number | null; decisionType: string },
): Promise<boolean> {
  const changed = await tx.reservation.updateMany({
    where: { id: reservationId, status: "HELD" },
    data: {
      status: opts.toStatus,
      holdExpiresAt: null,
      ...(opts.toStatus === "CANCELLED" ? { cancelledAt: new Date(), cancelReason: opts.reason ?? undefined } : {}),
    },
  });
  if (changed.count !== 1) return false; // already moved on — nothing to release
  await tx.reservationRoomAllocation.updateMany({ where: { reservationId, status: "ACTIVE" }, data: { status: "RELEASED" } });
  await tx.reservationEvent.create({ data: { reservationId, type: opts.toStatus, actorId: opts.actorId, data: { via: opts.decisionType } } });
  return true;
}

/**
 * Housekeeping sweep: flip PENDING requests whose hold has lapsed to EXPIRED and
 * release their reservations. Availability is already correct without this (the
 * kernel ignores expired holds), so this only keeps the request queue clean.
 * Safe to run without a lock — each release is a guarded conditional update.
 */
export async function expireAgentHolds(client: any, opts: { batchSize?: number; now?: Date } = {}): Promise<number> {
  const now = opts.now ?? new Date();
  const batchSize = opts.batchSize ?? 200;
  const stale = await client.nrmsAgentBookingRequest.findMany({
    where: { status: "PENDING", holdExpiresAt: { lt: now } },
    select: { id: true, reservationId: true },
    take: batchSize,
  });
  let expired = 0;
  for (const row of stale) {
    await client.$transaction(async (tx: any) => {
      const seed = await tx.nrmsAgentBookingRequest.findUnique({ where: { id: row.id }, select: { propertyId: true } });
      if (!seed) return;
      await lockPropertyInventory(tx, seed.propertyId);
      const fresh = await tx.nrmsAgentBookingRequest.findUnique({ where: { id: row.id }, select: { status: true, holdExpiresAt: true, reservationId: true } });
      if (!fresh || fresh.status !== "PENDING" || !fresh.holdExpiresAt || fresh.holdExpiresAt >= now) return;
      if (!fresh.reservationId) return;
      const released = await releaseReservationHold(tx, fresh.reservationId, { toStatus: "EXPIRED", reason: null, actorId: null, decisionType: "AGENT_HOLD_EXPIRED" });
      if (!released) return;
      const changed = await tx.nrmsAgentBookingRequest.updateMany({ where: { id: row.id, status: "PENDING", holdExpiresAt: { lt: now } }, data: { status: "EXPIRED", decidedAt: now } });
      if (changed.count !== 1) throw new Error("AGENT_REQUEST_STATE_RACE");
      expired += 1;
    });
  }
  return expired;
}
