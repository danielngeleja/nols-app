import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  userDocumentFindMany: vi.fn(),
  sessionUpdateMany: vi.fn(),
  accountFindUnique: vi.fn(),
  transaction: vi.fn(),
  lookup: vi.fn(),
  audit: vi.fn(),
  txAccountFindUnique: vi.fn(),
  txAccountCreate: vi.fn(),
  txAccountUpdate: vi.fn(),
  txAccountUpdateMany: vi.fn(),
  txUserUpdate: vi.fn(),
  sendSms: vi.fn(),
  sendMail: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, update: mocks.userUpdate },
    userDocument: { findMany: mocks.userDocumentFindMany },
    session: { updateMany: mocks.sessionUpdateMany },
    payoutAccount: { findUnique: mocks.accountFindUnique },
    $transaction: mocks.transaction,
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: 44, role: "OWNER", imp: false };
    req.sessionId = "session-current";
    next();
  },
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/redisRateLimitStore.js", () => ({
  rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));

vi.mock("../services/azampay/disbursement/client.js", () => ({ azamPayNameLookup: mocks.lookup }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit }));
vi.mock("../lib/sms.js", () => ({ sendSms: mocks.sendSms }));
vi.mock("../lib/mailer.js", () => ({
  sendMail: mocks.sendMail,
  SECURITY_EMAIL_FROM: "security@nolsaf.com",
}));
vi.mock("../lib/authEmailTemplates.js", () => ({
  getVerificationCodeEmail: (code: string) => ({
    subject: "Verify contact change",
    html: `CONTACT_CODE:${code}`,
  }),
}));
vi.mock("../lib/crypto.js", () => ({
  encrypt: vi.fn((value: string) => `encrypted:${value}`),
  decrypt: vi.fn((value: string) => value.replace(/^encrypted:/, "")),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  hashCode: vi.fn(),
  verifyCode: vi.fn(),
}));

import { router as accountRouter } from "../routes/account";
import { AzamPayDisburseConfigurationError } from "../services/azampay/disbursement/errors";

const tx = {
  payoutAccount: {
    findUnique: mocks.txAccountFindUnique,
    create: mocks.txAccountCreate,
    update: mocks.txAccountUpdate,
    updateMany: mocks.txAccountUpdateMany,
  },
  user: { update: mocks.txUserUpdate },
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/account", accountRouter);
  return instance;
}

describe("secure payout destination update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({ payout: null });
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userUpdate.mockResolvedValue({ id: 44 });
    mocks.userDocumentFindMany.mockResolvedValue([]);
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sendSms.mockResolvedValue({ success: true });
    mocks.sendMail.mockResolvedValue({ success: true });
    mocks.accountFindUnique.mockResolvedValue(null);
    mocks.txAccountFindUnique.mockResolvedValue(null);
    mocks.txAccountUpdateMany.mockResolvedValue({ count: 2 });
    mocks.txUserUpdate.mockResolvedValue({ id: 44 });
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
  });

  it("soft-deletes an account without relying on Prisma delegate metadata", async () => {
    mocks.userFindUnique.mockResolvedValue({ id: 44, name: "Account Owner" });

    const response = await request(app()).delete("/account");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      message: "Account deleted successfully",
    });
    expect(mocks.userUpdate).toHaveBeenCalledWith({
      where: { id: 44 },
      data: {
        deletedAt: expect.any(Date),
        name: "Deleted Driver",
        email: expect.stringMatching(/^deleted_44_\d+@nolsaf\.invalid$/),
        phone: null,
      },
    });
  });

  it("accepts only the supported payout banks and stores their canonical code", async () => {
    mocks.lookup.mockResolvedValue({
      name: "AGREY MBILINYI",
      status: true,
      statusCode: 200,
      accountNumber: "12345678901234",
      bankName: "CRDB",
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "BANK",
      bankName: "CRDB Bank",
      bankAccountName: "AGREY MBILINYI",
      bankAccountNumber: "12345678901234",
      bankBranch: "MLIMANI CITY",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.destination.provider).toBe("CRDB");
    expect(response.body.data.capabilities).toEqual({
      nameLookupVerified: true,
      azamPayDisbursementEnabled: false,
    });
    expect(response.body.message).toContain("bank disbursement remains disabled");
    expect(mocks.lookup).toHaveBeenCalledWith({ bankName: "CRDB", accountNumber: "12345678901234" });
  });

  it("rejects a bank outside CRDB, NBC, and NMB before provider lookup", async () => {
    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "BANK",
      bankName: "OTHER BANK",
      bankAccountName: "AGREY MBILINYI",
      bankAccountNumber: "12345678901234",
      bankBranch: "MLIMANI CITY",
    });

    expect(response.status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it("persists only the verified active method and deactivates older destinations", async () => {
    const now = new Date();
    mocks.lookup.mockResolvedValue({
      name: "ASHA MTUMWA",
      status: true,
      statusCode: 200,
      accountNumber: "255700000001",
      bankName: "azampesa",
    });
    mocks.txAccountCreate.mockResolvedValue({
      id: 9,
      userId: 44,
      type: "MOBILE_MONEY",
      provider: "azampesa",
      accountNumber: "255700000001",
      accountName: "ASHA MTUMWA",
      isVerified: true,
      verifiedAt: now,
      lastVerifiedAt: now,
      destinationChangedAt: now,
    });

    const lookupResponse = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "azampesa",
      mobileMoneyNumber: "255700000001",
    });
    expect(lookupResponse.status).toBe(200);
    expect(lookupResponse.body.data.destination).toEqual({
      type: "MOBILE_MONEY",
      provider: "azampesa",
      accountName: "ASHA MTUMWA",
      accountNumber: "********0001",
      currency: "TZS",
    });
    expect(lookupResponse.body.data.capabilities).toEqual({
      nameLookupVerified: true,
      azamPayDisbursementEnabled: true,
    });

    const response = await request(app()).put("/account/payouts").send({
      challengeToken: lookupResponse.body.data.challengeToken,
    });

    expect(response.status).toBe(200);
    expect(mocks.lookup).toHaveBeenCalledWith({ bankName: "azampesa", accountNumber: "255700000001" });
    expect(mocks.txUserUpdate).toHaveBeenCalledWith({
      where: { id: 44 },
      data: {
        payout: {
          payoutPreferred: "MOBILE_MONEY",
          mobileMoneyProvider: "azampesa",
          mobileMoneyNumber: "encrypted:255700000001",
          mobileMoneyAccountName: "ASHA MTUMWA",
        },
      },
    });
    expect(mocks.txAccountUpdateMany).toHaveBeenCalledWith({
      where: { userId: 44, id: { not: 9 } },
      data: { isDefault: false, isActive: false },
    });
    expect(response.body.data.payoutAccount.accountNumber).toBe("********0001");

    const replay = await request(app()).put("/account/payouts").send({
      challengeToken: lookupResponse.body.data.challengeToken,
    });
    expect(replay.status).toBe(410);
    expect(replay.body.code).toBe("PAYOUT_VERIFICATION_EXPIRED");
  });

  it("normalizes a legacy mobile provider alias before Name Lookup", async () => {
    mocks.lookup.mockResolvedValue({
      name: "ASHA MTUMWA",
      status: true,
      statusCode: 200,
      accountNumber: "255754000001",
      bankName: "Vodacom",
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "M-Pesa",
      mobileMoneyNumber: "255754000001",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.destination.provider).toBe("vodacom");
    expect(response.body.data.capabilities.azamPayDisbursementEnabled).toBe(true);
    expect(mocks.lookup).toHaveBeenCalledWith({ bankName: "vodacom", accountNumber: "255754000001" });
  });

  it("rejects a wallet number that AzamPay resolves to a different mobile provider", async () => {
    mocks.lookup.mockResolvedValue({
      name: "ASHA MTUMWA",
      status: true,
      statusCode: 200,
      accountNumber: "255754000001",
      bankName: "Yas",
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "vodacom",
      mobileMoneyNumber: "255754000001",
    });

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("does not match the selected mobile money provider");
    expect(response.body.data).toBeUndefined();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.anything(),
      "USER_PAYOUT_LOOKUP_MISMATCH",
      "user:44",
      null,
      expect.objectContaining({ mismatch: "PROVIDER", requestedProvider: "vodacom", returnedProvider: "Yas" })
    );
  });

  it("fails closed when AzamPay returns a different destination", async () => {
    mocks.lookup.mockResolvedValue({
      name: "ASHA MTUMWA",
      status: true,
      statusCode: 200,
      accountNumber: "255700009999",
      bankName: "azampesa",
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "azampesa",
      mobileMoneyNumber: "255700000001",
    });

    expect(response.status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.txUserUpdate).not.toHaveBeenCalled();
  });

  it("defines missing AzamPay configuration as a safe non-retryable 503", async () => {
    mocks.lookup.mockRejectedValue(
      new AzamPayDisburseConfigurationError({
        operation: "PUBLIC_KEY",
        missingKeys: ["AZAMPAY_DISBURSE_PUBLIC_KEY"],
        message: "missing payout public key",
      })
    );

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "azampesa",
      mobileMoneyNumber: "255700000001",
    });

    expect(response.status).toBe(503);
    expect(response.body).toEqual({
      code: "PAYOUT_PROVIDER_NOT_CONFIGURED",
      error: "Payout verification is temporarily unavailable. No payout details were changed.",
      retryable: false,
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.txUserUpdate).not.toHaveBeenCalled();
  });

  it("rejects a browser attempt to bypass lookup or supply its own account name", async () => {
    const response = await request(app()).put("/account/payouts").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "azampesa",
      mobileMoneyNumber: "255700000001",
      mobileMoneyAccountName: "FORGED NAME",
    });

    expect(response.status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns existing owner documents in the owner's account profile", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 44,
      role: "OWNER",
      email: "owner@example.com",
      phone: "255700000001",
      name: "Asha Mtumwa",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      passwordHash: null,
      payout: null,
      twoFactorEnabled: false,
      twoFactorMethod: null,
    });
    mocks.userDocumentFindMany.mockResolvedValue([
      {
        id: 71,
        type: "BUSINESS_LICENSE",
        url: "http://localhost:3000/uploads/owner-documents/business-license.pdf",
        status: "APPROVED",
        reason: null,
        metadata: { fileName: "business-license.pdf" },
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
      {
        id: 72,
        type: "TIN_CERTIFICATE",
        url: "http://localhost:3000/uploads/owner-documents/tin.pdf",
        status: "PENDING",
        reason: null,
        metadata: { fileName: "tin.pdf" },
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ]);

    const response = await request(app()).get("/account/me");

    expect(response.status).toBe(200);
    expect(response.body.data.documents).toHaveLength(2);
    expect(response.body.data.documentsUnavailable).toBe(false);
    expect(response.body.data.documents[0]).toMatchObject({
      id: 71,
      type: "BUSINESS_LICENSE",
      status: "APPROVED",
      unsafeUrl: false,
    });
    expect(mocks.userDocumentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 44 },
      orderBy: { id: "desc" },
    }));
  });

  it("authorizes a contact replacement through an existing mature channel before verifying the new one", async () => {
    const existingUser = {
      id: 44,
      email: "owner-old@example.com",
      phone: "+255700000001",
      emailVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
      phoneVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
      emailChangedAt: null,
      phoneChangedAt: null,
      passwordHash: "password-hash",
      twoFactorEnabled: false,
      twoFactorMethod: null,
      totpSecretEnc: null,
    };
    mocks.userFindUnique.mockResolvedValue(existingUser);
    mocks.userUpdate.mockResolvedValue({
      id: 44,
      email: "owner-new@example.com",
      phone: existingUser.phone,
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: existingUser.phoneVerifiedAt,
      emailChangedAt: new Date(),
      phoneChangedAt: null,
    });

    const started = await request(app()).post("/account/contact/request-change").send({
      field: "email",
      value: "owner-new@example.com",
    });
    expect(started.status).toBe(200);
    expect(started.body.data).toMatchObject({ stage: "AUTHORIZE_EXISTING", authorizationField: "phone" });
    expect(mocks.sendSms).toHaveBeenCalledTimes(1);
    const oldChannelCode = String(mocks.sendSms.mock.calls[0][1]).match(/\b(\d{6})\b/)?.[1];
    expect(oldChannelCode).toMatch(/^\d{6}$/);
    expect(mocks.sendMail).not.toHaveBeenCalled();

    const authorized = await request(app()).post("/account/contact/authorize-change").send({
      field: "email",
      otp: oldChannelCode,
    });
    expect(authorized.status).toBe(200);
    expect(authorized.body.data.stage).toBe("VERIFY_NEW");
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(mocks.sendMail.mock.calls[0][0]).toBe("owner-new@example.com");
    const newChannelCode = String(mocks.sendMail.mock.calls[0][2]).match(/\b(\d{6})\b/)?.[1];
    expect(newChannelCode).toMatch(/^\d{6}$/);

    const confirmed = await request(app()).post("/account/contact/confirm-change").send({
      field: "email",
      otp: newChannelCode,
    });
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.securityCooldownUntil).toBeTruthy();
    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 44 },
      data: expect.objectContaining({
        email: "owner-new@example.com",
        emailVerifiedAt: expect.any(Date),
        emailChangedAt: expect.any(Date),
      }),
    }));
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith({
      where: { userId: 44, revokedAt: null, NOT: { id: "session-current" } },
      data: { revokedAt: expect.any(Date) },
    });
    expect(mocks.sendMail).toHaveBeenCalledWith(
      "owner-old@example.com",
      expect.stringContaining("Security alert"),
      expect.any(String),
      undefined,
      expect.any(Object),
    );
  });

  it("locks a contact authorization challenge after five incorrect codes", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 44,
      email: "owner@example.com",
      phone: "+255700000001",
      emailVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
      phoneVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
      emailChangedAt: null,
      phoneChangedAt: null,
      passwordHash: "password-hash",
      twoFactorEnabled: false,
      twoFactorMethod: null,
      totpSecretEnc: null,
    });

    const started = await request(app()).post("/account/contact/request-change").send({
      field: "email",
      value: "attacker@example.com",
    });
    expect(started.status).toBe(200);

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const failed = await request(app()).post("/account/contact/authorize-change").send({ field: "email", otp: "000000" });
      expect(failed.status).toBe(400);
      expect(failed.body.attemptsRemaining).toBe(5 - attempt);
    }
    const locked = await request(app()).post("/account/contact/authorize-change").send({ field: "email", otp: "000000" });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("CONTACT_CHANGE_LOCKED");
  });

  it("blocks payout verification during the contact security cooling period", async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 44,
      emailChangedAt: new Date(),
      phoneChangedAt: null,
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "MOBILE_MONEY",
      mobileMoneyProvider: "azampesa",
      mobileMoneyNumber: "255700000001",
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("PAYOUT_CONTACT_COOLDOWN");
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
