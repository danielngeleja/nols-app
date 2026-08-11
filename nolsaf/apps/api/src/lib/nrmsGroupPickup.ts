// apps/api/src/lib/nrmsGroupPickup.ts
//
// Pickup: turning one held block room into a real reservation. Two callers need
// exactly this behaviour, the desk naming a guest by hand and the desk
// confirming an accepted rooming list row, so it lives here once instead of
// being copied and drifting.
//
// The inventory move is deliberately net-neutral. Before cut-off the block is
// already consuming this room, so creating the reservation and incrementing
// pickedUp cancel out and no availability check is needed or wanted: checking
// would count the block's own held room as a competitor and refuse a pickup the
// block itself guaranteed. After cut-off the block has stopped consuming and
// the rooms are genuinely back on sale, so a real availability check applies.
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { sanitizeText } from "./sanitize.js";
import { generateNrmsRandomCode } from "./pdfDocuments.js";
import { findUnitConflicts, getRoomTypesAvailability, lockPropertyInventory } from "./nrmsAvailability.js";
import { routeRoomToMasterFolio } from "./nrmsMasterFolio.js";

/** A block still holding rooms. Terminal states stop consuming inventory. */
export const BLOCK_LIVE_STATUSES = ["HELD", "PARTIALLY_PICKED_UP"];

/**
 * The pickup transaction takes the property inventory lock, re-reads the block
 * and its line, writes the reservation, its allocation and its events, and
 * updates the block. Prisma's 5s interactive default is too tight for that.
 */
export const PICKUP_TX_OPTIONS = { maxWait: 5000, timeout: 15000 };

/** Thrown when a concurrent writer claimed the same room or row first. */
export const PICKUP_RACE = "NRMS_BLOCK_PICKUP_RACE";

export type PickupErrorCode =
  | "BLOCK_NOT_FOUND"
  | "BLOCK_NOT_LIVE"
  | "LINE_NOT_FOUND"
  | "LINE_EXHAUSTED"
  | "NO_LONGER_AVAILABLE"
  | "ROOM_CONFLICT"
  | "ROW_NOT_PICKABLE";

export type PickupOutcome =
  | { error: PickupErrorCode; conflicts?: unknown[] }
  | { reservationId: number; groupId: number; stillHeld: number };

export type PickupArgs = {
  blockId: number;
  ownerId: number;
  blockRoomId: number;
  guestProfileId: number;
  adults: number;
  children: number;
  roomUnitId?: number | null;
  notes?: string | null;
  /**
   * Set when the pickup came from a rooming list. The row's reservationId is
   * written in the same transaction and its UNIQUE constraint, not a status
   * check, is what makes double pickup impossible.
   */
  roomingListRowId?: number | null;
  /** Whoever pressed the button, recorded on the reservation and its events. */
  actorId: number;
};

function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/**
 * A reservation reference for one room out of a block: the block's own
 * reference with a room number after it, so a folio reads BLK-XXXX-AAA-03 and
 * the desk can tell at a glance which agreement produced it.
 *
 * It cannot simply be the block reference, because Reservation is unique on
 * (propertyId, source, externalRef) and every room of a block would then be the
 * same row. Numbering runs off the highest suffix already issued rather than a
 * count, so a reservation being removed can never hand its number to a second
 * stay. The caller holds the property inventory lock, which is what makes the
 * read-then-write safe against a concurrent pickup.
 */
async function nextBlockExternalRef(tx: any, propertyId: number, blockReference: string): Promise<string> {
  const issued = await tx.reservation.findMany({
    where: { propertyId, source: "DIRECT", externalRef: { startsWith: `${blockReference}-` } },
    select: { externalRef: true },
  });
  const highest = issued.reduce((max: number, row: { externalRef: string | null }) => {
    const suffix = Number((row.externalRef ?? "").slice(blockReference.length + 1));
    return Number.isInteger(suffix) && suffix > max ? suffix : max;
  }, 0);
  return `${blockReference}-${String(highest + 1).padStart(2, "0")}`;
}

export function nightsBetween(checkIn: Date, checkOut: Date): number {
  return Math.max(1, Math.round((utcDay(checkOut).getTime() - utcDay(checkIn).getTime()) / 86_400_000));
}

/**
 * Names one held room. Runs inside `tx`, which must be an interactive
 * transaction: the property inventory lock is taken here and every check below
 * depends on holding it.
 */
export async function pickUpBlockRoom(tx: any, args: PickupArgs): Promise<PickupOutcome> {
  const located = await tx.nrmsGroupBlock.findFirst({
    where: { id: args.blockId, ownerId: args.ownerId },
    select: { propertyId: true },
  });
  if (!located) return { error: "BLOCK_NOT_FOUND" };
  await lockPropertyInventory(tx, located.propertyId);

  // Re-read under the lock: the block may have been released, or another clerk
  // may have created its group, between the caller's read and this one.
  const block = await tx.nrmsGroupBlock.findFirst({ where: { id: args.blockId, ownerId: args.ownerId } });
  if (!block) return { error: "BLOCK_NOT_FOUND" };
  if (!BLOCK_LIVE_STATUSES.includes(block.status)) return { error: "BLOCK_NOT_LIVE" };

  const propertyId = block.propertyId as number;

  if (args.roomingListRowId != null) {
    const row = await tx.nrmsRoomingListRow.findFirst({
      where: { id: args.roomingListRowId, roomingList: { blockId: block.id } },
      select: { id: true, status: true, reservationId: true },
    });
    if (!row || row.status !== "ACCEPTED" || row.reservationId != null) return { error: "ROW_NOT_PICKABLE" };
  }

  // Re-read the line under the lock: two clerks naming the last room of the
  // same type at once must not both succeed.
  const line = await tx.nrmsGroupBlockRoom.findFirst({ where: { id: args.blockRoomId, blockId: block.id } });
  if (!line) return { error: "LINE_NOT_FOUND" };
  if (line.pickedUp >= line.quantity) return { error: "LINE_EXHAUSTED" };

  const cutOffPassed = new Date(block.cutOffAt).getTime() <= Date.now();
  if (cutOffPassed) {
    const availability = await getRoomTypesAvailability(tx, propertyId, [line.roomTypeId], block.checkIn, block.checkOut);
    const capacity = availability.get(line.roomTypeId);
    if (!capacity || capacity.available < 1) return { error: "NO_LONGER_AVAILABLE" };
  }

  if (args.roomUnitId != null) {
    const conflicts = await findUnitConflicts(args.roomUnitId, block.checkIn, block.checkOut, { db: tx });
    if (conflicts.length > 0) return { error: "ROOM_CONFLICT", conflicts };
  }

  // The operational group is created on first pickup, not at block time: a
  // block that never picks up should not leave an empty group behind.
  let groupId: number = block.groupId ?? 0;
  if (!groupId) {
    const group = await tx.nrmsReservationGroup.create({
      data: {
        propertyId,
        ownerId: args.ownerId,
        reference: `GRP-${Date.now().toString(36).toUpperCase()}-${generateNrmsRandomCode()}`.slice(0, 32),
        name: block.name,
        notes: block.agencyName ? `Group block ${block.reference} for ${block.agencyName}` : `Group block ${block.reference}`,
        status: "ACTIVE",
        createdById: args.actorId,
      },
    });
    groupId = group.id;
    await tx.nrmsGroupBlock.update({ where: { id: block.id }, data: { groupId } });
  }

  const nightlyRate = Number(line.nightlyRate);
  const stayNights = nightsBetween(block.checkIn, block.checkOut);
  const externalRef = await nextBlockExternalRef(tx, propertyId, block.reference);
  const reservation = await tx.reservation.create({
    data: {
      propertyId,
      ownerId: args.ownerId,
      guestProfileId: args.guestProfileId,
      groupId,
      source: "DIRECT",
      attribution: "OWNER_DIRECT",
      externalRef,
      status: "CONFIRMED",
      confirmedAt: new Date(),
      checkIn: block.checkIn,
      checkOut: block.checkOut,
      adults: args.adults,
      children: args.children,
      currency: block.currency,
      roomRate: nightlyRate,
      totalAmount: nightlyRate * stayNights,
      notes: args.notes ? sanitizeText(args.notes) : null,
      createdById: args.actorId,
    },
  });
  await tx.reservationRoomAllocation.create({
    data: {
      reservationId: reservation.id,
      roomTypeId: line.roomTypeId,
      roomUnitId: args.roomUnitId ?? null,
      startDate: block.checkIn,
      endDate: block.checkOut,
      ratePlanId: line.ratePlanId,
      mealPlan: line.mealPlan,
    },
  });

  // SPLIT and MASTER move payment responsibility for the room onto one agency
  // bill. The Reservation amount stays untouched as the revenue source.
  await routeRoomToMasterFolio(tx, block, reservation);

  // Conditional increment, so a concurrent pickup cannot push pickedUp past
  // quantity even if both passed the read above.
  const claimed = await tx.nrmsGroupBlockRoom.updateMany({
    where: { id: line.id, pickedUp: line.pickedUp },
    data: { pickedUp: line.pickedUp + 1 },
  });
  if (claimed.count !== 1) throw new Error(PICKUP_RACE);

  if (args.roomingListRowId != null) {
    // The UNIQUE on reservationId already forbids two rows sharing a stay; this
    // guard makes the same row confirmed twice fail loudly instead of silently
    // creating a second reservation for one guest.
    const linked = await tx.nrmsRoomingListRow.updateMany({
      where: { id: args.roomingListRowId, reservationId: null },
      data: { reservationId: reservation.id },
    });
    if (linked.count !== 1) throw new Error(PICKUP_RACE);
  }

  await tx.reservationEvent.createMany({
    data: [
      {
        reservationId: reservation.id,
        type: "CREATED",
        actorId: args.actorId,
        data: {
          source: "DIRECT",
          blockId: block.id,
          blockReference: block.reference,
          ...(args.roomingListRowId != null ? { roomingListRowId: args.roomingListRowId } : {}),
        },
      },
      { reservationId: reservation.id, type: "GROUP_ASSIGNED", actorId: args.actorId, data: { groupId, blockReference: block.reference } },
    ],
  });

  const lines = await tx.nrmsGroupBlockRoom.findMany({ where: { blockId: block.id }, select: { quantity: true, pickedUp: true } });
  const stillHeld = lines.reduce((sum: number, row: any) => sum + Math.max(0, row.quantity - row.pickedUp), 0);
  await tx.nrmsGroupBlock.update({
    where: { id: block.id },
    data: { status: stillHeld === 0 ? "PICKED_UP" : "PARTIALLY_PICKED_UP" },
  });

  return { reservationId: reservation.id, groupId, stillHeld };
}

/** One wording per failure, so the desk reads the same sentence everywhere. */
const PICKUP_MESSAGES: Record<PickupErrorCode, string> = {
  BLOCK_NOT_FOUND: "Group block not found",
  BLOCK_NOT_LIVE: "This block is no longer holding rooms",
  LINE_NOT_FOUND: "That room line does not belong to this block",
  LINE_EXHAUSTED: "Every room on that line has already been named",
  NO_LONGER_AVAILABLE: "The deadline for names passed and this room has been sold. Free a room before naming this guest.",
  ROOM_CONFLICT: "That room is already taken for these dates",
  ROW_NOT_PICKABLE: "That name is not accepted, or a stay was already created for it",
};

export function pickupStatus(code: PickupErrorCode): number {
  if (code === "BLOCK_NOT_FOUND") return 404;
  if (code === "LINE_NOT_FOUND") return 400;
  return 409;
}

export function pickupErrorBody(outcome: { error: PickupErrorCode; conflicts?: unknown[] }) {
  return {
    error: PICKUP_MESSAGES[outcome.error],
    code: outcome.error,
    ...(outcome.conflicts ? { conflicts: outcome.conflicts } : {}),
  };
}

/** `pickUpBlockRoom` in its own transaction, for callers naming one room. */
export async function runBlockPickup(args: PickupArgs): Promise<PickupOutcome> {
  return prisma.$transaction(async (tx: any) => pickUpBlockRoom(tx, args), PICKUP_TX_OPTIONS) as Promise<PickupOutcome>;
}

/**
 * Finds or creates the guest profile a pickup will attach to. Kept outside the
 * pickup transaction: it touches no inventory, and the locked section should
 * stay as short as it can be.
 *
 * Matching on phone is safe here because the desk, not the public, supplies it:
 * a rooming list row only reaches this after a member of staff accepted it.
 */
export async function resolveGroupGuestProfile(
  propertyId: number,
  ownerId: number,
  guest: { guestProfileId?: number | null; fullName: string; phone?: string | null; email?: string | null; nationality?: string | null },
): Promise<{ guestProfileId: number } | { error: "GUEST_NOT_FOUND" }> {
  if (guest.guestProfileId) {
    const existing = await prisma.guestProfile.findFirst({ where: { id: guest.guestProfileId, propertyId, ownerId } });
    if (!existing) return { error: "GUEST_NOT_FOUND" };
    return { guestProfileId: existing.id };
  }

  const phone = guest.phone ? sanitizeText(guest.phone) : null;
  const existing = phone ? await prisma.guestProfile.findFirst({ where: { propertyId, phone } }) : null;
  if (existing) {
    const updated = await prisma.guestProfile.update({
      where: { id: existing.id },
      data: {
        fullName: sanitizeText(guest.fullName),
        nationality: guest.nationality ? sanitizeText(guest.nationality) : existing.nationality,
      },
    });
    return { guestProfileId: updated.id };
  }

  const created = await prisma.guestProfile.create({
    data: {
      propertyId,
      ownerId,
      fullName: sanitizeText(guest.fullName),
      phone,
      email: guest.email ? sanitizeText(guest.email) : null,
      nationality: guest.nationality ? sanitizeText(guest.nationality) : null,
    },
  });
  return { guestProfileId: created.id };
}
