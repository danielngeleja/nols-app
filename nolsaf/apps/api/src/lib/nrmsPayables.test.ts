import { describe, expect, it } from "vitest";
import { ageDebts, bucketFor, dueDateFor, invoiceCheck, statementLines } from "./nrmsPayables.js";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe("due dates and buckets", () => {
  it("adds the supplier's credit days", () => {
    expect(dueDateFor(day("2026-09-01"), "CREDIT_14").toISOString().slice(0, 10)).toBe("2026-09-15");
    expect(dueDateFor(day("2026-09-01"), "CASH_ON_DELIVERY").toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("ages by days past due", () => {
    const asOf = day("2026-10-01");
    expect(bucketFor(day("2026-10-01"), asOf)).toBe("CURRENT");
    expect(bucketFor(day("2026-09-20"), asOf)).toBe("DAYS_1_30");
    expect(bucketFor(day("2026-08-15"), asOf)).toBe("DAYS_31_60");
    expect(bucketFor(day("2026-07-01"), asOf)).toBe("DAYS_OVER_60");
  });
});

describe("ageDebts", () => {
  const asOf = day("2026-10-01");
  const debts = [
    { id: 2, amount: 300_000, dueDate: day("2026-09-25") },
    { id: 1, amount: 500_000, dueDate: day("2026-07-20") },
    { id: 3, amount: 200_000, dueDate: day("2026-10-10") },
  ];

  it("clears the oldest debt first", () => {
    const aged = ageDebts(debts, 600_000, asOf);
    expect(aged.open.map((debt) => [debt.id, debt.open])).toEqual([[2, 200_000], [3, 200_000]]);
    expect(aged.buckets).toEqual({ CURRENT: 200_000, DAYS_1_30: 200_000, DAYS_31_60: 0, DAYS_OVER_60: 0 });
    expect(aged.outstanding).toBe(400_000);
    expect(aged.credit).toBe(0);
  });

  it("keeps an overpayment as credit with the supplier", () => {
    const aged = ageDebts(debts, 1_100_000, asOf);
    expect(aged.outstanding).toBe(0);
    expect(aged.credit).toBe(100_000);
  });

  it("shows unpaid old debt as over 60 days", () => {
    expect(ageDebts(debts, 0, asOf).buckets.DAYS_OVER_60).toBe(500_000);
  });
});

describe("invoiceCheck", () => {
  it("flags a bill above what was accepted", () => {
    // 10 crates billed, 8 accepted at 42,500 each.
    expect(invoiceCheck({ amount: 425_000, receivedValue: 340_000 })).toEqual({ flag: "BILLED_MORE", difference: 85_000 });
    expect(invoiceCheck({ amount: 340_000.5, receivedValue: 340_000 }).flag).toBe("MATCHED");
    expect(invoiceCheck({ amount: 300_000, receivedValue: 340_000 }).flag).toBe("BILLED_LESS");
  });
});

describe("statementLines", () => {
  it("runs a balance in date order", () => {
    const lines = statementLines([
      { date: day("2026-09-10"), kind: "PAYMENT", reference: "PAY-1", description: "", amount: -200_000, sourceId: 1 },
      { date: day("2026-09-01"), kind: "DELIVERY_CREDIT", reference: "GRN-1", description: "", amount: 500_000, sourceId: 1 },
      { date: day("2026-09-05"), kind: "DELIVERY_PAID", reference: "GRN-2", description: "", amount: 0, sourceId: 2 },
    ]);
    expect(lines.map((line) => [line.reference, line.balance])).toEqual([["GRN-1", 500_000], ["GRN-2", 500_000], ["PAY-1", 300_000]]);
  });
});
