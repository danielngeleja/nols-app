import { describe, expect, it, vi } from "vitest";
const h = vi.hoisted(() => ({
  db: {
    invoice: { findMany: vi.fn(async () => []) },
    tourBooking: { findMany: vi.fn(async () => []) },
    transportPayout: { findMany: vi.fn(async () => []) },
    groupBooking: { findMany: vi.fn(async () => [{ id: 1, totalAmount: 900000, ownerAmount: 0 }]) },
    nrmsServicePayment: { findMany: vi.fn(async () => []) },
    tenancy: { findMany: vi.fn(async () => []) },
    eventHireBooking: { findMany: vi.fn(async () => [{ id: 7, reference: "ebk_test", fee: 3000, total: 80000, deposit: 10000 }]) },
    revenueEntry: { findMany: vi.fn(async () => []) }
  }
}));
vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("./financeOverview.js", () => ({ computeFinanceOverview: async () => ({ streams: [{ key: "eventHire", nolsafRevenue: 3000, gmv: 70000, partnerNet: 67000, realizedCount: 1 }] }) }));
vi.mock("./fx.js", () => ({ BASE_CURRENCY: "TZS", getFxRates: async () => ({ tzsPerUnit: { TZS: 1 } }) }));
vi.mock("./invoiceMoneyStageIndex.js", () => ({ GUEST_MONEY_IN: new Set(), loadOwnerInvoiceDisbursements: async () => new Map() }));
import { computeRevenueReconciliation } from "./revenueReconciliation.js";

describe("event-only revenue reconciliation", () => {
  it("filters before limiting findings so larger unrelated streams cannot hide an event mismatch", async () => {
    const report = await computeRevenueReconciliation(null, { stream: "EVENT_HIRE", limit: 1 });
    expect(report.streams).toHaveLength(1);
    expect(report.streams[0].stream).toBe("EVENT_HIRE");
    expect(report.findings).toEqual([expect.objectContaining({ stream: "EVENT_HIRE", label: "ebk_test", kind: "MISSING" })]);
    expect(report.findingsTotal).toBe(1);
    expect(report.totals).toEqual({ ledger: 0, overview: 3000, difference: -3000 });
    expect(report.streams[0].overview.gmv).toBe(70000);
  });
  it("preserves the shared all-stream report for existing finance users", async () => {
    const report = await computeRevenueReconciliation(null, { limit: 1 });
    expect(report.streams.length).toBeGreaterThan(1);
    expect(report.findingsTotal).toBe(2);
    expect(report.findings[0].stream).toBe("GROUP_STAY");
  });
});
