import { describe, expect, it, vi } from "vitest";
import {
  LongStayListingError,
  applyDiscount,
  discountForTerm,
  longStaySubmitRefusal,
  rentForTerm,
  longStayTypeRefusal,
  parseLongStayTerms,
  termsToRow,
  validateRentalMode,
  writeRentalMode,
} from "./listing.js";

const TODAY = "2026-11-21";
const terms = {
  monthlyRent: 1_500_000,
  currency: "TZS",
  minTermMonths: 6,
  upfrontMonths: 6,
  furnished: "FURNISHED",
  utilities: { water: "INCLUDED", electricity: "TENANT", internet: "TENANT", security: "INCLUDED", serviceCharge: "INCLUDED" },
  securityDepositMonths: 1,
  noticePeriodDays: 30,
  balanceMethods: ["BANK", "MOBILE_MONEY"],
  residencyRules: { petsAllowed: false, maxOccupants: 4 },
  availableFrom: "2027-01-01",
};

function fakeDb(opts: { grant?: { pausedAt?: Date | null; pauseReason?: string | null } | null; tenancies?: string[]; listing?: any; bookings?: number; roomsSpec?: unknown } = {}) {
  return {
    longStayLandlordGrant: { findUnique: vi.fn(async () => (opts.grant === undefined ? { enabledAt: new Date(), pausedAt: null, pauseReason: null } : opts.grant)) },
    tenancy: { findMany: vi.fn(async () => (opts.tenancies ?? []).map((status) => ({ status }))) },
    longStayListing: { upsert: vi.fn(), deleteMany: vi.fn(), findUnique: vi.fn(async () => opts.listing ?? null) },
    property: { update: vi.fn(), findUnique: vi.fn(async () => ({ roomsSpec: opts.roomsSpec ?? [{ bookingMode: "ENTIRE_UNIT" }] })) },
    booking: { count: vi.fn(async () => opts.bookings ?? 0) },
  };
}

const base = { propertyId: 9, ownerId: 3, propertyType: "APARTMENT", rentalMode: "LONG_STAY" as const, terms, assisted: false };

describe("parseLongStayTerms", () => {
  it("accepts complete terms and removes duplicate methods", () => {
    const parsed = parseLongStayTerms({ ...terms, balanceMethods: ["BANK", "BANK"] }, TODAY);
    expect(parsed.balanceMethods).toEqual(["BANK"]);
  });

  it("refuses unknown fields, bad terms and dates outside the window", () => {
    const bad = [
      { ...terms, extra: 1 },
      { ...terms, minTermMonths: 1 },
      { ...terms, minTermMonths: 9 },
      { ...terms, upfrontMonths: 7 },
      { ...terms, maxTermMonths: 3 },
      { ...terms, securityDepositMonths: 3 },
      { ...terms, noticePeriodDays: 7 },
      { ...terms, balanceMethods: [] },
      { ...terms, balanceMethods: ["CASH"] },
      { ...terms, currency: "EUR" },
      { ...terms, monthlyRent: 1500.5 },
      { ...terms, utilities: { ...terms.utilities, gas: "INCLUDED" } },
      { ...terms, availableFrom: "2026-11-20" },
      { ...terms, availableFrom: "2028-01-01" },
      { ...terms, availableFrom: "01/01/2027" },
    ];
    for (const input of bad) expect(() => parseLongStayTerms(input, TODAY), JSON.stringify(input)).toThrow(LongStayListingError);
  });
});

describe("validateRentalMode", () => {
  it("lets a switched-on landlord list a home monthly", async () => {
    const change = await validateRentalMode(fakeDb(), base);
    expect(change.rentalMode).toBe("LONG_STAY");
    expect(change.terms?.monthlyRent).toBe(1_500_000);
  });

  it("refuses without the switch, while paused, on assisted listings and for hotels", async () => {
    await expect(validateRentalMode(fakeDb({ grant: null }), base)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/not switched on/) });
    await expect(validateRentalMode(fakeDb({ grant: { pausedAt: new Date(), pauseReason: "review" } }), base)).rejects.toMatchObject({ status: 403, message: expect.stringMatching(/paused.*: review/) });
    await expect(validateRentalMode(fakeDb(), { ...base, assisted: true })).rejects.toMatchObject({ status: 403 });
    await expect(validateRentalMode(fakeDb(), { ...base, propertyType: "HOTEL" })).rejects.toThrow(/houses, apartments/);
    await expect(validateRentalMode(fakeDb({ bookings: 2 }), base)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/2 nightly bookings still to come/) });
    await expect(validateRentalMode(fakeDb({ bookings: 2 }), { ...base, propertyId: null })).resolves.toMatchObject({ rentalMode: "LONG_STAY" });
  });

  it("keeps a home on long stay while a tenancy is open", async () => {
    await expect(validateRentalMode(fakeDb({ tenancies: ["RESERVED"] }), { ...base, rentalMode: "NIGHTLY" })).rejects.toMatchObject({ status: 409 });
    await expect(validateRentalMode(fakeDb({ tenancies: ["CANCELLED", "ENDED"] }), { ...base, rentalMode: "NIGHTLY" })).resolves.toEqual({ rentalMode: "NIGHTLY", terms: null });
  });
});

describe("writeRentalMode", () => {
  it("stores terms with the mode, and clears them when going back to nightly", async () => {
    const db = fakeDb();
    const change = await validateRentalMode(db, base);
    await writeRentalMode(db, 9, change);
    expect(db.longStayListing.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { propertyId: 9 } }));
    expect(db.property.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { rentalMode: "LONG_STAY" } });
    await writeRentalMode(db, 9, { rentalMode: "NIGHTLY", terms: null });
    expect(db.longStayListing.deleteMany).toHaveBeenCalledWith({ where: { propertyId: 9 } });
  });
});

describe("longStaySubmitRefusal and type changes", () => {
  const property = { id: 9, ownerId: 3, type: "APARTMENT", rentalMode: "LONG_STAY" };

  it("lets nightly listings through untouched", async () => {
    expect(await longStaySubmitRefusal(fakeDb({ grant: null }), { ...property, rentalMode: "NIGHTLY" })).toBeNull();
  });

  it("re-checks the switch, the type and the saved terms", async () => {
    const row = termsToRow(parseLongStayTerms(terms, TODAY));
    expect(await longStaySubmitRefusal(fakeDb({ listing: row }), property)).toBeNull();
    expect(await longStaySubmitRefusal(fakeDb({ grant: null, listing: row }), property)).toMatch(/not switched on/);
    expect(await longStaySubmitRefusal(fakeDb({ listing: row }), { ...property, type: "LODGE" })).toMatch(/houses, apartments/);
    expect(await longStaySubmitRefusal(fakeDb(), property)).toMatch(/monthly rent and terms/);
    expect(await longStaySubmitRefusal(fakeDb({ listing: row, roomsSpec: [{ bookingMode: "PER_ROOM" }] }), property)).toMatch(/whole home/);
    expect(await longStaySubmitRefusal(fakeDb({ listing: row, roomsSpec: [{ bookingMode: "ENTIRE_UNIT", unitStyle: "UNIT" }] }), property)).toMatch(/whole home/);
  });

  it("stops a long-stay listing from becoming a hotel", () => {
    expect(longStayTypeRefusal("LONG_STAY", "HOTEL")).toMatch(/houses, apartments/);
    expect(longStayTypeRefusal("LONG_STAY", "VILLA")).toBeNull();
    expect(longStayTypeRefusal("NIGHTLY", "HOTEL")).toBeNull();
  });
});

describe("discounts and bill estimates", () => {
  it("keeps discounts and only the estimates for bills the tenant pays", () => {
    const parsed = parseLongStayTerms({ ...terms, discounts: { m6: 5, m12: 10 }, billEstimates: { electricity: 60000, water: 20000, internet: 0 } }, TODAY);
    expect(parsed.discounts).toEqual({ m6: 5, m12: 10 });
    expect(parsed.billEstimates).toEqual({ electricity: 60000 });
    expect(parseLongStayTerms({ ...terms, discounts: { m6: null, m12: null } }, TODAY).discounts).toBeNull();
    expect(() => parseLongStayTerms({ ...terms, discounts: { m6: 10, m12: 5 } }, TODAY)).toThrow(/12-month discount/);
    expect(() => parseLongStayTerms({ ...terms, discounts: { m12: 40 } }, TODAY)).toThrow();
  });

  it("takes the right discount off for each lease length, rounded to the currency", () => {
    const t = { monthlyRent: 1_500_000, currency: "TZS" as const, discounts: { m6: 5, m12: 10 } };
    expect(discountForTerm(t, 3)).toBe(0);
    expect(rentForTerm(t, 3)).toBe(1_500_000);
    expect(rentForTerm(t, 6)).toBe(1_425_000);
    expect(rentForTerm(t, 12)).toBe(1_350_000);
    expect(rentForTerm({ ...t, discounts: { m6: 5, m12: null } }, 12)).toBe(1_425_000);
    expect(rentForTerm({ monthlyRent: 1234.55, currency: "USD" as const, discounts: { m6: 7, m12: null } }, 6)).toBe(1148.13);
    expect(applyDiscount(999_999, "TZS", 3)).toBe(969_999);
  });
});

describe("choosing monthly before the terms are finished", () => {
  it("saves the mode and keeps any saved terms", async () => {
    const db = fakeDb();
    const change = await validateRentalMode(db, { ...base, terms: null });
    expect(change).toEqual({ rentalMode: "LONG_STAY", terms: null });
    await writeRentalMode(db, 9, change);
    expect(db.longStayListing.deleteMany).not.toHaveBeenCalled();
    expect(db.property.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { rentalMode: "LONG_STAY" } });
    await expect(validateRentalMode(fakeDb({ grant: null }), { ...base, terms: null })).rejects.toMatchObject({ status: 403 });
  });
});
