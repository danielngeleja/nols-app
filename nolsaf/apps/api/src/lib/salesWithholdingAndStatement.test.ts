import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateSalesPayoutApproval, salesWithholdingTaxRate } from "./salesFinance.js";
import { buildSalesStatement, listStatementMonths, monthKey, monthRange } from "./salesStatement.js";

describe("sales withholding tax", () => {
  afterEach(() => {
    delete process.env.SALES_WHT_RATE_PERCENT;
  });

  it("is off until finance sets a rate", () => {
    expect(salesWithholdingTaxRate()).toBe(0);
    process.env.SALES_WHT_RATE_PERCENT = "5";
    expect(salesWithholdingTaxRate()).toBe(5);
    process.env.SALES_WHT_RATE_PERCENT = "nonsense";
    expect(salesWithholdingTaxRate()).toBe(0);
  });

  it("withholds on the amount owed after deductions and keeps the arithmetic reconcilable", () => {
    const result = calculateSalesPayoutApproval(100_000, 2_500, 5);
    expect(result).toEqual({
      approvedAmount: 100_000,
      deductionAmount: 2_500,
      withholdingTaxRate: 5,
      withholdingTaxAmount: 4_875,
      netPaidAmount: 92_625,
    });
    expect(result.approvedAmount - result.deductionAmount - result.withholdingTaxAmount).toBe(result.netPaidAmount);
  });

  it("changes nothing when the rate is zero", () => {
    expect(calculateSalesPayoutApproval(100_000, 2_500)).toMatchObject({ withholdingTaxAmount: 0, netPaidAmount: 97_500 });
  });

  it("rounds to the cent", () => {
    expect(calculateSalesPayoutApproval(33_333.33, 0, 5).withholdingTaxAmount).toBe(1_666.67);
  });
});

describe("sales monthly statement", () => {
  it("runs months on East Africa Time", () => {
    const range = monthRange("2026-09")!;
    expect(range.from.toISOString()).toBe("2026-08-31T21:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-09-30T21:00:00.000Z");
    expect(monthRange("2026-13")).toBeNull();
    expect(monthKey(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10");
    expect(monthRange("2026-12")!.to.toISOString()).toBe("2026-12-31T21:00:00.000Z");
  });

  it("totals come from the listed rows, with tax and destination per payout", async () => {
    const db: any = {
      salesPartnerProfile: { findUnique: vi.fn().mockResolvedValue({ agentCode: "NSA-DAR-0001", region: "Dar es Salaam", taxIdNumber: "123-456-789", user: { name: "Amosy", fullName: "Amosy Nickson", email: "a@x.tz" } }) },
      salesCommission: {
        findMany: vi.fn()
          .mockResolvedValueOnce([
            { id: 1, propertyId: 4, type: "NRMS_USAGE", status: "AVAILABLE", eligibleNetRevenue: "200000", commissionRate: "10", commissionAmount: "20000", currency: "TZS", earnedAt: new Date("2026-09-05") },
            { id: 2, propertyId: 4, type: "MARKETPLACE_BOOKING", status: "PAID", eligibleNetRevenue: "300000", commissionRate: "10", commissionAmount: "30000", currency: "TZS", earnedAt: new Date("2026-09-12") },
          ])
          .mockResolvedValueOnce([{ id: 3, propertyId: 4, type: "NRMS_USAGE", commissionAmount: "5000", reversedAt: new Date("2026-09-20") }]),
      },
      salesPayoutRequest: {
        findMany: vi.fn().mockResolvedValue([
          { id: 70, referenceNumber: "SP-2026-11-ABC", paidAt: new Date("2026-09-25"), approvedAmount: "100000", requestedAmount: "100000", deductionAmount: "2500", withholdingTaxRate: "5", withholdingTaxAmount: "4875", netPaidAmount: "92625", payoutMethod: "M-Pesa", payoutAccount: "255754123456", currency: "TZS" },
        ]),
      },
      property: { findMany: vi.fn().mockResolvedValue([{ id: 4, title: "Jamirex Hotel" }]) },
    };

    const statement = (await buildSalesStatement(db, 11, "2026-09"))!;
    expect(statement.partner).toMatchObject({ agentCode: "NSA-DAR-0001", name: "Amosy Nickson", taxIdNumber: "123-456-789" });
    expect(statement.summary).toEqual({
      earned: 50_000, earnedCount: 2, reversed: 5_000, reversedCount: 1, netEarned: 45_000,
      payoutsCount: 1, grossPaid: 100_000, deductions: 2_500, withholdingTax: 4_875, netReceived: 92_625,
    });
    expect(statement.earnings[0]).toMatchObject({ property: "Jamirex Hotel", stream: "NRMS commission", amount: 20_000 });
    expect(statement.payouts[0].destination).toBe("M-Pesa ending 3456");
  });

  it("never throws: a failing stream still returns the partner and an empty month", async () => {
    const db: any = {
      salesPartnerProfile: { findUnique: vi.fn().mockResolvedValue({ agentCode: "NSA-DAR-0001", user: {} }) },
      salesCommission: { findMany: vi.fn().mockRejectedValue(new Error("db down")) },
      salesPayoutRequest: { findMany: vi.fn().mockResolvedValue([]) },
      property: { findMany: vi.fn() },
    };
    const statement = (await buildSalesStatement(db, 11, "2026-09"))!;
    expect(statement.partner.agentCode).toBe("NSA-DAR-0001");
    expect(statement.summary.earned).toBe(0);
  });

  it("lists months from first activity to now, newest first", async () => {
    const db: any = {
      salesCommission: { findFirst: vi.fn().mockResolvedValue({ earnedAt: new Date("2026-07-10T10:00:00Z") }) },
      salesPayoutRequest: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    await expect(listStatementMonths(db, 11, new Date("2026-09-23T10:00:00Z"))).resolves.toEqual(["2026-09", "2026-08", "2026-07"]);
  });
});
