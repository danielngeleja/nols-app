import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acceptLease, acceptOffer, cancelClashingReservations, checkOfferTerms, createReservation, lapseUnansweredReservations, leaseTextOf, reservationLapsed } from "./offerService.js";
import { addMonths, buildLease, leaseHash, leaseRulesFrom, LEASE_VERSION } from "./lease.js";
import { houseRulesOf } from "./offerService.js";
import { termsToRow } from "./listing.js";

const TODAY = "2026-11-21";
const listing = termsToRow({
  monthlyRent: 4500, currency: "USD", minTermMonths: 6, upfrontMonths: 6, furnished: "FURNISHED",
  utilities: { water: "INCLUDED", electricity: "TENANT", internet: "TENANT", security: "INCLUDED", serviceCharge: "INCLUDED" },
  securityDepositMonths: 1, noticePeriodDays: 30, balanceMethods: ["BANK"], residencyRules: { petsAllowed: false, maxOccupants: 4 }, availableFrom: "2026-12-01",
} as any);

function fakeDb(extra: Record<string, any> = {}) {
  const db: any = {
    property: {
      findUnique: vi.fn(async () => ({ id: 9, ownerId: 3, status: "APPROVED", rentalMode: "LONG_STAY", title: "Sea View Flats", district: "Kinondoni", regionName: "Dar es Salaam", longStayListing: listing })),
      findFirst: vi.fn(async () => ({ id: 9, ownerId: 3, type: "APARTMENT", title: "Sea View Flats", longStayListing: listing })),
    },
    longStayInspection: { findFirst: vi.fn(async () => ({ status: "PASSED", validUntil: new Date("2027-10-01T00:00:00Z"), reviewedAt: new Date() })) },
    longStayLandlordGrant: { findUnique: vi.fn(async () => ({ enabledAt: new Date(), pausedAt: null })) },
    longStayTenantProfile: { findUnique: vi.fn(async () => ({ status: "APPROVED", barredAt: null })) },
    systemSetting: { findUnique: vi.fn(async () => null) },
    user: { findUnique: vi.fn(async ({ where }: any) => ({ fullName: where.id === 3 ? "Mr Juma" : "Sarah", name: null })) },
    tenancy: { findMany: vi.fn(async () => []), updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(), findFirst: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })) },
    tenancyEvent: { create: vi.fn() },
    ...extra,
  };
  return db;
}

beforeEach(() => {
  vi.stubEnv("LONG_STAY_OPEN", "1");
  vi.stubEnv("LONG_STAY_REQUIRE_INSPECTION", undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("addMonths", () => {
  it("keeps the day, or the last day of a shorter month", () => {
    expect(addMonths("2027-01-01", 6)).toBe("2027-07-01");
    expect(addMonths("2027-01-31", 1)).toBe("2027-02-28");
    expect(addMonths("2026-12-15", 12)).toBe("2027-12-15");
  });
});

describe("checkOfferTerms", () => {
  const terms = { minTermMonths: 6, maxTermMonths: 12, availableFrom: "2026-12-01" };
  it("accepts a term and date inside the listing's rules", () => {
    expect(checkOfferTerms(terms, { moveInDate: "2027-01-01", termMonths: 6 }, TODAY)).toBe("2027-07-01");
  });
  it("refuses a short or long term, an early date, and a date beyond 60 days", () => {
    expect(() => checkOfferTerms(terms, { moveInDate: "2027-01-01", termMonths: 3 }, TODAY)).toThrow(/minimum/);
    expect(() => checkOfferTerms(terms, { moveInDate: "2027-01-01", termMonths: 18 }, TODAY)).toThrow(/longest/);
    expect(() => checkOfferTerms(terms, { moveInDate: "2026-11-25", termMonths: 6 }, TODAY)).toThrow(/from 2026-12-01/);
    expect(() => checkOfferTerms(terms, { moveInDate: "2027-02-15", termMonths: 6 }, TODAY)).toThrow(/60 days/);
  });
});

describe("createReservation", () => {
  const input = { tenantId: 20, propertyKey: "abcdefghijklmnopqrstu", moveInDate: "2027-01-01", termMonths: 6 };
  const NOW = new Date("2026-11-21T08:00:00Z");

  it("reserves at the listed terms, straight to the landlord's 24 hours", async () => {
    const db = fakeDb();
    const { tenancy } = await createReservation(db, input, TODAY, NOW);
    expect(tenancy.publicRef).toMatch(/^tn_/);
    expect(db.tenancy.create.mock.calls[0][0].data).toMatchObject({ status: "OFFERED", tenantId: 20, landlordId: 3, propertyId: 9, termMonths: 6, currency: "USD", offeredAt: NOW });
    expect(db.tenancy.create.mock.calls[0][0].data.endDate).toEqual(new Date("2027-07-01T00:00:00Z"));
    expect(db.tenancyEvent.create.mock.calls[0][0].data).toMatchObject({ type: "RESERVATION_REQUESTED", toStatus: "OFFERED" });
    expect((db.property.findFirst as any).mock.calls[0][0].where).toEqual({ nrmsBookingKey: input.propertyKey, status: "APPROVED", rentalMode: "LONG_STAY" });
  });

  it("needs long stays open, a current inspection and a term the listing allows", async () => {
    await expect(createReservation(fakeDb({ longStayInspection: { findFirst: vi.fn(async () => null) } }), input, TODAY, NOW)).rejects.toThrow(/inspection/);
    await expect(createReservation(fakeDb(), { ...input, termMonths: 3 }, TODAY, NOW)).rejects.toThrow(/minimum/);
    delete process.env.LONG_STAY_OPEN;
    await expect(createReservation(fakeDb(), input, TODAY, NOW)).rejects.toMatchObject({ status: 403 });
  });

  it("blocks a new booking during a confirmed hold and allows future dates after an active lease", async () => {
    const db = fakeDb();
    const current = { moveInDate: new Date("2026-01-01"), endDate: new Date("2027-01-01") };
    db.tenancy.findMany.mockResolvedValueOnce([{ ...current, status: "ACCEPTED" }]);
    await expect(createReservation(db, input, TODAY, NOW)).rejects.toMatchObject({ status: 409, code: "HOME_RESERVED" });
    expect(db.tenancy.create).not.toHaveBeenCalled();
    db.tenancy.findMany.mockResolvedValueOnce([{ ...current, status: "ACTIVE" }]);
    await expect(createReservation(db, input, TODAY, NOW)).resolves.toMatchObject({ tenancy: { status: "OFFERED" } });
  });

  it("refuses the landlord's own home, a paused landlord, a duplicate, too many, and taken dates", async () => {
    await expect(createReservation(fakeDb(), { ...input, tenantId: 3 }, TODAY, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(createReservation(fakeDb({ longStayLandlordGrant: { findUnique: vi.fn(async () => ({ pausedAt: new Date() })) } }), input, TODAY, NOW)).rejects.toMatchObject({ status: 409 });
    const dup = fakeDb();
    dup.tenancy.findFirst = vi.fn(async () => ({ publicRef: "tn_x" }));
    await expect(createReservation(dup, input, TODAY, NOW)).rejects.toMatchObject({ status: 409 });
    const many = fakeDb();
    many.tenancy.count = vi.fn(async () => 3);
    await expect(createReservation(many, input, TODAY, NOW)).rejects.toMatchObject({ status: 429 });
    const taken = fakeDb();
    taken.tenancy.findMany = vi.fn(async () => [{ moveInDate: new Date("2026-12-15T00:00:00Z"), endDate: new Date("2027-06-15T00:00:00Z") }]);
    await expect(createReservation(taken, input, TODAY, NOW)).rejects.toMatchObject({ status: 409 });
    expect(taken.tenancy.create).not.toHaveBeenCalled();
  });
});

describe("the landlord's 24 hours", () => {
  it("lapses unanswered reservations and closes clashing ones once one is confirmed", async () => {
    const now = new Date("2026-11-22T09:00:00Z");
    expect(reservationLapsed({ status: "OFFERED", offeredAt: new Date("2026-11-21T08:00:00Z") }, now)).toBe(true);
    expect(reservationLapsed({ status: "OFFERED", offeredAt: new Date("2026-11-21T10:00:00Z") }, now)).toBe(false);
    const db = fakeDb();
    db.tenancy.findMany = vi.fn(async () => [{ id: 5, status: "OFFERED", version: 0, tenantId: 21, landlordId: 3, propertyId: 9 }]);
    expect(await lapseUnansweredReservations(db, now)).toEqual([{ tenantId: 21, landlordId: 3, propertyId: 9 }]);
    expect(db.tenancy.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 5, status: "OFFERED" }, data: { status: "CANCELLED", cancelledBy: "SYSTEM" } });

    const clash = fakeDb();
    clash.tenancy.findMany = vi.fn(async () => [
      { id: 6, status: "OFFERED", version: 0, tenantId: 22, moveInDate: new Date("2027-03-01T00:00:00Z"), endDate: new Date("2027-09-01T00:00:00Z") },
      { id: 7, status: "OFFERED", version: 0, tenantId: 23, moveInDate: new Date("2027-08-01T00:00:00Z"), endDate: new Date("2028-02-01T00:00:00Z") },
    ]);
    const closed = await cancelClashingReservations(clash, { id: 1, propertyId: 9, moveInDate: new Date("2027-01-01T00:00:00Z"), endDate: new Date("2027-07-01T00:00:00Z") });
    expect(closed).toEqual([22]);
  });
});

describe("acceptOffer", () => {
  const offered = { id: 1, publicRef: "tn_abcdefghijklmnopqrstuv", propertyId: 9, tenantId: 20, status: "OFFERED", version: 3, moveInDate: new Date("2027-01-01T00:00:00Z"), termMonths: 6 };

  it("freezes the spec's money and the lease, computed on the server", async () => {
    const db = fakeDb();
    const result = await acceptOffer(db, offered, 3, TODAY);
    const data = db.tenancy.updateMany.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "ACCEPTED", currency: "USD", monthlyRent: 4500, tenantFee: 1080, landlordCommission: 1350, bookingAmount: 5580, balanceDue: 22500, leaseVersion: LEASE_VERSION });
    expect(data.termsSnapshot.landlordPayout).toBe(3150);
    expect(data.leaseHash).toBe(result.leaseHash);
    expect(leaseTextOf({ termsSnapshot: data.termsSnapshot, leaseHash: data.leaseHash })).toContain("USD 22,500");
  });

  it("refuses when the landlord's switch is off or there is no offer", async () => {
    await expect(acceptOffer(fakeDb({ longStayLandlordGrant: { findUnique: vi.fn(async () => null) } }), offered, 3, TODAY)).rejects.toMatchObject({ status: 403 });
    await expect(acceptOffer(fakeDb(), { ...offered, status: "ACCEPTED" }, 3, TODAY)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses after the 24 hours to confirm, and without a current inspection", async () => {
    await expect(acceptOffer(fakeDb(), { ...offered, offeredAt: new Date(Date.now() - 25 * 3_600_000) }, 3, TODAY)).rejects.toThrow(/24 hours/);
    const db = fakeDb({ longStayInspection: { findFirst: vi.fn(async () => ({ status: "PASSED", validUntil: new Date("2026-11-01T00:00:00Z"), reviewedAt: new Date() })) } });
    await expect(acceptOffer(db, offered, 3, TODAY)).rejects.toThrow(/inspect/);
  });
});

describe("lease", () => {
  const input = {
    tenancyRef: "tn_x", tenantName: "Sarah", landlordName: "Mr Juma", homeTitle: "Sea View Flats", homeArea: "Kinondoni",
    moveInDate: "2027-01-01", endDate: "2027-07-01", termMonths: 6, upfrontMonths: 6, currency: "USD", monthlyRent: 4500,
    firstMonthViaNolsaf: 4500, tenantFee: 1080, balanceDue: 22500, securityDepositMonths: 1, noticePeriodDays: 30, furnished: "FURNISHED",
    utilities: { water: "INCLUDED", electricity: "TENANT" }, balanceMethods: ["BANK"], petsAllowed: false, maxOccupants: 4,
  };

  it("states the split, the balance at move-in and NoLSAF's role, with no em-dashes", () => {
    const text = buildLease(input);
    expect(text).toContain("USD 4,500");
    expect(text).toContain("USD 22,500");
    expect(text).toContain("NoLSAF is not a party to this Agreement");
    expect(text).not.toContain("—");
    expect(text).not.toContain("NOLSAF");
  });

  it("reads as a Tanzanian tenancy agreement with numbered clauses and particulars", () => {
    const text = buildLease(input);
    const lines = text.split("\n");
    expect(lines[0]).toBe("THE UNITED REPUBLIC OF TANZANIA");
    expect(text).toContain("Term\t6 months, from 1 January 2027 to 1 July 2027");
    expect(text).toContain("Paid to the Landlord at move-in\tUSD 22,500.00, by bank transfer");
    expect(text).toContain("Registration No. 0-000-011-671");
    expect(text).toContain("governed by the laws of the United Republic of Tanzania");
    expect(text).toContain("electronic signature under the Electronic Transactions Act");
    // Clauses run 1..24 in order, each once.
    const clauses = lines.filter((l) => /^\d+\.\s/.test(l)).map((l) => Number(l.split(".")[0]));
    expect(clauses).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    // Every cross-reference points at a clause that exists.
    for (const ref of text.matchAll(/clauses? (\d+)(?:\.(\d+))?/g)) expect(Number(ref[1])).toBeLessThanOrEqual(24);
  });

  it("states no deposit and no balance plainly when there are none", () => {
    const text = buildLease({ ...input, securityDepositMonths: 0, upfrontMonths: 1, balanceDue: 0 });
    expect(text).toContain("Security deposit\tNone");
    expect(text).toContain("No security deposit is payable");
    expect(text).toContain("Paid to the Landlord at move-in\tNothing further");
    expect(text).toContain("5.4 Rent for each month of the Term after the prepaid period");
  });

  it("is refused when the stored hash does not match the text", () => {
    expect(leaseTextOf({ termsSnapshot: { lease: input }, leaseHash: leaseHash(buildLease(input)) })).not.toBeNull();
    expect(leaseTextOf({ termsSnapshot: { lease: input }, leaseHash: "0".repeat(64) })).toBeNull();
  });
});

describe("acceptLease", () => {
  const input = {
    tenancyRef: "tn_x", tenantName: "Sarah", landlordName: "Mr Juma", homeTitle: "Sea View Flats", homeArea: "",
    moveInDate: "2027-01-01", endDate: "2027-07-01", termMonths: 6, upfrontMonths: 6, currency: "USD", monthlyRent: 4500,
    firstMonthViaNolsaf: 4500, tenantFee: 1080, balanceDue: 22500, securityDepositMonths: 0, noticePeriodDays: 30, furnished: "FURNISHED",
    utilities: {}, balanceMethods: ["BANK"], petsAllowed: null, maxOccupants: null,
  };
  const hash = leaseHash(buildLease(input));
  const accepted = { id: 1, status: "ACCEPTED", version: 4, leaseHash: hash, leaseVersion: LEASE_VERSION, termsSnapshot: { lease: input }, tenantLeaseAcceptedAt: null, landlordLeaseAcceptedAt: null };

  it("needs the exact text's hash", async () => {
    await expect(acceptLease(fakeDb(), accepted, "TENANT", 20, "f".repeat(64))).rejects.toMatchObject({ status: 409 });
  });

  it("needs a verified tenant ID", async () => {
    const db = fakeDb({ longStayTenantProfile: { findUnique: vi.fn(async () => ({ status: "PENDING" })) } });
    await expect(acceptLease(db, accepted, "TENANT", 20, hash)).rejects.toThrow(/still checking/);
  });

  it("opens the 48-hour payment window once both sides accepted", async () => {
    const db = fakeDb();
    const now = new Date("2026-11-21T10:00:00Z");
    db.tenancy.findUnique = vi.fn(async () => ({ ...accepted, version: 5, tenantLeaseAcceptedAt: now, landlordLeaseAcceptedAt: now }));
    const result = await acceptLease(db, { ...accepted, tenantLeaseAcceptedAt: now }, "LANDLORD", 3, hash, now);
    expect(result.bothAccepted).toBe(true);
    const move = db.tenancy.updateMany.mock.calls[1][0];
    expect(move.data).toMatchObject({ status: "AWAITING_PAYMENT", paymentDueAt: new Date("2026-11-23T10:00:00Z") });
  });

  it("cannot be accepted twice by the same side", async () => {
    await expect(acceptLease(fakeDb(), { ...accepted, tenantLeaseAcceptedAt: new Date() }, "TENANT", 20, hash)).rejects.toThrow(/already/);
  });
});

describe("living rules in the lease", () => {
  it("turns the listing's common rules into lease sentences", () => {
    expect(leaseRulesFrom({ smokingPolicy: "outside", overnightGuests: "limited", overnightNights: 5, quietHours: "22:00 to 06:00", other: "  Gate   closes at 23:00 " })).toEqual([
      "No smoking inside the home; smoking outside is allowed.",
      "Overnight visitors up to 5 nights a month in total, within the maximum number of occupants.",
      "Quiet hours: 22:00 to 06:00.",
      "Gate closes at 23:00.",
    ]);
    expect(leaseRulesFrom(null)).toEqual([]);
    expect(houseRulesOf(JSON.stringify({ houseRules: { smokingPolicy: "none" } }))).toEqual(["No smoking anywhere in the home or the compound."]);
    expect(houseRulesOf("not json")).toEqual([]);
  });

  it("always carries the standard rules, and the landlord's own only when set", () => {
    const base = {
      tenancyRef: "tn_x", tenantName: "Sarah", landlordName: "Mr Juma", homeTitle: "Sea View Flats", homeArea: "",
      moveInDate: "2027-01-01", endDate: "2027-07-01", termMonths: 6, upfrontMonths: 6, currency: "USD", monthlyRent: 4500,
      firstMonthViaNolsaf: 4500, tenantFee: 1080, balanceDue: 22500, securityDepositMonths: 1, noticePeriodDays: 30, furnished: "FURNISHED",
      utilities: {}, balanceMethods: ["BANK"], petsAllowed: false, maxOccupants: 4,
    };
    const plain = buildLease(base);
    expect(plain).toContain("11. Living rules");
    expect(plain).toContain("let the Premises or any room by the night");
    expect(plain).toContain("at least 24 hours' notice");
    expect(plain).toContain("(a) No rules in addition to this Agreement.");
    const ruled = buildLease({ ...base, houseRules: ["No overnight visitors.", "Quiet hours: 22:00 to 06:00."] });
    expect(ruled).toContain("(a) No overnight visitors.\n(b) Quiet hours: 22:00 to 06:00.");
    expect(ruled).not.toContain("No rules in addition");
    expect(plain).not.toContain("—");
  });
});
