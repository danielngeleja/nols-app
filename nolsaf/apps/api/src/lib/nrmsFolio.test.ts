import { describe, expect, it } from "vitest";
import { computeGuestBalance, computeOutstanding, getCheckoutSettlement, sumNonVoidedCharges } from "./nrmsFolio.js";

describe("NRMS guest folio balance", () => {
  it("adds extra charges on top of the room total", () => {
    expect(computeGuestBalance(100000, 25000, 60000)).toBe(65000);
  });

  it("accepts Prisma Decimal-as-string inputs", () => {
    expect(computeGuestBalance("120000.50", "4999.50", "25000.00")).toBe(100000);
  });

  it("treats null money fields as zero", () => {
    expect(computeGuestBalance(null, null, null)).toBe(0);
    expect(computeGuestBalance(50000, null, undefined)).toBe(50000);
  });

  it("rounds float artifacts to two decimals", () => {
    expect(computeGuestBalance(0.1, 0.2, 0)).toBe(0.3);
    expect(computeGuestBalance(10000.1, 0.2, 10000.3)).toBe(0);
  });

  it("goes negative when the guest overpaid, while outstanding clamps at zero", () => {
    expect(computeGuestBalance(100000, 0, 120000)).toBe(-20000);
    expect(computeOutstanding(100000, 0, 120000)).toBe(0);
  });

  it("allows a payment equal to the charge-inclusive balance but not one cent more", () => {
    const outstanding = computeOutstanding(100000, 15000, 40000);
    expect(outstanding).toBe(75000);
    expect(75000 <= outstanding).toBe(true);
    expect(75000.01 <= outstanding).toBe(false);
  });

  it("reopens a positive outstanding when a charge lands after full payment", () => {
    expect(computeOutstanding(100000, 0, 100000)).toBe(0);
    expect(computeOutstanding(100000, 8000, 100000)).toBe(8000);
  });
});

describe("NRMS charge summation", () => {
  it("excludes voided charges", () => {
    const total = sumNonVoidedCharges([
      { amount: "12000.00", voidedAt: null },
      { amount: 8000, voidedAt: new Date("2026-07-15T10:00:00Z") },
      { amount: "500.50", voidedAt: null },
    ]);
    expect(total).toBe(12500.5);
  });

  it("returns zero for an empty folio", () => {
    expect(sumNonVoidedCharges([])).toBe(0);
  });
});

describe("NRMS checkout settlement", () => {
  it("blocks checkout while room or extra-charge money is due", () => {
    expect(getCheckoutSettlement(100000, 25000, 120000)).toEqual({ settled: false, balance: 5000, code: "GUEST_BALANCE_DUE" });
  });

  it("blocks checkout while an unresolved guest credit remains", () => {
    expect(getCheckoutSettlement(100000, 0, 101000)).toEqual({ settled: false, balance: -1000, code: "GUEST_CREDIT_REMAINS" });
  });

  it("permits checkout only when the complete folio is settled", () => {
    expect(getCheckoutSettlement(100000, 25000, 125000)).toEqual({ settled: true, balance: 0, code: null });
  });
});
