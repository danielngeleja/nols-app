import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fx.js", () => ({
  BASE_CURRENCY: "TZS",
  getFxRates: vi.fn(async () => ({ tzsPerUnit: { TZS: 1, USD: 2600, EUR: 2800 } })),
}));

import {
  computeReversalAmounts,
  eatBusinessDate,
  recognizeRevenue,
  reverseRevenue,
  revenueSourceKey,
  round2,
} from "./revenueLedger.js";

/** In-memory revenue_entry with the real UNIQUE(sourceKey) behaviour. */
function memoryLedger() {
  const rows: any[] = [];
  let nextId = 1;
  const db = {
    rows,
    revenueEntry: {
      findUnique: vi.fn(async ({ where }: any) => rows.find((r) => r.sourceKey === where.sourceKey) ?? null),
      findMany: vi.fn(async ({ where }: any) => rows.filter((r) => r.reversesId === where.reversesId)),
      create: vi.fn(async ({ data }: any) => {
        if (rows.some((r) => r.sourceKey === data.sourceKey)) {
          const err: any = new Error("Unique constraint failed on the constraint: `revenue_entry_sourceKey_key`");
          err.code = "P2002";
          throw err;
        }
        const row = { id: nextId++, createdAt: new Date(), ...data };
        rows.push(row);
        return row;
      }),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    $queryRaw: vi.fn(async () => []),
  };
  return db;
}

const sum = (rows: any[], field: string) => round2(rows.reduce((acc, r) => acc + Number(r[field]), 0));
const AT = new Date("2026-11-09T07:30:00Z"); // 10:30 EAT

let db: ReturnType<typeof memoryLedger>;
beforeEach(() => {
  db = memoryLedger();
});

describe("revenueSourceKey", () => {
  it("builds <stream>:<sourceType>:<sourceId>", () => {
    expect(revenueSourceKey("ACCOMMODATION", "INVOICE", 42)).toBe("ACCOMMODATION:INVOICE:42");
  });

  it("refuses keys that would not be stable", () => {
    expect(() => revenueSourceKey("SHOP" as any, "INVOICE", 1)).toThrow("REVENUE_UNKNOWN_STREAM");
    expect(() => revenueSourceKey("TOUR", "tour booking", 1)).toThrow("REVENUE_BAD_SOURCE_TYPE");
    expect(() => revenueSourceKey("TOUR", "TOUR_BOOKING", 0)).toThrow("REVENUE_BAD_SOURCE_ID");
    expect(() => revenueSourceKey("TOUR", "TOUR_BOOKING", 1.5)).toThrow("REVENUE_BAD_SOURCE_ID");
  });
});

describe("recognizeRevenue", () => {
  const invoice = { stream: "ACCOMMODATION" as const, sourceType: "INVOICE", sourceId: 7, gross: 230000, commission: 30000, partnerNet: 200000, recognizedAt: AT, paymentEventId: 91 };

  it("writes one RECOGNIZED row with frozen TZS amounts and provenance", async () => {
    const result = await recognizeRevenue(db, invoice);
    expect(result.status).toBe("created");
    expect(db.rows).toHaveLength(1);
    const row = db.rows[0];
    expect(row).toMatchObject({
      stream: "ACCOMMODATION",
      sourceType: "INVOICE",
      sourceId: 7,
      sourceKey: "ACCOMMODATION:INVOICE:7",
      currency: "TZS",
      entryType: "RECOGNIZED",
      reversesId: null,
      paymentEventId: 91,
      recognizedAt: AT,
    });
    expect(Number(row.gross)).toBe(230000);
    expect(Number(row.fxTzsPerUnit)).toBe(1);
    expect(Number(row.grossTzs)).toBe(230000);
    expect(Number(row.commissionTzs)).toBe(30000);
    expect(Number(row.partnerNetTzs)).toBe(200000);
    expect(row.businessDate.toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("is idempotent across retries and replays: the first recognition is the record", async () => {
    await recognizeRevenue(db, invoice);
    const retry = await recognizeRevenue(db, invoice);
    // A replay after an admin edited the commission must not restate the entry.
    const replay = await recognizeRevenue(db, { ...invoice, commission: 45000, partnerNet: 185000, recognizedAt: new Date() });
    expect(retry.status).toBe("existing");
    expect(replay.status).toBe("existing");
    expect(db.rows).toHaveLength(1);
    expect(Number(db.rows[0].commission)).toBe(30000);
    expect(db.revenueEntry.create).toHaveBeenCalledTimes(1);
  });

  it("settles a concurrent duplicate on the unique key instead of double counting", async () => {
    const [a, b] = await Promise.all([recognizeRevenue(db, invoice), recognizeRevenue(db, invoice)]);
    expect(db.rows).toHaveLength(1);
    expect([a.status, b.status].sort()).toEqual(["created", "existing"]);
    expect(a.entry.id).toBe(b.entry.id);
  });

  it("never updates or deletes a row", async () => {
    await recognizeRevenue(db, invoice);
    await recognizeRevenue(db, invoice);
    await reverseRevenue(db, { original: invoice, sourceType: "CANCELLATION_REFUND", sourceId: 3, reason: "refund" });
    expect(db.revenueEntry.update).not.toHaveBeenCalled();
    expect(db.revenueEntry.updateMany).not.toHaveBeenCalled();
    expect(db.revenueEntry.upsert).not.toHaveBeenCalled();
    expect(db.revenueEntry.delete).not.toHaveBeenCalled();
  });

  it("refuses negative or non-numeric amounts", async () => {
    await expect(recognizeRevenue(db, { ...invoice, commission: -1 })).rejects.toThrow("REVENUE_NEGATIVE_COMMISSION");
    expect(db.rows).toHaveLength(0);
  });
});

describe("EAT business date", () => {
  it("rolls to the next day at 21:00 UTC, which is midnight in Dar es Salaam", () => {
    expect(eatBusinessDate(new Date("2026-11-08T20:59:59.999Z")).toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(eatBusinessDate(new Date("2026-11-08T21:00:00.000Z")).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("puts a callback at 00:30 EAT on the new day, and month and year ends roll with it", async () => {
    await recognizeRevenue(db, { stream: "TOUR", sourceType: "TOUR_BOOKING", sourceId: 1, gross: 10, commission: 1, partnerNet: 9, recognizedAt: new Date("2026-12-31T21:30:00Z") });
    expect(db.rows[0].businessDate.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("dates by occurredAt when the money moved before the callback landed", async () => {
    await recognizeRevenue(db, {
      stream: "TOUR", sourceType: "TOUR_BOOKING", sourceId: 2, gross: 10, commission: 1, partnerNet: 9,
      recognizedAt: new Date("2026-11-08T21:05:00Z"), // 00:05 EAT on the 9th
      occurredAt: new Date("2026-11-08T20:58:00Z"), // 23:58 EAT on the 8th
    });
    expect(db.rows[0].businessDate.toISOString()).toBe("2026-11-08T00:00:00.000Z");
    expect(db.rows[0].recognizedAt.toISOString()).toBe("2026-11-08T21:05:00.000Z");
  });
});

describe("non-TZS revenue", () => {
  const tour = { stream: "TOUR" as const, sourceType: "TOUR_BOOKING", sourceId: 11, currency: "usd", gross: 1250.5, commission: 187.58, partnerNet: 1062.92, recognizedAt: AT };

  it("keeps the own-currency amounts and freezes the booking's captured rate", async () => {
    await recognizeRevenue(db, { ...tour, fxTzsPerUnit: "2550.000000" });
    const row = db.rows[0];
    expect(row.currency).toBe("USD");
    expect(Number(row.gross)).toBe(1250.5);
    expect(Number(row.fxTzsPerUnit)).toBe(2550);
    expect(Number(row.grossTzs)).toBe(3188775);
    expect(Number(row.commissionTzs)).toBe(478329);
    expect(Number(row.partnerNetTzs)).toBe(2710446);
  });

  it("falls back to the current rate when the source froze none", async () => {
    await recognizeRevenue(db, { ...tour, fxTzsPerUnit: null });
    expect(Number(db.rows[0].fxTzsPerUnit)).toBe(2600);
    expect(Number(db.rows[0].grossTzs)).toBe(3251300);
  });

  it("refuses a currency with no rate rather than booking it 1:1", async () => {
    await expect(recognizeRevenue(db, { ...tour, currency: "GBP" })).rejects.toThrow("REVENUE_FX_RATE_UNAVAILABLE:GBP");
  });

  it("reverses at the original rate, so a full refund nets to zero in TZS after a rate change", async () => {
    await recognizeRevenue(db, { ...tour, fxTzsPerUnit: 2550 });
    const result = await reverseRevenue(db, { original: tour, sourceType: "TOUR_REFUND", sourceId: 5, reason: "refund" });
    expect(Number(result.entry.fxTzsPerUnit)).toBe(2550);
    for (const field of ["gross", "commission", "partnerNet", "grossTzs", "commissionTzs", "partnerNetTzs"]) {
      expect(sum(db.rows, field)).toBe(0);
    }
  });
});

describe("reverseRevenue", () => {
  const original = { stream: "ACCOMMODATION" as const, sourceType: "INVOICE", sourceId: 7 };
  beforeEach(async () => {
    await recognizeRevenue(db, { ...original, gross: 230000, commission: 30000, partnerNet: 200000, recognizedAt: AT });
  });

  it("writes a REVERSAL row with negated amounts pointing at the original", async () => {
    const at = new Date("2026-11-20T22:15:00Z"); // 01:15 EAT on the 21st
    const result = await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 3, reason: "Refund on cancellation request 3", recognizedAt: at });
    expect(result.status).toBe("created");
    expect(result.entry).toMatchObject({
      entryType: "REVERSAL",
      reversesId: db.rows[0].id,
      sourceKey: "ACCOMMODATION:CANCELLATION_REFUND:3",
      stream: "ACCOMMODATION",
      reason: "Refund on cancellation request 3",
    });
    expect(Number(result.entry.gross)).toBe(-230000);
    expect(Number(result.entry.commissionTzs)).toBe(-30000);
    expect(result.entry.businessDate.toISOString()).toBe("2026-11-21T00:00:00.000Z");
    expect(sum(db.rows, "commissionTzs")).toBe(0);
    // Serialized against other reversals of the same entry.
    const lockSql = (db.$queryRaw.mock.calls as unknown as Array<[TemplateStringsArray]>)[0][0];
    expect(lockSql.join("?")).toContain("FOR UPDATE");
  });

  it("is idempotent on the reversal's own source", async () => {
    await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 3, gross: 50000, reason: "r" });
    const again = await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 3, gross: 50000, reason: "r" });
    expect(again.status).toBe("existing");
    expect(db.rows).toHaveLength(2);
  });

  it("takes a partial refund in proportion and caps later ones at what is left", async () => {
    const first = await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 1, gross: 92000, reason: "40 percent" });
    expect(Number(first.entry.gross)).toBe(-92000);
    expect(Number(first.entry.commission)).toBe(-12000);
    expect(Number(first.entry.partnerNet)).toBe(-80000);

    const second = await reverseRevenue(db, { original, sourceType: "CHARGEBACK", sourceId: 2, gross: 500000, reason: "chargeback larger than left" });
    expect(Number(second.entry.gross)).toBe(-138000);
    expect(Number(second.entry.commission)).toBe(-18000);

    const third = await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 9, gross: 1000, reason: "nothing left" });
    expect(third).toMatchObject({ status: "skipped", reason: "ALREADY_REVERSED" });
    for (const field of ["gross", "commission", "partnerNet", "grossTzs", "commissionTzs", "partnerNetTzs"]) {
      expect(sum(db.rows, field)).toBe(0);
    }
  });

  it("skips, and writes nothing, when the original was never recognized", async () => {
    const result = await reverseRevenue(db, { original: { ...original, sourceId: 999 }, sourceType: "CANCELLATION_REFUND", sourceId: 4, reason: "r" });
    expect(result).toMatchObject({ status: "skipped", reason: "NOT_RECOGNIZED" });
    expect(db.rows).toHaveLength(1);
  });

  it("refuses to reverse a reversal", async () => {
    await reverseRevenue(db, { original, sourceType: "CANCELLATION_REFUND", sourceId: 3, gross: 10, reason: "r" });
    await expect(reverseRevenue(db, { original: { stream: "ACCOMMODATION", sourceType: "CANCELLATION_REFUND", sourceId: 3 }, sourceType: "CHARGEBACK", sourceId: 1, reason: "r" }))
      .rejects.toThrow("REVENUE_REVERSAL_TARGET_NOT_RECOGNIZED");
  });
});

describe("computeReversalAmounts", () => {
  const original = { gross: 100, commission: 33.33, partnerNet: 66.67, grossTzs: 100, commissionTzs: 33.33, partnerNetTzs: 66.67 };

  it("rounds a third without exceeding the remainder", () => {
    const one = computeReversalAmounts(original, original, 33.33)!;
    expect(one.commission).toBe(11.11);
    const remaining = { gross: 0.01, commission: 0, partnerNet: 0.01, grossTzs: 0.01, commissionTzs: 0, partnerNetTzs: 0.01 };
    expect(computeReversalAmounts(original, remaining, 5)).toEqual(remaining);
  });

  it("returns null for a zero request", () => {
    expect(computeReversalAmounts(original, original, 0)).toBeNull();
  });
});
