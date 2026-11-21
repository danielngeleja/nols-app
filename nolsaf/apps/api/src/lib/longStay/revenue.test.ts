import { describe, expect, it, vi } from "vitest";

vi.mock("../fx.js", () => ({ BASE_CURRENCY: "TZS", getFxRates: async () => ({ tzsPerUnit: { TZS: 1, USD: 2500 } }) }));

import { recognizeLongStayRevenue, reverseLongStayRevenue, syncLongStayRevenue } from "../revenueRecognition.js";

const MOVED = new Date("2027-01-02T09:00:00Z");
const tenancy = {
  id: 7, currency: "USD", bookingAmount: 5580, tenantFee: 1080, landlordCommission: 1350, monthlyRent: 4500,
  moveInConfirmedAt: MOVED, paidAt: new Date("2026-12-14T10:00:00Z"), payoutStatus: "READY",
};

function ledgerDb(row: any = tenancy) {
  const entries: any[] = [];
  return {
    entries,
    tenancy: { findUnique: vi.fn(async () => row) },
    revenueEntry: {
      findUnique: vi.fn(async ({ where }: any) => entries.find((e) => e.sourceKey === where.sourceKey) ?? null),
      findMany: vi.fn(async ({ where }: any) => entries.filter((e) => e.reversesId === where.reversesId)),
      create: vi.fn(async ({ data }: any) => { const e = { id: entries.length + 1, ...data }; entries.push(e); return e; }),
    },
  } as any;
}

describe("long-stay revenue", () => {
  it("recognizes both fees once at move-in, from the frozen tenancy (spec: USD 4,500 x 6)", async () => {
    const db = ledgerDb();
    const result = await recognizeLongStayRevenue(db, 7);
    expect(result.status).toBe("created");
    const entry = db.entries[0];
    expect(entry).toMatchObject({ stream: "LONG_STAY", sourceType: "TENANCY", sourceId: 7, sourceKey: "LONG_STAY:TENANCY:7", currency: "USD", entryType: "RECOGNIZED" });
    expect(Number(entry.gross)).toBe(5580);
    expect(Number(entry.commission)).toBe(2430);
    expect(Number(entry.partnerNet)).toBe(3150);
    expect(Number(entry.commissionTzs)).toBe(2430 * 2500);
    expect((await recognizeLongStayRevenue(db, 7)).status).toBe("existing");
    expect(db.entries).toHaveLength(1);
  });

  it("waits for move-in and skips a refunded first month", async () => {
    expect((await recognizeLongStayRevenue(ledgerDb({ ...tenancy, moveInConfirmedAt: null }), 7)).status).toBe("skipped");
    expect((await recognizeLongStayRevenue(ledgerDb({ ...tenancy, payoutStatus: "REFUND_DUE" }), 7)).status).toBe("skipped");
  });

  it("reverses a recognized tenancy when the first month is refunded, once", async () => {
    const db = ledgerDb();
    await recognizeLongStayRevenue(db, 7);
    const reversal = await reverseLongStayRevenue(db, 7, "refund");
    expect(reversal.status).toBe("created");
    expect(db.entries[1]).toMatchObject({ entryType: "REVERSAL", sourceKey: "LONG_STAY:TENANCY_REFUND:7", reversesId: 1 });
    expect(Number(db.entries[1].commission)).toBe(-2430);
    expect((await reverseLongStayRevenue(db, 7, "refund")).status).toBe("existing");
  });

  it("sync recognizes or reverses depending on where the money went", async () => {
    const db = ledgerDb();
    expect((await syncLongStayRevenue(db, 7)).status).toBe("created");
    db.tenancy.findUnique = vi.fn(async () => ({ ...tenancy, payoutStatus: "REFUND_DUE" }));
    expect((await syncLongStayRevenue(db, 7)).status).toBe("created");
    expect(db.entries.map((e: any) => e.entryType)).toEqual(["RECOGNIZED", "REVERSAL"]);
  });
});
