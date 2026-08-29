import { describe, expect, it, vi } from "vitest";
import { buildInquiryAcknowledgement } from "./nrmsInquiryAcknowledgement.js";
import { createInquiryRoomHold } from "./nrmsInquiryConversion.js";

function conversionDb(capacity = 2) {
  const tx: any = {
    $executeRawUnsafe: vi.fn().mockResolvedValue(1),
    nrmsGuestInquiry: {
      findFirst: vi.fn().mockResolvedValue({ id: 41, reference: "INQ-7-TEST", channel: "WHATSAPP", roomTypeId: 12, version: 3 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    roomType: {
      findFirst: vi.fn().mockResolvedValue({ id: 12, baseRate: 100_000, currency: "TZS" }),
      findMany: vi.fn().mockResolvedValue([{ id: 12, name: "Deluxe", _count: { units: capacity } }]),
    },
    nrmsRatePlan: { findFirst: vi.fn().mockResolvedValue(null) },
    nrmsRateRestriction: { findMany: vi.fn().mockResolvedValue([]) },
    reservationRoomAllocation: { findMany: vi.fn().mockResolvedValue([]) },
    booking: { findMany: vi.fn().mockResolvedValue([]) },
    propertyAvailabilityBlock: { findMany: vi.fn().mockResolvedValue([]) },
    nrmsGroupBlock: { findMany: vi.fn().mockResolvedValue([]) },
    guestProfile: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 88 }),
      update: vi.fn(),
    },
    reservation: { create: vi.fn().mockResolvedValue({ id: 501, status: "HELD" }) },
    nrmsGuestMessage: { create: vi.fn().mockResolvedValue({ id: 99 }) },
  };
  return { tx, db: { $transaction: vi.fn(async (callback: (client: any) => unknown) => callback(tx)) } as any };
}

const input = {
  propertyId: 7,
  ownerId: 2,
  actorId: 19,
  actorName: "Reception A",
  inquiryId: 41,
  version: 3,
  guestName: "Amina Hassan",
  guestPhone: "+255700000001",
  guestEmail: "amina@example.com",
  checkIn: "2026-09-12",
  checkOut: "2026-09-14",
  roomTypeId: 12,
  adults: 2,
  children: 0,
};

describe("reception inquiry journey", () => {
  it("acknowledges the request and atomically creates a staff-attributed hold", async () => {
    const { db, tx } = conversionDb();
    const acknowledgement = buildInquiryAcknowledgement({ propertyTitle: "Sheraton Hotel", guestName: input.guestName, checkIn: input.checkIn, checkOut: input.checkOut, channels: { whatsapp: true } });
    const result = await createInquiryRoomHold(input, db);

    expect(acknowledgement).toContain("we received your request for 12–14 September");
    expect(result).toMatchObject({ ok: true, reservationId: 501, status: "HELD", totalAmount: 200_000, currency: "TZS" });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith("SELECT id FROM `property` WHERE id = ? FOR UPDATE", 7);
    expect(tx.reservation.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerId: 2, createdById: 19, status: "HELD", totalAmount: 200_000 }) }));
    expect(tx.nrmsGuestInquiry.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 41, version: 3 }), data: expect.objectContaining({ status: "CONVERTED", reservationId: 501, activeConversationKey: null }) }));
  });

  it("refuses to create a hold when live room capacity is gone", async () => {
    const { db, tx } = conversionDb(0);
    const result = await createInquiryRoomHold(input, db);
    expect(result).toMatchObject({ ok: false, code: "NO_AVAILABILITY" });
    expect(tx.reservation.create).not.toHaveBeenCalled();
    expect(tx.nrmsGuestInquiry.updateMany).not.toHaveBeenCalled();
  });
});
