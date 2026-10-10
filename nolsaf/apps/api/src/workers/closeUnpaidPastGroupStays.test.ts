import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  blockDelete: vi.fn(),
  claimUpdate: vi.fn(),
  messageCreate: vi.fn(),
  notifyUser: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    groupBooking: { findMany: mocks.findMany, updateMany: mocks.updateMany },
    propertyAvailabilityBlock: { deleteMany: mocks.blockDelete },
    groupBookingClaim: { updateMany: mocks.claimUpdate },
    groupBookingMessage: { create: mocks.messageCreate },
  },
}));
vi.mock("../lib/notifications.js", () => ({ notifyUser: mocks.notifyUser }));

import { closeUnpaidPastGroupStays, shouldCloseUnpaidStay, startOfEatDay } from "./closeUnpaidPastGroupStays.js";

// 10:00 EAT on 9 October 2026.
const NOW = new Date("2026-10-09T07:00:00Z");
const base = {
  status: "AWAITING_DEPOSIT",
  depositPaid: false,
  checkIn: new Date("2026-10-07T00:00:00Z"),
  paymentRef: null,
  checkoutSessionId: null,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
};

describe("closing unpaid group stays whose dates passed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.blockDelete.mockResolvedValue({ count: 1 });
    mocks.claimUpdate.mockResolvedValue({ count: 1 });
    mocks.messageCreate.mockResolvedValue({});
    mocks.notifyUser.mockResolvedValue(undefined);
  });

  it("uses the East Africa calendar day", () => {
    expect(startOfEatDay(NOW).toISOString()).toBe("2026-10-08T21:00:00.000Z");
  });

  it("closes only after the whole arrival day is over", () => {
    expect(shouldCloseUnpaidStay(base, NOW)).toBe(true);
    // Arriving today: the guest can still pay today.
    expect(shouldCloseUnpaidStay({ ...base, checkIn: new Date("2026-10-08T21:30:00Z") }, NOW)).toBe(false);
  });

  it("never touches paid, confirmed or undated stays", () => {
    expect(shouldCloseUnpaidStay({ ...base, depositPaid: true }, NOW)).toBe(false);
    expect(shouldCloseUnpaidStay({ ...base, status: "CONFIRMED" }, NOW)).toBe(false);
    expect(shouldCloseUnpaidStay({ ...base, checkIn: null }, NOW)).toBe(false);
  });

  it("waits while a deposit checkout may still be confirming", () => {
    const paying = { ...base, paymentRef: "GS-41", updatedAt: new Date("2026-10-09T06:00:00Z") };
    expect(shouldCloseUnpaidStay(paying, NOW)).toBe(false);
    expect(shouldCloseUnpaidStay({ ...paying, updatedAt: new Date("2026-10-09T04:00:00Z") }, NOW)).toBe(true);
  });

  it("cancels, frees the dates, closes offers and tells both sides", async () => {
    mocks.findMany.mockResolvedValue([{ ...base, id: 41, userId: 5, assignedOwnerId: 9, confirmedPropertyId: 3, toRegion: "Dar es Salaam", toDistrict: null }]);
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(closeUnpaidPastGroupStays(NOW)).resolves.toBe(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 41, status: { in: ["PENDING", "AWAITING_DEPOSIT"] }, depositPaid: false },
      data: expect.objectContaining({ status: "CANCELED", canceledAt: NOW, isOpenForClaims: false }),
    });
    expect(mocks.blockDelete).toHaveBeenCalledWith({ where: { propertyId: 3, source: "GROUP_STAY", notes: "Reserved for group stay request #41" } });
    expect(mocks.claimUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "REJECTED", reviewedAt: NOW } }));
    expect(mocks.notifyUser).toHaveBeenCalledTimes(2);
  });

  it("backs off when a deposit lands first", async () => {
    mocks.findMany.mockResolvedValue([{ ...base, id: 41, userId: 5, assignedOwnerId: 9, confirmedPropertyId: 3, toRegion: null, toDistrict: null }]);
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(closeUnpaidPastGroupStays(NOW)).resolves.toBe(0);
    expect(mocks.blockDelete).not.toHaveBeenCalled();
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });
});
