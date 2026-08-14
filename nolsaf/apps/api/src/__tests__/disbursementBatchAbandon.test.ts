import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdateMany: vi.fn(),
  disbursementCount: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    prisma: {
      $transaction: mocks.transaction,
      disbursementBatch: { findUnique: mocks.batchFindUnique },
      disbursement: { count: mocks.disbursementCount },
    },
  };
});

vi.mock("../services/payouts/ledger.js", () => ({
  PayoutStateError: class PayoutStateError extends Error {},
  submitToAzamPay: vi.fn(),
  truncateReason: (value: string) => value.slice(0, 300),
}));
vi.mock("../services/payouts/releaseChallenge.js", () => ({
  twoPersonReleaseRequired: () => false,
}));

import { closeAbandonedBatchIfEmpty } from "../services/payouts/batching";

function frozenBatch(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    status: "SECURITY_REVIEW",
    itemCount: 3,
    totalAmount: new Prisma.Decimal(4150000),
    currency: "TZS",
    ...overrides,
  };
}

const tx = {
  disbursementBatch: { updateMany: mocks.batchUpdateMany },
  auditLog: { create: mocks.auditCreate },
};

describe("closing a frozen batch once its last payout is cleared", () => {
  beforeEach(() => {
    mocks.transaction.mockImplementation(async (fn: any) => fn(tx));
    mocks.batchUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("closes a SECURITY_REVIEW batch that has no members left", async () => {
    mocks.batchFindUnique.mockResolvedValue(frozenBatch());
    mocks.disbursementCount.mockResolvedValue(0);

    await expect(closeAbandonedBatchIfEmpty(41, 7)).resolves.toBe(true);

    expect(mocks.batchUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 41, status: "SECURITY_REVIEW" },
        data: expect.objectContaining({ status: "ABANDONED" }),
      })
    );
    // The freeze itself must stay reconstructible after the row is closed.
    expect(mocks.auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: "DISBURSEMENT_BATCH_ABANDONED", entityId: 41, actorId: 7 }),
      })
    );
  });

  it("leaves a partially cleared batch frozen so the remaining holds stay visible", async () => {
    mocks.batchFindUnique.mockResolvedValue(frozenBatch());
    mocks.disbursementCount.mockResolvedValue(2);

    await expect(closeAbandonedBatchIfEmpty(41, 7)).resolves.toBe(false);
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("never touches a batch that is not frozen", async () => {
    mocks.batchFindUnique.mockResolvedValue(frozenBatch({ status: "PROCESSING" }));
    mocks.disbursementCount.mockResolvedValue(0);

    await expect(closeAbandonedBatchIfEmpty(41, 7)).resolves.toBe(false);
    expect(mocks.disbursementCount).not.toHaveBeenCalled();
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("reports no close when another writer already moved the batch", async () => {
    mocks.batchFindUnique.mockResolvedValue(frozenBatch());
    mocks.disbursementCount.mockResolvedValue(0);
    mocks.batchUpdateMany.mockResolvedValue({ count: 0 });

    await expect(closeAbandonedBatchIfEmpty(41, 7)).resolves.toBe(false);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });

  it("swallows a database failure so bookkeeping can never fail the clear", async () => {
    mocks.batchFindUnique.mockRejectedValue(new Error("connection lost"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(closeAbandonedBatchIfEmpty(41, 7)).resolves.toBe(false);

    consoleError.mockRestore();
  });
});
