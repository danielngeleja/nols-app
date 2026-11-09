import { describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("./financeOverview.js", () => ({ computeFinanceOverview: vi.fn() }));
vi.mock("./fx.js", () => ({ BASE_CURRENCY: "TZS", getFxRates: vi.fn() }));

import { classifySources, eatInstants, parseDayRange, type LedgerSourceFigure, type SourceFigure } from "./revenueReconciliation.js";

const inv = (id: number, commission: number): SourceFigure => ({ stream: "ACCOMMODATION", sourceType: "INVOICE", sourceId: id, label: `INV-${id}`, commissionTzs: commission, grossTzs: commission * 10 });
const led = (id: number, commission: number, reversed = false): LedgerSourceFigure => ({ stream: "ACCOMMODATION", sourceType: "INVOICE", sourceId: id, commissionTzs: commission, reversed });

describe("parseDayRange", () => {
  it("accepts an inclusive range of days or nothing for all time", () => {
    expect(parseDayRange(undefined, undefined)).toBeNull();
    expect(parseDayRange("2026-11-01", "2026-11-30")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
  });

  it("rejects half ranges, reversed ranges and instants", () => {
    expect(parseDayRange("2026-11-01", undefined)).toBe("invalid");
    expect(parseDayRange("2026-11-30", "2026-11-01")).toBe("invalid");
    expect(parseDayRange("2026-11-01T00:00:00Z", "2026-11-02")).toBe("invalid");
  });
});

describe("eatInstants", () => {
  it("bounds EAT days, so a 23:30 EAT payment on the last day is inside", () => {
    const span = eatInstants({ from: "2026-11-01", to: "2026-11-30" });
    expect(span.from.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(span.to.toISOString()).toBe("2026-11-30T20:59:59.999Z");
  });
});

describe("classifySources", () => {
  it("reports nothing when both sides agree within rounding", () => {
    expect(classifySources([inv(1, 30000)], [led(1, 30000.3)], new Set())).toEqual([]);
  });

  it("tells a source the ledger never saw from one it dated on another day", () => {
    const findings = classifySources([inv(1, 30000), inv(2, 5000)], [], new Set(["ACCOMMODATION:INVOICE:2"]));
    expect(findings.map((f) => [f.label, f.kind, f.difference])).toEqual([
      ["INV-1", "MISSING", -30000],
      ["INV-2", "OTHER_PERIOD", -5000],
    ]);
  });

  it("nets a refund against its source and flags it, largest difference first", () => {
    const findings = classifySources([inv(1, 30000), inv(3, 1000)], [led(1, 30000), led(1, -12000, true), led(3, 900)], new Set());
    expect(findings).toEqual([
      expect.objectContaining({ label: "INV-1", kind: "AMOUNT", ledger: 18000, overview: 30000, difference: -12000, reversed: true }),
      expect.objectContaining({ label: "INV-3", kind: "AMOUNT", difference: -100, reversed: false }),
    ]);
  });

  it("lists what only the ledger counts, with a readable label, and drops fully reversed ones", () => {
    const labels = new Map([["ACCOMMODATION:INVOICE:9", "INV-9"]]);
    const findings = classifySources([], [led(9, 4000), led(10, 4000), led(10, -4000, true)], new Set(), labels);
    expect(findings).toEqual([expect.objectContaining({ label: "INV-9", kind: "LEDGER_ONLY", ledger: 4000, overview: 0, difference: 4000 })]);
  });
});
