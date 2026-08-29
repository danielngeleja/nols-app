import { describe, expect, it, vi } from "vitest";
import { materialiseAgentBookingRooms } from "./nrmsAgentGroupMaterialise.js";

const availability = vi.hoisted(() => ({ lockPropertyInventory: vi.fn(), getRoomTypesAvailability: vi.fn(), findUnitConflicts: vi.fn() }));
const pickup = vi.hoisted(() => ({ pickUpBlockRoom: vi.fn(), PICKUP_RACE: "NRMS_BLOCK_PICKUP_RACE" }));
const folio = vi.hoisted(() => ({ refreshMasterFolioStatus: vi.fn() }));

vi.mock("./nrmsAvailability.js", () => availability);
vi.mock("./pdfDocuments.js", () => ({ generateNrmsRandomCode: () => "ABC123" }));
vi.mock("./nrmsGroupPickup.js", () => pickup);
vi.mock("./nrmsMasterFolio.js", () => folio);

const guest = (over: Record<string, unknown> = {}) => ({
  id: 1, roomNumber: 1, guestType: "ADULT", isLead: false,
  fullName: "Traveller", phone: null, email: null, nationality: "TZ", ...over,
});

type RequestOver = Record<string, unknown>;

function fakeTx(over: RequestOver = {}) {
  const request = {
    id: 42,
    propertyId: 3,
    linkId: 9,
    roomTypeId: 5,
    roomsRequested: 2,
    checkIn: new Date("2026-09-01T00:00:00.000Z"),
    checkOut: new Date("2026-09-04T00:00:00.000Z"),
    currency: "TZS",
    incidentalBilling: "AGENCY",
    reservationId: 700,
    guests: [
      guest({ id: 1, roomNumber: 1, isLead: true, fullName: "Amina Juma" }),
      guest({ id: 2, roomNumber: 1, guestType: "CHILD", fullName: "Baraka Juma" }),
      guest({ id: 3, roomNumber: 2, fullName: "Neema Paul" }),
    ],
    masterFolio: { id: 88, blockId: null },
    link: { agentAccount: { legalName: "Serengeti Tours Ltd", tradingName: "Serengeti Tours" } },
    reservation: {
      id: 700,
      status: "CONFIRMED",
      roomRate: 100,
      notes: null,
      allocations: [{ id: 501, ratePlanId: 4, mealPlan: "BB" }, { id: 502, ratePlanId: 4, mealPlan: "BB" }],
    },
    ...over,
  };

  return {
    request,
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    nrmsAgentBookingRequest: { findUnique: vi.fn().mockResolvedValue(request) },
    nrmsAgentBookingGuest: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    nrmsUsageEvent: { count: vi.fn().mockResolvedValue(0) },
    reservationRoomAllocation: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    reservation: { update: vi.fn().mockResolvedValue({ id: 700 }), updateMany: vi.fn().mockResolvedValue({ count: 2 }), findMany: vi.fn().mockResolvedValue([]) },
    nrmsGroupBlock: { create: vi.fn().mockResolvedValue({ id: 31 }) },
    nrmsGroupBlockRoom: { create: vi.fn().mockResolvedValue({ id: 61 }) },
    nrmsMasterFolio: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), findUnique: vi.fn().mockResolvedValue({ status: "SETTLED" }) },
    guestProfile: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: 300 }), update: vi.fn().mockResolvedValue({ id: 300 }) },
    reservationEvent: { create: vi.fn().mockResolvedValue({ id: 1 }) },
    nrmsMasterFolioItem: {
      findUnique: vi.fn().mockResolvedValue({ id: 501, amount: 14_404_500, currency: "TZS", voidedAt: null }),
      // No per-stay lines yet, and no duplicates from the generic pick-up.
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({ id: 501 }),
      upsert: vi.fn().mockResolvedValue({ id: 502 }),
    },
  };
}

const args = { requestId: 42, ownerId: 11, actorId: 12 };

describe("materialiseAgentBookingRooms", () => {
  it("splits the placeholder into one reservation per named party", async () => {
    const tx = fakeTx();
    let picked = 0;
    pickup.pickUpBlockRoom.mockImplementation(async () => ({ reservationId: 900 + ++picked, groupId: 55, stillHeld: 0 }));

    const outcome = await materialiseAgentBookingRooms(tx as any, args);

    expect(outcome).toMatchObject({ ok: true, blockId: 31, groupId: 55, roomsLeftUnnamed: 0 });
    expect(outcome.ok && outcome.reservationIds).toEqual([901, 902]);
    // The placeholder stops consuming inventory before the block takes over.
    expect(tx.reservationRoomAllocation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "RELEASED" } }),
    );
    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
    // The agency's folio is claimed by the block, not duplicated.
    expect(tx.nrmsMasterFolio.updateMany).toHaveBeenCalledWith({ where: { id: 88, blockId: null }, data: { blockId: 31 } });
    expect(tx.reservation.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 901 }, data: { materializedAgentBookingRequestId: 42 } }));
    expect(tx.nrmsAgentBookingGuest.updateMany).toHaveBeenCalledWith({ where: { bookingRequestId: 42, roomNumber: 1 }, data: { reservationId: 901 } });
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(tx.nrmsAgentBookingRequest.findUnique.mock.invocationCallOrder[0]);
  });

  it("re-cuts the agency's room line per stay without changing what it owes", async () => {
    const tx = fakeTx();
    let picked = 0;
    pickup.pickUpBlockRoom.mockImplementation(async () => ({ reservationId: 900 + ++picked, groupId: 55, stillHeld: 0 }));

    await materialiseAgentBookingRooms(tx as any, args);

    // The room is never routed twice: the pick-up is told to leave the folio
    // alone, and the invoiced line is re-cut instead.
    expect(pickup.pickUpBlockRoom.mock.calls[0][1]).toMatchObject({ skipRoomRouting: true });
    expect(tx.nrmsMasterFolioItem.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 501 },
      data: expect.objectContaining({ voidReason: "Re-issued as one line per room" }),
    }));
    const amounts = tx.nrmsMasterFolioItem.upsert.mock.calls.map((call: any) => call[0].create.amount);
    expect(amounts).toHaveLength(2);
    expect(amounts.reduce((sum: number, value: number) => sum + value, 0)).toBe(14_404_500);
    // Each stay is restated to its share, so a discounted invoice does not read
    // as a balance the traveller owes.
    const restated = tx.reservation.update.mock.calls.filter((call: any) => call[0].data.totalAmount != null);
    expect(restated).toHaveLength(2);
    expect(restated.map((call: any) => call[0].data.totalAmount).reduce((sum: number, value: number) => sum + value, 0)).toBe(14_404_500);
  });

  it("keeps the room party together and leads it with the declared lead adult", async () => {
    const tx = fakeTx();
    pickup.pickUpBlockRoom.mockResolvedValue({ reservationId: 901, groupId: 55, stillHeld: 0 });

    await materialiseAgentBookingRooms(tx as any, args);

    const firstParty = pickup.pickUpBlockRoom.mock.calls[0][1];
    expect(firstParty).toMatchObject({ adults: 1, children: 1, source: "AGENT", agentPropertyLinkId: 9 });
    expect(tx.guestProfile.create.mock.calls[0][0].data.fullName).toBe("Amina Juma");
  });

  it("reuses a property guest profile when verified contact identity already exists", async () => {
    const tx = fakeTx({
      guests: [
        guest({ id: 1, roomNumber: 1, isLead: true, fullName: "Amina Juma", phone: "+255712345678" }),
        guest({ id: 2, roomNumber: 2, isLead: true, fullName: "Neema Paul", email: "neema@example.com" }),
      ],
    });
    tx.guestProfile.findFirst.mockResolvedValue({ id: 777 });
    tx.guestProfile.update.mockResolvedValue({ id: 777 });
    pickup.pickUpBlockRoom.mockResolvedValue({ reservationId: 901, groupId: 55, stillHeld: 0 });

    await materialiseAgentBookingRooms(tx as any, args);

    expect(tx.guestProfile.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 777 } }));
    expect(tx.guestProfile.create).not.toHaveBeenCalled();
    expect(pickup.pickUpBlockRoom).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ guestProfileId: 777 }),
    );
  });

  it("carries the incidental declaration into the block billing mode", async () => {
    const tx = fakeTx({ incidentalBilling: "INDIVIDUAL_GUEST" });
    pickup.pickUpBlockRoom.mockResolvedValue({ reservationId: 901, groupId: 55, stillHeld: 0 });

    await materialiseAgentBookingRooms(tx as any, args);

    expect(tx.nrmsGroupBlock.create.mock.calls[0][0].data).toMatchObject({ billingMode: "SPLIT", cutOffAt: tx.request.checkIn });
  });

  it("voids the duplicate room lines a previous split left behind", async () => {
    const tx = fakeTx();
    // The aggregate was already voided by the earlier split, and the generic
    // pick-up wrote a full-price line per stay on top of the paid invoice.
    tx.nrmsMasterFolioItem.findUnique.mockResolvedValue({ id: 501, amount: 14_404_500, currency: "TZS", voidedAt: new Date() });
    tx.nrmsMasterFolioItem.findMany.mockImplementation(async (query: any) =>
      query?.where?.sourceKey?.in ? [{ id: 601 }, { id: 602 }] : [],
    );
    let picked = 0;
    pickup.pickUpBlockRoom.mockImplementation(async () => ({ reservationId: 900 + ++picked, groupId: 55, stillHeld: 0 }));

    await materialiseAgentBookingRooms(tx as any, args);

    const voided = tx.nrmsMasterFolioItem.update.mock.calls.map((call: any) => call[0].where.id);
    expect(voided).toEqual([601, 602]);
    expect(tx.nrmsMasterFolioItem.update.mock.calls[0][0].data.voidReason).toContain("already invoiced");
  });

  it("re-cuts from the existing per-stay lines when the aggregate is already gone", async () => {
    const tx = fakeTx();
    tx.nrmsMasterFolioItem.findUnique.mockResolvedValue(null);
    tx.nrmsMasterFolioItem.findMany.mockImplementation(async (query: any) =>
      query?.where?.sourceKey?.startsWith ? [{ id: 701, amount: 7_202_250 }, { id: 702, amount: 7_202_250 }] : [],
    );
    let picked = 0;
    pickup.pickUpBlockRoom.mockImplementation(async () => ({ reservationId: 900 + ++picked, groupId: 55, stillHeld: 0 }));

    await materialiseAgentBookingRooms(tx as any, args);

    const created = tx.nrmsMasterFolioItem.upsert.mock.calls.map((call: any) => call[0].create);
    expect(created.map((item: any) => item.amount).reduce((sum: number, value: number) => sum + value, 0)).toBe(14_404_500);
    expect(created[0].currency).toBe("TZS");
  });

  it("refuses to run twice", async () => {
    const tx = fakeTx({ masterFolio: { id: 88, blockId: 31 } });
    const outcome = await materialiseAgentBookingRooms(tx as any, args);
    expect(outcome).toEqual({ ok: false, skipped: "ALREADY_MATERIALISED" });
    expect(tx.nrmsGroupBlock.create).not.toHaveBeenCalled();
  });

  it("refuses once a room-night has been billed, so nights cannot be charged twice", async () => {
    const tx = fakeTx();
    tx.nrmsUsageEvent.count.mockResolvedValue(3);
    const outcome = await materialiseAgentBookingRooms(tx as any, args);
    expect(outcome).toEqual({ ok: false, skipped: "NIGHTS_ALREADY_BILLED" });
    expect(tx.reservation.update).not.toHaveBeenCalled();
  });

  it("leaves the booking alone when no traveller was named", async () => {
    const tx = fakeTx({ guests: [] });
    const outcome = await materialiseAgentBookingRooms(tx as any, args);
    expect(outcome).toEqual({ ok: false, skipped: "NO_NAMED_TRAVELLERS" });
  });

  it("will not create operational stays without the agency ledger", async () => {
    const tx = fakeTx({ masterFolio: null });
    const outcome = await materialiseAgentBookingRooms(tx as any, args);
    expect(outcome).toEqual({ ok: false, skipped: "MASTER_FOLIO_MISSING" });
    expect(tx.nrmsGroupBlock.create).not.toHaveBeenCalled();
  });

  it("reports rooms nobody was named into", async () => {
    const tx = fakeTx({ roomsRequested: 4 });
    pickup.pickUpBlockRoom.mockResolvedValue({ reservationId: 901, groupId: 55, stillHeld: 2 });
    const outcome = await materialiseAgentBookingRooms(tx as any, args);
    expect(outcome).toMatchObject({ ok: true, roomsLeftUnnamed: 2 });
  });
});
