// The lowest rate a staff member may agree.
//
// This guard exists because a group block's nightly rate becomes the guest's
// rate on pickup, and the only validation on it was that it is a non-negative
// number. Every case here is a way the guard could be wrong in the direction
// that matters: letting a discount through, or blocking a legitimate one.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ roomTypeFindMany: vi.fn() }));

vi.mock("@nolsaf/prisma", () => {
  const prisma = { roomType: { findMany: mocks.roomTypeFindMany } };
  return { prisma, typedPrisma: prisma };
});

import { checkStaffRateFloor, roleIsRateFloored } from "./nrmsRateFloor.js";

const PROPERTY_ID = 91;
const DELUXE = 3;

function roomType(overrides: Record<string, unknown> = {}) {
  return { id: DELUXE, name: "Deluxe double", baseRate: 100_000, staffRateFloor: null, currency: "TZS", ...overrides };
}

function check(role: string, nightlyRate: number) {
  return checkStaffRateFloor({ role, propertyId: PROPERTY_ID, lines: [{ roomTypeId: DELUXE, nightlyRate }] });
}

describe("checkStaffRateFloor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.roomTypeFindMany.mockResolvedValue([roomType()]);
  });

  it("never floors the owner", async () => {
    // The owner sets the limit. A limit its own author can lift in one click
    // and re-apply afterwards is theatre, so they are simply exempt.
    expect(roleIsRateFloored("OWNER")).toBe(false);
    const result = await check("OWNER", 0);
    expect(result.ok).toBe(true);
    expect(mocks.roomTypeFindMany).not.toHaveBeenCalled();
  });

  it("floors a manager as well as a sales executive", async () => {
    for (const role of ["MANAGER", "SALES_EXECUTIVE"]) {
      const result = await check(role, 40_000);
      expect(result.ok).toBe(false);
    }
  });

  it("falls back to the standard rate when no floor is configured", async () => {
    // Discount authority is granted, not assumed: an unconfigured property
    // must not hand out unlimited discounting the day staff gain block access.
    const result = await check("SALES_EXECUTIVE", 99_999);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations[0].floor).toBe(100_000);
    expect(result.violations[0].derivedFromBaseRate).toBe(true);
    expect(result.message).toContain("No lower limit has been set");
  });

  it("uses the configured floor in place of the standard rate", async () => {
    mocks.roomTypeFindMany.mockResolvedValue([roomType({ staffRateFloor: 60_000 })]);
    expect((await check("SALES_EXECUTIVE", 60_000)).ok).toBe(true);
    expect((await check("SALES_EXECUTIVE", 75_000)).ok).toBe(true);
    const refused = await check("SALES_EXECUTIVE", 59_999);
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.violations[0].derivedFromBaseRate).toBe(false);
    expect(refused.message).toContain("Ask the owner");
  });

  it("treats a zero floor as the owner lifting the limit", async () => {
    mocks.roomTypeFindMany.mockResolvedValue([roomType({ staffRateFloor: 0 })]);
    expect((await check("SALES_EXECUTIVE", 0)).ok).toBe(true);
  });

  it("does not floor a room type that has never been priced", async () => {
    mocks.roomTypeFindMany.mockResolvedValue([roomType({ baseRate: null, staffRateFloor: null })]);
    expect((await check("SALES_EXECUTIVE", 1)).ok).toBe(true);
  });

  it("admits a rate exactly on the floor", async () => {
    // Off-by-one here would refuse the rate the owner explicitly permitted.
    mocks.roomTypeFindMany.mockResolvedValue([roomType({ staffRateFloor: 60_000 })]);
    expect((await check("SALES_EXECUTIVE", 60_000)).ok).toBe(true);
  });

  it("reports every offending line, not just the first", async () => {
    mocks.roomTypeFindMany.mockResolvedValue([
      roomType({ id: 3, name: "Deluxe double", staffRateFloor: 60_000 }),
      roomType({ id: 4, name: "Family suite", staffRateFloor: 150_000 }),
    ]);
    const result = await checkStaffRateFloor({
      role: "SALES_EXECUTIVE",
      propertyId: PROPERTY_ID,
      lines: [
        { roomTypeId: 3, nightlyRate: 50_000 },
        { roomTypeId: 4, nightlyRate: 200_000 },
        { roomTypeId: 4, nightlyRate: 100_000 },
      ],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.violations).toHaveLength(2);
    expect(result.message).toContain("Deluxe double");
    expect(result.message).toContain("Family suite");
  });

  it("names the number that would have worked", async () => {
    // A refusal that only says "not allowed" sends the person to find a
    // manager without knowing what to ask for.
    mocks.roomTypeFindMany.mockResolvedValue([roomType({ staffRateFloor: 60_000 })]);
    const result = await check("SALES_EXECUTIVE", 50_000);
    if (result.ok) return expect.fail("expected a refusal");
    expect(result.message).toContain("TZS 60,000");
    expect(result.message).toContain("TZS 50,000");
  });

  it("ignores a room type that does not belong to the property", async () => {
    // The handler's own capacity check refuses this with a clearer message.
    mocks.roomTypeFindMany.mockResolvedValue([]);
    expect((await check("SALES_EXECUTIVE", 1)).ok).toBe(true);
  });

  it("scopes the lookup to the property it was asked about", async () => {
    await check("SALES_EXECUTIVE", 10);
    expect(mocks.roomTypeFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ propertyId: PROPERTY_ID }) }),
    );
  });
});
