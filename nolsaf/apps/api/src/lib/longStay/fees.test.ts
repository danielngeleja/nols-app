import { describe, expect, it } from "vitest";
import { balanceMatchesLease, computeLongStayQuote, isLongStayPropertyType, LongStayQuoteError } from "./fees.js";

describe("computeLongStayQuote: the spec's worked examples (section 4.5)", () => {
  it("USD 4,500 a month, 6 months", () => {
    const q = computeLongStayQuote({ monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, currency: "USD" });
    expect(q).toMatchObject({ tenantFee: 1080, landlordCommission: 1350, bookingAmount: 5580, balanceDue: 22500, landlordPayout: 3150, termRent: 27000 });
  });

  it("TSh 1,500,000 a month, 6 months", () => {
    const q = computeLongStayQuote({ monthlyRent: "1500000", termMonths: 6, upfrontMonths: 6, currency: "tzs" });
    expect(q).toMatchObject({ currency: "TZS", tenantFee: 360000, landlordCommission: 450000, bookingAmount: 1860000, balanceDue: 7500000, landlordPayout: 1050000 });
  });

  it("USD 4,500 a month, 12 months: both caps apply", () => {
    const q = computeLongStayQuote({ monthlyRent: 4500, termMonths: 12, upfrontMonths: 12, currency: "USD" });
    expect(q).toMatchObject({ tenantFee: 1125, landlordCommission: 2250, bookingAmount: 5625, balanceDue: 49500, landlordPayout: 2250 });
  });
});

describe("computeLongStayQuote: rules", () => {
  it("bases fees on the lease term, not the months paid up front", () => {
    const allUpfront = computeLongStayQuote({ monthlyRent: 1_000_000, termMonths: 12, upfrontMonths: 12, currency: "TZS" });
    const sixUpfront = computeLongStayQuote({ monthlyRent: 1_000_000, termMonths: 12, upfrontMonths: 6, currency: "TZS" });
    expect(sixUpfront.landlordCommission).toBe(allUpfront.landlordCommission);
    expect(sixUpfront.tenantFee).toBe(allUpfront.tenantFee);
    expect(sixUpfront.balanceDue).toBe(5_000_000);
  });

  it("rounds TZS to whole shillings and USD to cents, half up", () => {
    expect(computeLongStayQuote({ monthlyRent: 333_333, termMonths: 3, upfrontMonths: 3, currency: "TZS" }).tenantFee).toBe(40000); // 39,999.96
    expect(computeLongStayQuote({ monthlyRent: 1234.57, termMonths: 3, upfrontMonths: 3, currency: "USD" }).tenantFee).toBe(148.15); // 148.1484
  });

  it("uses snapshotted rates when given", () => {
    const q = computeLongStayQuote({ monthlyRent: 1000, termMonths: 6, upfrontMonths: 6, currency: "USD", rates: { landlordPercent: "3.00", tenantPercent: 0 } });
    expect(q.landlordCommission).toBe(180);
    expect(q.tenantFee).toBe(0);
    expect(q.bookingAmount).toBe(1000);
  });

  it("refuses bad input instead of guessing", () => {
    const bad: Array<Parameters<typeof computeLongStayQuote>[0]> = [
      { monthlyRent: 0, termMonths: 6, upfrontMonths: 6, currency: "TZS" },
      { monthlyRent: -5, termMonths: 6, upfrontMonths: 6, currency: "TZS" },
      { monthlyRent: "abc", termMonths: 6, upfrontMonths: 6, currency: "TZS" },
      { monthlyRent: 1000.5, termMonths: 6, upfrontMonths: 6, currency: "TZS" },
      { monthlyRent: 10.555, termMonths: 6, upfrontMonths: 6, currency: "USD" },
      { monthlyRent: 1000, termMonths: 6, upfrontMonths: 6, currency: "EUR" },
      { monthlyRent: 1000, termMonths: 1, upfrontMonths: 1, currency: "USD" },
      { monthlyRent: 1000, termMonths: 6.5, upfrontMonths: 6, currency: "USD" },
      { monthlyRent: 1000, termMonths: 6, upfrontMonths: 7, currency: "USD" },
      { monthlyRent: 1000, termMonths: 6, upfrontMonths: 0, currency: "USD" },
      { monthlyRent: 5_000_000, termMonths: 6, upfrontMonths: 6, currency: "USD" },
      { monthlyRent: 1000, termMonths: 6, upfrontMonths: 6, currency: "USD", rates: { landlordCapMonths: 2 } },
      { monthlyRent: 1000, termMonths: 6, upfrontMonths: 6, currency: "USD", rates: { tenantPercent: "NaN" } },
    ];
    for (const input of bad) expect(() => computeLongStayQuote(input), JSON.stringify(input)).toThrow(LongStayQuoteError);
  });
});

describe("balanceMatchesLease", () => {
  it("matches exactly in minor units only", () => {
    expect(balanceMatchesLease(22500, "22500.00", "USD")).toBe(true);
    expect(balanceMatchesLease("18000", 22500, "USD")).toBe(false);
    expect(balanceMatchesLease(22499.99, 22500, "USD")).toBe(false);
    expect(balanceMatchesLease(null, 22500, "USD")).toBe(false);
    expect(balanceMatchesLease(100, 100, "EUR")).toBe(false);
  });
});

describe("isLongStayPropertyType", () => {
  it("allows homes and apartments, never hotels or lodges", () => {
    expect(isLongStayPropertyType("APARTMENT")).toBe(true);
    expect(isLongStayPropertyType("house")).toBe(true);
    expect(isLongStayPropertyType("HOTEL")).toBe(false);
    expect(isLongStayPropertyType("LODGE")).toBe(false);
    expect(isLongStayPropertyType("GUEST_HOUSE")).toBe(false);
    expect(isLongStayPropertyType(null)).toBe(false);
  });
});
