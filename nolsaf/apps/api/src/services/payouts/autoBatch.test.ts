import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  tx: {
    disbursementBatch: { findUnique: vi.fn(), aggregate: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    systemSetting: { findUnique: vi.fn() },
    disbursement: { updateMany: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: { $transaction: (fn: any) => fn(m.tx), ...m.tx },
}));
vi.mock("../azampay/disbursement/client.js", () => ({ azamPayNameLookup: vi.fn() }));
vi.mock("./releaseChallenge.js", () => ({ twoPersonReleaseRequired: () => false }));

import { authorizeAutoBatch, authorizeBatch } from "./batching.js";
import { computeBatchFingerprint, toBatchFingerprintMember } from "./fingerprint.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const ACCOUNT = { provider: "Vodacom", accountNumber: "255754123456", accountName: "DANIEL OWNER" };

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    externalReferenceId: "OWN-AAA",
    amount: new Prisma.Decimal(180000),
    currency: "TZS",
    status: "BATCHED",
    releaseLane: "AUTO",
    approvedById: null,
    payoutAccount: ACCOUNT,
    ...overrides,
  };
}

function batch(items = [item()], overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    mode: "AUTO",
    status: "DRAFT",
    formedById: null,
    currency: "TZS",
    itemCount: items.length,
    totalAmount: items.reduce((s, i: any) => s.plus(i.amount), new Prisma.Decimal(0)),
    batchFingerprint: computeBatchFingerprint(items.map((i: any) => toBatchFingerprintMember(i, i.payoutAccount))),
    items,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.tx.disbursementBatch.findUnique.mockResolvedValue(batch());
  m.tx.systemSetting.findUnique.mockResolvedValue({ autoPayoutEnabled: true, autoPayoutDailyCapTzs: 2_000_000 });
  m.tx.disbursementBatch.aggregate.mockResolvedValue({ _sum: { totalAmount: new Prisma.Decimal(0) } });
  m.tx.disbursementBatch.updateMany.mockResolvedValue({ count: 1 });
  m.tx.disbursement.updateMany.mockResolvedValue({ count: 1 });
  m.tx.auditLog.create.mockResolvedValue({});
});

describe("authorizeAutoBatch", () => {
  it("authorizes a clean automatic batch inside the daily cap, as the system", async () => {
    await expect(authorizeAutoBatch(5, NOW)).resolves.toEqual({ kind: "authorized" });
    expect(m.tx.disbursementBatch.updateMany).toHaveBeenCalledWith({
      where: { id: 5, status: "DRAFT" },
      data: { status: "AUTHORIZED", authorizedById: null, authorizedAt: NOW },
    });
    expect(m.tx.auditLog.create.mock.calls[0][0].data).toMatchObject({ actorId: null, actorRole: "SYSTEM" });
  });

  it("leaves the batch waiting while the kill switch is off", async () => {
    m.tx.systemSetting.findUnique.mockResolvedValue({ autoPayoutEnabled: false, autoPayoutDailyCapTzs: 2_000_000 });
    await expect(authorizeAutoBatch(5, NOW)).resolves.toMatchObject({ kind: "skipped" });
    expect(m.tx.disbursementBatch.updateMany).not.toHaveBeenCalled();
  });

  it("leaves the batch waiting when it would pass today's cap", async () => {
    m.tx.disbursementBatch.aggregate.mockResolvedValue({ _sum: { totalAmount: new Prisma.Decimal(1_900_000) } });
    const result = await authorizeAutoBatch(5, NOW);
    expect(result).toMatchObject({ kind: "skipped" });
    expect((result as any).reason).toContain("daily cap");
    expect(m.tx.disbursementBatch.updateMany).not.toHaveBeenCalled();
  });

  it("freezes the batch when a member was approved by an admin", async () => {
    m.tx.disbursementBatch.findUnique.mockResolvedValue(batch([item({ approvedById: 12 })]));
    await expect(authorizeAutoBatch(5, NOW)).rejects.toThrow(/SECURITY_REVIEW/);
    expect(m.tx.disbursementBatch.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { status: "SECURITY_REVIEW" } });
  });

  it("freezes the batch when a destination changed after formation", async () => {
    const formed = batch();
    formed.items = [item({ payoutAccount: { ...ACCOUNT, accountNumber: "255754999999" } })];
    m.tx.disbursementBatch.findUnique.mockResolvedValue(formed);
    await expect(authorizeAutoBatch(5, NOW)).rejects.toThrow(/fingerprint/);
  });

  it("refuses a human batch", async () => {
    m.tx.disbursementBatch.findUnique.mockResolvedValue(batch(undefined, { mode: "MANUAL" }));
    await expect(authorizeAutoBatch(5, NOW)).rejects.toThrow(/not an automatic batch/);
  });
});

describe("authorizeBatch (human release)", () => {
  it("refuses an automatic batch", async () => {
    await expect(authorizeBatch(5, 12, { releaseChallengePassed: true })).rejects.toThrow(/automatic payout lane/);
  });
});
