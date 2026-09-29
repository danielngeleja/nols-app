import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reservationFindMany: vi.fn(),
  accountFindUnique: vi.fn(),
  transaction: vi.fn(),
  alreadyBilled: vi.fn(),
  buildRows: vi.fn(),
  applyRows: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  reservation: { findMany: mocks.reservationFindMany },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/nrmsBilling.js", () => ({
  NRMS_STATEMENT_TRANSACTION_OPTIONS: { maxWait: 10_000, timeout: 30_000 },
  getAlreadyBilledNights: mocks.alreadyBilled,
  buildNrmsUsageRows: mocks.buildRows,
  applyNrmsUsageRows: mocks.applyRows,
}));

import { runNrmsUsageAccrual } from "./nrmsUsageAccrual.js";

const originalBatchSize = process.env.NRMS_WORKER_BATCH_SIZE;
afterAll(() => {
  if (originalBatchSize === undefined) delete process.env.NRMS_WORKER_BATCH_SIZE;
  else process.env.NRMS_WORKER_BATCH_SIZE = originalBatchSize;
});

function reservation(id: number, propertyId: number) {
  return { id, propertyId, source: "DIRECT", bookingId: null, allocations: [{ id: id * 10, startDate: new Date("2026-09-28"), endDate: new Date("2026-09-30") }] };
}

describe("NRMS usage accrual transaction", () => {
  beforeEach(() => {
    process.env.NRMS_WORKER_BATCH_SIZE = "50";
    vi.clearAllMocks();
    mocks.accountFindUnique.mockResolvedValue({ id: 12, policyId: 1, trialEndsAt: new Date("2026-01-01"), policy: { currency: "TZS", roomNightPrice: 10_000 } });
    mocks.alreadyBilled.mockResolvedValue(new Set());
    mocks.buildRows.mockReturnValue([{ amount: 10_000 }]);
    mocks.applyRows.mockResolvedValue({ usageEvents: 1 });
    mocks.transaction.mockImplementation((callback: (tx: unknown) => Promise<unknown>) => callback({ ownerPaygAccount: { findUnique: mocks.accountFindUnique } }));
  });

  it("commits usage and statement work with a bounded timeout", async () => {
    mocks.reservationFindMany.mockResolvedValueOnce([reservation(1, 2)]);

    await expect(runNrmsUsageAccrual(new Date("2026-09-29"))).resolves.toEqual({ properties: 1, usageEvents: 1 });
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { maxWait: 10_000, timeout: 30_000 });
  });

  it("continues other properties but reports a failed property to worker health", async () => {
    mocks.reservationFindMany.mockResolvedValueOnce([reservation(1, 2), reservation(2, 3)]);
    mocks.transaction.mockRejectedValueOnce(new Error("P2028: transaction expired"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(runNrmsUsageAccrual(new Date("2026-09-29"))).rejects.toThrow("NRMS usage accrual failed for 1 property: 2");
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.applyRows).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("does not post later batches for a property whose earlier batch failed", async () => {
    mocks.reservationFindMany
      .mockResolvedValueOnce(Array.from({ length: 50 }, (_, index) => reservation(index + 1, 2)))
      .mockResolvedValueOnce([reservation(51, 2)]);
    mocks.transaction.mockRejectedValueOnce(new Error("P2028: transaction expired"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(runNrmsUsageAccrual(new Date("2026-09-29"))).rejects.toThrow("NRMS usage accrual failed for 1 property: 2");
      expect(mocks.reservationFindMany).toHaveBeenCalledTimes(2);
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });
});
