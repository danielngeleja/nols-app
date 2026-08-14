import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadEligiblePayoutSource: vi.fn(),
  nameLookup: vi.fn(),
  findUser: vi.fn(),
  findAccount: vi.fn(),
  updateAccount: vi.fn(),
  createAccount: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.findUser },
    payoutAccount: {
      findFirst: mocks.findAccount,
      update: mocks.updateAccount,
      create: mocks.createAccount,
    },
  },
}));

vi.mock("../services/payouts/eligibility.js", () => ({
  loadEligiblePayoutSource: mocks.loadEligiblePayoutSource,
}));

vi.mock("../services/azampay/disbursement/client.js", () => ({
  azamPayNameLookup: mocks.nameLookup,
}));

vi.mock("../lib/crypto.js", () => ({ decrypt: vi.fn((value: string) => value) }));

import { provisionPayoutAccountFromProfile } from "../services/payouts/provisioning";

describe("payout account provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadEligiblePayoutSource.mockResolvedValue({ payeeUserId: 44 });
    mocks.findUser.mockResolvedValue({
      name: "Asha",
      payout: { payoutPreferred: "MOBILE_MONEY", mobileMoneyProvider: "azampesa", mobileMoneyNumber: "255700000001" },
    });
  });

  it("retries AzamPay Name Lookup for an existing unverified destination", async () => {
    const existing = {
      id: 9,
      userId: 44,
      type: "MOBILE_MONEY",
      provider: "azampesa",
      accountNumber: "255700000001",
      accountName: "Asha",
      isVerified: false,
      verifiedAt: null,
    };
    const verified = { ...existing, accountName: "ASHA MTUMWA", isVerified: true, verifiedAt: new Date() };
    mocks.findAccount.mockResolvedValue(existing);
    mocks.nameLookup.mockResolvedValue({
      name: "ASHA MTUMWA",
      status: true,
      statusCode: 200,
      accountNumber: existing.accountNumber,
      bankName: existing.provider,
    });
    mocks.updateAccount.mockResolvedValue(verified);

    const result = await provisionPayoutAccountFromProfile("OWNER_INVOICE", 123);

    expect(mocks.nameLookup).toHaveBeenCalledWith({ bankName: "azampesa", accountNumber: "255700000001" });
    expect(mocks.updateAccount).toHaveBeenCalledWith({
      where: { id: existing.id },
      data: {
        accountName: "ASHA MTUMWA",
        isVerified: true,
        verifiedAt: expect.any(Date),
        lastVerifiedAt: expect.any(Date),
      },
    });
    expect(result).toMatchObject({ reused: true, verificationWarning: null, account: { id: 9, isVerified: true, accountName: "ASHA MTUMWA" } });
  });
});
