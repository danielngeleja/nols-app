import { describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@nolsaf/prisma", () => ({ prisma: { systemSetting: { findUnique: (...a: unknown[]) => findUnique(...a), create: vi.fn() } } }));

import { accommodationTotals, effectiveCommissionPercent, nightlyNetFor, roomCodeToTypeKey, selectPricingRoom } from "./stayPrice.js";

const spec = [
  { code: "Standard", pricePerNight: "50,000" },
  { code: "Suite", pricePerNight: 120000, discountPercent: 10, maxGuestsPerUnit: 3, includedGuests: 2, extraGuestFee: 15000 },
];

describe("stay price shared by bookings and quotes", () => {
  it("reads room type keys from codes", () => {
    expect(roomCodeToTypeKey("Suite-2")).toBe("Suite");
    expect(roomCodeToTypeKey("Suite")).toBe("Suite");
    expect(roomCodeToTypeKey(null)).toBe("default");
  });

  it("finds the room by index, type key or code prefix", () => {
    expect(selectPricingRoom(spec, "1")).toBe(spec[1]);
    expect(selectPricingRoom(spec, "Suite-3")).toBe(spec[1]);
    expect(selectPricingRoom({ rooms: spec }, "Standard")).toBe(spec[0]);
    expect(selectPricingRoom(spec, "Villa")).toBeNull();
    expect(selectPricingRoom(spec, null)).toBeNull();
  });

  it("charges the owner's room discount, else the base price", () => {
    expect(nightlyNetFor({ basePrice: 40000, roomsSpec: spec, roomCode: "Suite" }).pricePerNight).toBe(108000);
    expect(nightlyNetFor({ basePrice: 40000, roomsSpec: spec, roomCode: "Standard" }).pricePerNight).toBe(50000);
    expect(nightlyNetFor({ basePrice: 40000, roomsSpec: spec, roomCode: null }).pricePerNight).toBe(40000);
  });

  it("adds extra-guest fees and commission on top", () => {
    const t = accommodationTotals({ pricePerNight: 108000, room: spec[1], roomsQty: 2, guestCount: 6, nights: 2, commissionPercent: 10 });
    // (108,000 x 2 rooms + 2 extra guests x 15,000) x 2 nights = 492,000; +10%.
    expect(t.accommodationNet).toBe(492000);
    expect(t.commissionAmount).toBe(49200);
    expect(t.accommodationGross).toBe(541200);
    expect(t.overCapacity).toBe(false);
  });

  it("flags more guests than the rooms take", () => {
    const t = accommodationTotals({ pricePerNight: 100, room: spec[1], roomsQty: 1, guestCount: 4, nights: 1, commissionPercent: 0 });
    expect(t.overCapacity).toBe(true);
  });

  it("uses the property commission override before the system default", async () => {
    expect(await effectiveCommissionPercent({ commissionPercent: 12 })).toBe(12);
    expect(await effectiveCommissionPercent({ commissionPercent: 250 })).toBe(100);
    findUnique.mockResolvedValueOnce({ commissionPercent: 8 });
    expect(await effectiveCommissionPercent({ commissionPercent: null })).toBe(8);
    findUnique.mockRejectedValueOnce(new Error("db down"));
    expect(await effectiveCommissionPercent({})).toBe(0);
  });
});
