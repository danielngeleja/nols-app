// Turning a verified agent booking into real rooms.
//
// An agent booking is held as ONE reservation carrying N allocations, which is
// right while the rooms are anonymous: nobody has named a traveller yet. The
// moment the hotel verifies the manifest that stops being right. The hotel now
// needs a folio per traveller, a room number per traveller, and check-in one
// party at a time, which is exactly what a group block already provides.
//
// So verification converts the placeholder into the group model:
//
//   before   1 reservation, 10 allocations, 1 folio, all-or-nothing check-in
//   after    1 block, 1 group, 10 reservations, 10 folios, per-room check-in
//
// The agency's money does not move. NrmsMasterFolio carries both `blockId` and
// `agentBookingRequestId` as nullable unique keys on one row, so the folio the
// agency already paid is simply claimed by the new block as well. One folio,
// one set of payments, two owners that both read it.
//
// This is deliberately a one-way, pre-arrival conversion. It refuses to run
// once any room-night has been billed, because usage billing dedupes on
// allocation id and the new allocations would re-bill nights already posted.

import { lockPropertyInventory } from "./nrmsAvailability.js";
import { generateNrmsRandomCode } from "./pdfDocuments.js";
import { pickUpBlockRoom, PICKUP_RACE } from "./nrmsGroupPickup.js";
import { refreshMasterFolioStatus } from "./nrmsMasterFolio.js";
import { STANDARD_GROUP_MIN_ROOMS } from "./nrmsGroupPolicy.js";

/** Why a conversion did not happen. None of these are errors: the booking keeps
 * working exactly as it did before, on the single-reservation path. */
export type MaterialiseSkip =
  | "ALREADY_MATERIALISED"
  | "NO_RESERVATION"
  | "RESERVATION_NOT_CONFIRMED"
  | "NO_ACTIVE_ALLOCATIONS"
  | "MASTER_FOLIO_MISSING"
  | "NIGHTS_ALREADY_BILLED"
  | "NO_NAMED_TRAVELLERS";

export type MaterialiseOutcome =
  | { ok: true; blockId: number; groupId: number; reservationIds: number[]; roomsLeftUnnamed: number }
  | { ok: false; skipped: MaterialiseSkip };

type Party = { roomNumber: number; adults: number; children: number; lead: any };

/** Travellers grouped into the parties the agency declared, one party per room. */
function partiesFromManifest(guests: any[]): Party[] {
  const byRoom = new Map<number, Party>();
  for (const guest of guests) {
    if (!guest?.fullName) continue;
    const roomNumber = Number(guest.roomNumber) || 1;
    const party = byRoom.get(roomNumber) ?? { roomNumber, adults: 0, children: 0, lead: null };
    if (guest.guestType === "CHILD") party.children += 1;
    else party.adults += 1;
    // The declared lead leads their own room; otherwise the first adult does,
    // because a folio has to be addressed to somebody who can sign for it.
    if (!party.lead || (guest.isLead && party.lead.guestType !== "ADULT") || (!party.lead.isLead && guest.isLead)) {
      if (guest.guestType === "ADULT" || !party.lead) party.lead = guest;
    }
    byRoom.set(roomNumber, party);
  }
  return [...byRoom.values()].sort((a, b) => a.roomNumber - b.roomNumber);
}

/**
 * Re-cut the agency's single room line into one line per room.
 *
 * The invoice already charged the agency for every room as one line
 * (`AGENT_ROOM:<requestId>`). Letting the pick-up route each room onto the folio
 * as well would charge those rooms a second time, reopening a settled bill as
 * "agency bill due". So the aggregate is voided and replaced by lines that sum
 * to exactly the same amount, one per stay.
 *
 * The agency's total never moves. Only its shape does, which is what lets every
 * per-room view read the same way it does for an ordinary group.
 */
export async function reconcileAgencyRoomLines(
  tx: any,
  request: { id: number; checkIn: Date | string; checkOut: Date | string; currency: string; quotedTotal?: unknown; masterFolio?: { id: number } | null },
  reservationIds: number[],
): Promise<{ changed: boolean }> {
  const folioId = request.masterFolio?.id;
  if (!folioId || reservationIds.length === 0) return { changed: false };

  const aggregate = await tx.nrmsMasterFolioItem.findUnique({
    where: { sourceKey: `AGENT_ROOM:${request.id}` },
    select: { id: true, amount: true, currency: true, voidedAt: true },
  });
  // Lines already written per stay, from this reconciler or an earlier run.
  const perStay = await tx.nrmsMasterFolioItem.findMany({
    where: { masterFolioId: folioId, sourceKey: { startsWith: `AGENT_ROOM:${request.id}:` }, voidedAt: null },
    select: { id: true, amount: true },
  });
  // Lines the generic group pick-up wrote before it knew an agency booking had
  // already been invoiced for its rooms. These are the duplicates that reopened
  // a settled bill, and they are voided rather than kept.
  const routed = await tx.nrmsMasterFolioItem.findMany({
    where: { masterFolioId: folioId, sourceKey: { in: reservationIds.map((id) => `ROOM:${id}`) }, voidedAt: null },
    select: { id: true },
  });

  // What the agency was invoiced for the rooms, from whichever line still holds
  // it. The commercial discount is its own folio line and is left alone.
  const gross = aggregate
    ? Number(aggregate.amount ?? 0)
    : perStay.length
      ? perStay.reduce((sum: number, item: any) => sum + Number(item.amount ?? 0), 0)
      : Number(request.quotedTotal ?? 0);
  if (gross <= 0) return { changed: false };

  const rooms = reservationIds.length;
  // Rounded down per room, with the rounding remainder on the last line, so the
  // lines add up to the invoiced total to the cent.
  const share = Math.floor((gross / rooms) * 100) / 100;
  const lines = reservationIds.map((reservationId, index) => ({
    reservationId,
    amount: index === rooms - 1 ? Number((gross - share * (rooms - 1)).toFixed(2)) : share,
  }));

  if (aggregate && !aggregate.voidedAt) {
    await tx.nrmsMasterFolioItem.update({
      where: { id: aggregate.id },
      data: { voidedAt: new Date(), voidReason: "Re-issued as one line per room" },
    });
  }
  for (const duplicate of routed) {
    await tx.nrmsMasterFolioItem.update({
      where: { id: duplicate.id },
      data: { voidedAt: new Date(), voidReason: "Room already invoiced to the agency on this booking" },
    });
  }
  // The invoiced total is what the property actually earns, and it can sit
  // below list price once a commercial discount is applied. Each stay is
  // restated to its share, otherwise the difference between list and invoice
  // would read as an amount the traveller still owes.
  const nights = Math.max(1, Math.round((new Date(request.checkOut).getTime() - new Date(request.checkIn).getTime()) / 86_400_000));
  for (const line of lines) {
    await tx.reservation.update({
      where: { id: line.reservationId },
      data: { totalAmount: line.amount, roomRate: Number((line.amount / nights).toFixed(2)) },
    });
  }
  for (const [index, line] of lines.entries()) {
    await tx.nrmsMasterFolioItem.upsert({
      where: { sourceKey: `AGENT_ROOM:${request.id}:${line.reservationId}` },
      create: {
        masterFolioId: folioId,
        reservationId: line.reservationId,
        sourceKey: `AGENT_ROOM:${request.id}:${line.reservationId}`,
        kind: "ROOM",
        description: `Room ${index + 1} of ${rooms}`,
        amount: line.amount,
        // The aggregate is gone entirely on a booking whose lines were already
        // re-cut, so the booking's own currency is the fallback.
        currency: aggregate?.currency ?? request.currency,
      },
      update: { amount: line.amount, voidedAt: null, voidReason: null },
    });
  }
  await refreshMasterFolioStatus(tx, folioId);
  return { changed: true };
}

/**
 * Re-check the agency bill of a booking that is already split.
 *
 * A booking split before the double-charge was found carries both the invoiced
 * room line and a per-stay line the pick-up added, so its settled bill reopened
 * and asked the agency to pay again. This puts the folio back to exactly the
 * invoiced amount, restates each stay to its share, and is safe to run any
 * number of times.
 */
export async function repairSplitAgencyBooking(
  tx: any,
  requestId: number,
): Promise<{ ok: boolean; reason?: "NOT_SPLIT" | "NO_STAYS"; reservations?: number; folioStatus?: string }> {
  const request = await tx.nrmsAgentBookingRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true, checkIn: true, checkOut: true, currency: true, quotedTotal: true,
      masterFolio: { select: { id: true, blockId: true } },
    },
  });
  if (!request?.masterFolio?.blockId) return { ok: false, reason: "NOT_SPLIT" };

  const block = await tx.nrmsGroupBlock.findUnique({ where: { id: request.masterFolio.blockId }, select: { groupId: true } });
  if (!block?.groupId) return { ok: false, reason: "NO_STAYS" };

  const members = await tx.reservation.findMany({
    where: { groupId: block.groupId, status: { notIn: ["CANCELLED", "EXPIRED", "NO_SHOW"] } },
    orderBy: [{ externalRef: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (members.length === 0) return { ok: false, reason: "NO_STAYS" };

  // Older splits predate the direct operational links. Repairing the folio is
  // also the safe moment to make every stay and occupant traceable without
  // relying on a guest-name comparison.
  await tx.reservation.updateMany({
    where: { id: { in: members.map((member: any) => member.id) } },
    data: { materializedAgentBookingRequestId: requestId },
  });
  const roomNumbers = await tx.nrmsAgentBookingGuest.findMany({
    where: { bookingRequestId: requestId },
    distinct: ["roomNumber"],
    orderBy: { roomNumber: "asc" },
    select: { roomNumber: true },
  });
  for (const [index, member] of members.entries()) {
    const roomNumber = roomNumbers[index]?.roomNumber;
    if (roomNumber == null) continue;
    await tx.nrmsAgentBookingGuest.updateMany({
      where: { bookingRequestId: requestId, roomNumber },
      data: { reservationId: member.id },
    });
  }

  await reconcileAgencyRoomLines(tx, request, members.map((member: any) => member.id));
  const folio = await tx.nrmsMasterFolio.findUnique({ where: { id: request.masterFolio.id }, select: { status: true } });
  return { ok: true, reservations: members.length, folioStatus: folio?.status };
}

function blockReference(): string {
  return `BLK-${Date.now().toString(36).toUpperCase()}-${generateNrmsRandomCode()}`.slice(0, 32);
}

/**
 * Convert a verified agent booking into a block, a group and one reservation
 * per named party. Runs inside the caller's transaction, and takes the property
 * inventory lock itself.
 */
export async function materialiseAgentBookingRooms(
  tx: any,
  args: { requestId: number; ownerId: number; actorId: number },
): Promise<MaterialiseOutcome> {
  // Serialize by booking request before reading any mutable conversion state.
  // The property lock protects room inventory; this row lock protects the
  // one-time commercial handover itself.
  await tx.$executeRawUnsafe(
    "SELECT id FROM `nrms_agent_booking_request` WHERE id = ? FOR UPDATE",
    args.requestId,
  );
  const request = await tx.nrmsAgentBookingRequest.findUnique({
    where: { id: args.requestId },
    select: {
      id: true, propertyId: true, linkId: true, roomTypeId: true, roomsRequested: true,
      checkIn: true, checkOut: true, currency: true, incidentalBilling: true, reservationId: true,
      guests: { select: { id: true, roomNumber: true, guestType: true, isLead: true, fullName: true, phone: true, email: true, nationality: true } },
      masterFolio: { select: { id: true, blockId: true } },
      link: { select: { agentAccount: { select: { legalName: true, tradingName: true } } } },
      reservation: {
        select: {
          id: true, status: true, roomRate: true, notes: true,
          allocations: { where: { status: "ACTIVE" }, select: { id: true, ratePlanId: true, mealPlan: true } },
        },
      },
    },
  });

  if (!request?.reservation) return { ok: false, skipped: "NO_RESERVATION" };
  if (request.masterFolio?.blockId) return { ok: false, skipped: "ALREADY_MATERIALISED" };
  if (!request.masterFolio) return { ok: false, skipped: "MASTER_FOLIO_MISSING" };
  if (request.reservation.status !== "CONFIRMED") return { ok: false, skipped: "RESERVATION_NOT_CONFIRMED" };

  const allocations = request.reservation.allocations ?? [];
  if (allocations.length === 0) return { ok: false, skipped: "NO_ACTIVE_ALLOCATIONS" };

  // Usage billing dedupes on allocation id, so nights posted against the
  // placeholder's allocations would be charged again on the new ones.
  const billed = await tx.nrmsUsageEvent.count({ where: { allocationId: { in: allocations.map((a: any) => a.id) } } });
  if (billed > 0) return { ok: false, skipped: "NIGHTS_ALREADY_BILLED" };

  const parties = partiesFromManifest(request.guests ?? []);
  if (parties.length === 0) return { ok: false, skipped: "NO_NAMED_TRAVELLERS" };

  await lockPropertyInventory(tx, request.propertyId);

  const agencyName = request.link?.agentAccount?.tradingName || request.link?.agentAccount?.legalName || "Agency booking";
  const rooms = Math.max(1, Number(request.roomsRequested) || allocations.length);
  const template = allocations[0];

  // Free the placeholder before the block takes the rooms, so the property
  // never counts the same night twice even for the length of this transaction.
  await tx.reservationRoomAllocation.updateMany({
    where: { reservationId: request.reservation.id, status: "ACTIVE" },
    data: { status: "RELEASED" },
  });
  await tx.reservation.update({
    where: { id: request.reservation.id },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelReason: "Split into one reservation per room after the traveller manifest was verified",
      holdExpiresAt: null,
    },
  });

  const block = await tx.nrmsGroupBlock.create({
    data: {
      propertyId: request.propertyId,
      ownerId: args.ownerId,
      reference: blockReference(),
      name: agencyName,
      agencyName,
      checkIn: request.checkIn,
      checkOut: request.checkOut,
      // An agency that has already paid must never lose rooms to a names
      // deadline, so the cut-off is arrival, not a hold timer.
      cutOffAt: request.checkIn,
      status: "HELD",
      currency: request.currency,
      // The agent's declaration decides where extras land. Rooms are on the
      // agency bill either way, because the agency was invoiced for them.
      billingMode: request.incidentalBilling === "AGENCY" ? "MASTER" : "SPLIT",
      agreedRoomsAtCreation: rooms,
      groupMinimumRooms: STANDARD_GROUP_MIN_ROOMS,
      // A four-room agency booking is still a real agreement, and the hotel
      // already approved it, so it is recorded as approved rather than blocked.
      // The threshold comes from the group policy, not from a number typed here.
      ...(rooms < STANDARD_GROUP_MIN_ROOMS
        ? { smallGroupApprovedAt: new Date(), smallGroupApprovalReason: `Agency booking request #${request.id} approved by the hotel` }
        : {}),
      notes: request.reservation.notes ?? null,
      createdById: args.actorId,
    },
    select: { id: true },
  });

  const line = await tx.nrmsGroupBlockRoom.create({
    data: {
      blockId: block.id,
      roomTypeId: request.roomTypeId,
      ratePlanId: template.ratePlanId ?? null,
      quantity: rooms,
      pickedUp: 0,
      nightlyRate: request.reservation.roomRate ?? 0,
      mealPlan: template.mealPlan ?? null,
    },
    select: { id: true },
  });

  // The agency already paid this folio. Claiming it for the block is what lets
  // every room's charge route onto the same bill the agency settled.
  const claimed = await tx.nrmsMasterFolio.updateMany({
    where: { id: request.masterFolio.id, blockId: null },
    data: { blockId: block.id },
  });
  if (claimed.count !== 1) throw new Error(PICKUP_RACE);

  const reservationIds: number[] = [];
  let groupId = 0;
  for (const party of parties) {
    if (reservationIds.length >= rooms) break; // more parties than rooms booked
    const lead = party.lead;
    const reusableIdentity = [
      ...(lead.phone ? [{ phone: lead.phone }] : []),
      ...(lead.email ? [{ email: String(lead.email).toLowerCase() }] : []),
    ];
    const existingProfile = reusableIdentity.length
      ? await tx.guestProfile.findFirst({
          where: { propertyId: request.propertyId, ownerId: args.ownerId, OR: reusableIdentity },
          select: { id: true },
        })
      : null;
    const profile = existingProfile
      ? await tx.guestProfile.update({
          where: { id: existingProfile.id },
          data: {
            fullName: lead.fullName,
            phone: lead.phone || undefined,
            email: lead.email ? String(lead.email).toLowerCase() : undefined,
            nationality: lead.nationality || undefined,
          },
          select: { id: true },
        })
      : await tx.guestProfile.create({
          data: {
            propertyId: request.propertyId,
            ownerId: args.ownerId,
            fullName: lead.fullName,
            phone: lead.phone || null,
            email: lead.email ? String(lead.email).toLowerCase() : null,
            nationality: lead.nationality || null,
            notes: `Verified agent manifest · booking request #${request.id} · ${agencyName}`,
          },
          select: { id: true },
        });

    const outcome = await pickUpBlockRoom(tx, {
      blockId: block.id,
      ownerId: args.ownerId,
      blockRoomId: line.id,
      guestProfileId: profile.id,
      adults: Math.max(1, party.adults),
      children: party.children,
      actorId: args.actorId,
      source: "AGENT",
      agentPropertyLinkId: request.linkId,
      // The agency was invoiced for these rooms already; the aggregate line is
      // re-cut below instead of the rooms being charged a second time.
      skipRoomRouting: true,
    });
    if ("error" in outcome) throw new Error(`AGENT_MATERIALISE_${outcome.error}`);
    await tx.reservation.update({
      where: { id: outcome.reservationId },
      data: { materializedAgentBookingRequestId: request.id },
    });
    await tx.nrmsAgentBookingGuest.updateMany({
      where: { bookingRequestId: request.id, roomNumber: party.roomNumber },
      data: { reservationId: outcome.reservationId },
    });
    reservationIds.push(outcome.reservationId);
    groupId = outcome.groupId;
  }

  if (!groupId) throw new Error(PICKUP_RACE);

  await reconcileAgencyRoomLines(tx, request, reservationIds);

  await tx.reservationEvent.create({
    data: {
      reservationId: request.reservation.id,
      type: "CANCELLED",
      actorId: args.actorId,
      data: {
        via: "AGENT_MANIFEST_VERIFIED_SPLIT",
        blockId: block.id,
        groupId,
        reservations: reservationIds,
      },
    },
  });

  return { ok: true, blockId: block.id, groupId, reservationIds, roomsLeftUnnamed: Math.max(0, rooms - reservationIds.length) };
}
