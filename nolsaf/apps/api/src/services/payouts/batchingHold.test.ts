import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  findMany: vi.fn(),
  held: vi.fn(),
  lookup: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    disbursement: { findMany: m.findMany },
    systemSetting: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn(),
  },
}));
vi.mock("../azampay/disbursement/client.js", () => ({ azamPayNameLookup: m.lookup }));
vi.mock("./releaseChallenge.js", () => ({ twoPersonReleaseRequired: () => false }));
vi.mock("./ownerPayoutControl.js", () => ({ heldOwnerIds: m.held }));

import { formAutoBatch } from "./batching.js";

beforeEach(() => {
  vi.clearAllMocks();
  m.findMany.mockResolvedValue([{
    id: 900, amount: new Prisma.Decimal(500_000), currency: "TZS", status: "APPROVED", releaseLane: "AUTO",
    approvalFingerprint: "fp", payoutAccount: { id: 7, userId: 44, provider: "Vodacom", accountNumber: "255700000001", accountName: "ASHA MTUMWA" },
  }]);
});

describe("a paused owner's approved payout", () => {
  it("stays out of the batch, untouched, without a provider lookup", async () => {
    m.held.mockResolvedValue(new Set([44]));
    const result = await formAutoBatch(5_000_000);
    expect(m.held).toHaveBeenCalledWith([44]);
    expect(result.deferred).toEqual([900]);
    expect(result.included).toEqual([]);
    expect(result.excluded).toEqual([]);
    expect(m.lookup).not.toHaveBeenCalled();
  });
});
