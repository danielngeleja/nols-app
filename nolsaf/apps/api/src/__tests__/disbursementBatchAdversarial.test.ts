import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { computeBatchFingerprint } from "../services/payouts/fingerprint";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdate: vi.fn(),
  batchUpdateMany: vi.fn(),
  disbursementUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", async (importOriginal) => {
  const original = await importOriginal<any>();
  return {
    ...original,
    prisma: {
      $transaction: mocks.transaction,
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

import { authorizeBatch, BatchStateError } from "../services/payouts/batching";

function buildBatch(overrides: Record<string, unknown> = {}) {
  const payoutAccount = {
    id: 9,
    provider: "airtel",
    accountNumber: "255688000001",
    accountName: "ASHA MTUMWA",
  };
  const item: any = {
    id: 77,
    externalReferenceId: "NoLSAF-D-2608081645-D51QVX",
    amount: new Prisma.Decimal(150000),
    currency: "TZS",
    provider: "azampay",
    status: "BATCHED",
    approvedById: 4,
    payoutAccount,
  };
  const fingerprint = computeBatchFingerprint([
    {
      externalReferenceId: item.externalReferenceId,
      amount: item.amount.toString(),
      currency: item.currency,
      provider: payoutAccount.provider,
      accountNumber: payoutAccount.accountNumber,
      accountName: payoutAccount.accountName,
    },
  ]);
  return {
    id: 5,
    batchReference: "BATCH-2608081645-D51QV",
    status: "DRAFT",
    totalAmount: new Prisma.Decimal(150000),
    currency: "TZS",
    itemCount: 1,
    batchFingerprint: fingerprint,
    formedById: 3,
    authorizedById: null,
    authorizedAt: null,
    processingStartedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [item],
    ...overrides,
  } as any;
}

function transactionClient() {
  return {
    disbursementBatch: {
      findUnique: mocks.batchFindUnique,
      update: mocks.batchUpdate,
      updateMany: mocks.batchUpdateMany,
    },
    disbursement: { updateMany: mocks.disbursementUpdateMany },
    auditLog: { create: mocks.auditCreate },
  };
}

describe("disbursement batch authorization attack resistance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("DISBURSEMENT_REQUIRE_TWO_PERSON", "false");
    mocks.auditCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async (callback: any) => callback(transactionClient()));
  });

  afterEach(() => vi.unstubAllEnvs());

  it("commits SECURITY_REVIEW before reporting a tampered displayed total", async () => {
    const batch = buildBatch({ totalAmount: new Prisma.Decimal(1) });
    let transactionCommitted = false;
    mocks.batchFindUnique.mockResolvedValue(batch);
    mocks.batchUpdate.mockResolvedValue({ ...batch, status: "SECURITY_REVIEW" });
    mocks.disbursementUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (callback: any) => {
      const value = await callback(transactionClient());
      transactionCommitted = true;
      return value;
    });

    await expect(authorizeBatch(batch.id, 9)).rejects.toBeInstanceOf(BatchStateError);

    expect(transactionCommitted).toBe(true);
    expect(mocks.batchUpdate).toHaveBeenCalledWith({
      where: { id: batch.id },
      data: { status: "SECURITY_REVIEW" },
    });
    expect(mocks.disbursementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "SECURITY_REVIEW",
          securityReviewReason: expect.stringContaining("batch total changed"),
        }),
      })
    );
    expect(mocks.batchUpdateMany).not.toHaveBeenCalled();
  });

  it("freezes a batch when an attacker changes a member state without changing financial fields", async () => {
    const normal = buildBatch();
    const batch = buildBatch({ items: [{ ...normal.items[0], status: "AUTHORIZED" }] });
    mocks.batchFindUnique.mockResolvedValue(batch);
    mocks.batchUpdate.mockResolvedValue({ ...batch, status: "SECURITY_REVIEW" });
    mocks.disbursementUpdateMany.mockResolvedValue({ count: 1 });

    await expect(authorizeBatch(batch.id, 9)).rejects.toThrow("SECURITY_REVIEW");

    expect(mocks.disbursementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ securityReviewReason: expect.stringContaining("member state changed") }),
      })
    );
  });

  it("fails closed when deleted admin records erase formation provenance", async () => {
    const batch = buildBatch({ formedById: null });
    mocks.batchFindUnique.mockResolvedValue(batch);
    mocks.batchUpdate.mockResolvedValue({ ...batch, status: "SECURITY_REVIEW" });
    mocks.disbursementUpdateMany.mockResolvedValue({ count: 1 });

    await expect(authorizeBatch(batch.id, 9)).rejects.toThrow("SECURITY_REVIEW");

    expect(mocks.disbursementUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ securityReviewReason: expect.stringContaining("provenance is missing") }),
      })
    );
  });

  it("allows only one winner when two admins authorize the same DRAFT batch concurrently", async () => {
    const batch = buildBatch();
    let batchStatus = "DRAFT";
    let initialReads = 0;
    mocks.batchFindUnique.mockImplementation(async () => {
      initialReads += 1;
      if (initialReads <= 2) return { ...batch, status: "DRAFT" };
      return { ...batch, status: batchStatus, authorizedById: 9 };
    });
    mocks.batchUpdateMany.mockImplementation(async ({ where }: any) => {
      if (where.status !== "DRAFT" || batchStatus !== "DRAFT") return { count: 0 };
      batchStatus = "AUTHORIZED";
      return { count: 1 };
    });
    mocks.disbursementUpdateMany.mockResolvedValue({ count: 1 });

    const results = await Promise.allSettled([
      authorizeBatch(batch.id, 9),
      authorizeBatch(batch.id, 10),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(batchStatus).toBe("AUTHORIZED");
    expect(mocks.disbursementUpdateMany).toHaveBeenCalledOnce();
  });
});
