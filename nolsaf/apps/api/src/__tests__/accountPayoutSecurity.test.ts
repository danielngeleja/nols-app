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
  accountCount: vi.fn(),
  transaction: vi.fn(),
  lookup: vi.fn(),
  banks: vi.fn(),
  audit: vi.fn(),
  auditOrThrow: vi.fn(),
  txAccountFindUnique: vi.fn(),
  txAccountFindFirst: vi.fn(),
  txAccountCreate: vi.fn(),
  txAccountUpdate: vi.fn(),
  txAccountUpdateMany: vi.fn(),
  txUserUpdate: vi.fn(),
  txSalesProfileUpdateMany: vi.fn(),
  sendSms: vi.fn(),
  sendMail: vi.fn(),
  systemSettingFindUnique: vi.fn(),
  notificationCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, update: mocks.userUpdate },
    userDocument: { findMany: mocks.userDocumentFindMany },
    session: { updateMany: mocks.sessionUpdateMany },
    payoutAccount: { findUnique: mocks.accountFindUnique, count: mocks.accountCount },
    systemSetting: { findUnique: mocks.systemSettingFindUnique },
    notification: { create: mocks.notificationCreate },
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
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../lib/redisRateLimitStore.js", () => ({
  rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));

vi.mock("../services/azampay/disbursement/client.js", () => ({ azamPayNameLookup: mocks.lookup, azamPayBankNames: mocks.banks }));
vi.mock("../lib/audit.js", () => ({ audit: mocks.audit, auditOrThrow: mocks.auditOrThrow }));
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
import { router as ownerPayoutsRouter } from "../routes/owner.payouts";
import { AzamPayDisburseAuthError, AzamPayDisburseConfigurationError, AzamPayDisburseError } from "../services/azampay/disbursement/errors";

const tx = {
  payoutAccount: {
    findUnique: mocks.txAccountFindUnique,
    findFirst: mocks.txAccountFindFirst,
    create: mocks.txAccountCreate,
    update: mocks.txAccountUpdate,
    updateMany: mocks.txAccountUpdateMany,
  },
  user: { update: mocks.txUserUpdate },
  salesPartnerProfile: { updateMany: mocks.txSalesProfileUpdateMany },
};

function app(requestId?: string) {
  const instance = express();
  instance.use(express.json());
  if (requestId) instance.use((req: any, _res, next) => { req.requestId = requestId; next(); });
  instance.use("/account", accountRouter);
  return instance;
}

function ownerApp() {
  const instance = express();
  instance.use(express.json());
  instance.use("/owner/payouts", ownerPayoutsRouter);
  return instance;
}

describe("secure payout destination update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.banks.mockResolvedValue(["Example Commercial Bank", "CRDB"]);
    mocks.userFindUnique.mockResolvedValue({ payout: null });
    mocks.userFindFirst.mockResolvedValue(null);
    mocks.userUpdate.mockResolvedValue({ id: 44 });
    mocks.userDocumentFindMany.mockResolvedValue([]);
    mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.sendSms.mockResolvedValue({ success: true });
    mocks.sendMail.mockResolvedValue({ success: true });
    mocks.accountFindUnique.mockResolvedValue(null);
    mocks.txAccountFindUnique.mockResolvedValue(null);
    mocks.txAccountFindFirst.mockResolvedValue(null);
    mocks.systemSettingFindUnique.mockResolvedValue({ payoutReviewThresholdTzs: null, payoutDailyCapPerPayeeTzs: null, payoutRecentChangeHours: 72 });
    mocks.txAccountUpdateMany.mockResolvedValue({ count: 2 });
    mocks.txUserUpdate.mockResolvedValue({ id: 44 });
    mocks.transaction.mockImplementation(async (callback: any) => callback(tx));
    mocks.auditOrThrow.mockResolvedValue(undefined);
  });

  it("refuses the legacy owner account write path before it can bypass confirmation", async () => {
    const response = await request(ownerApp()).post("/owner/payouts/accounts").send({
      type: "MOBILE_MONEY", provider: "azampesa", accountNumber: "255700000001",
    });

    expect(response.status).toBe(410);
    expect(response.body.code).toBe("PAYOUT_VERIFICATION_REQUIRED");
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
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

  it("logs the directory failure stage and provider status without exposing the error text", async () => {
    mocks.banks.mockRejectedValueOnce(new AzamPayDisburseAuthError("internal auth details", 423));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const result = await request(app("directory-request")).get("/account/payouts/banks");
      expect(result.status).toBe(503);
      expect(result.body).toEqual({ error: "The payout bank directory is temporarily unavailable." });
      expect(log).toHaveBeenCalledWith(JSON.stringify({
        level: "error",
        event: "payout_bank_directory_failed",
        requestId: "directory-request",
        stage: "authentication",
        upstreamStatus: 423,
      }));
    } finally {
      log.mockRestore();
    }
  });

  it("accepts only the supported payout banks and stores their canonical code", async () => {
    mocks.lookup.mockResolvedValue({
      name: "AGREY MBILINYI",
      status: true,
      statusCode: 200,
      accountNumber: "12345678901234",
      bankName: "Example Commercial Bank",
    });

    const response = await request(app()).post("/account/payouts/verify").send({
      payoutPreferred: "BANK",
      bankName: "Example Commercial Bank",
      bankAccountName: "AGREY MBILINYI",
      bankAccountNumber: "12345678901234",
      bankBranch: "MLIMANI CITY",
    });

    expect(response.status).toBe(200);
    expect(response.body.data.destination.provider).toBe("Example Commercial Bank");
    expect(response.body.data.capabilities).toEqual({
      nameLookupVerified: true,
      azamPayDisbursementEnabled: true,
    });
    expect(mocks.lookup).toHaveBeenCalledWith({ bankName: "Example Commercial Bank", accountNumber: "12345678901234" });
  });

  it("rejects a bank missing from the provider directory before provider lookup", async () => {
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
    mocks.userFindUnique.mockResolvedValue({ payout: null, email: "owner@example.com", phone: "255700000009" });
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
    expect(mocks.sendMail.mock.calls[0][1]).toBe("Security alert: payout account added");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("AzamPesa ending in 0001");
    // A first account is onboarding: no waiting period is promised, the first payout is reviewed instead.
    expect(mocks.sendMail.mock.calls[0][2]).not.toContain("security waiting period applies");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("Your first payout is checked by our team");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("did not approve or send a payout");
    expect(mocks.sendMail.mock.calls[0][2]).not.toContain("255700000001");
    expect(mocks.sendSms.mock.calls[0][1]).toContain("payout account added");
    expect(mocks.sendSms.mock.calls[0][1]).not.toContain("255700000001");
    // A sales partner's withdrawal profile follows the same verified destination.
    expect(mocks.txSalesProfileUpdateMany).toHaveBeenCalledWith({
      where: { userId: 44 },
      data: { payoutName: "ASHA MTUMWA", payoutMethod: "AzamPesa", payoutAccount: "255700000001" },
    });

    const replay = await request(app()).put("/account/payouts").send({
      challengeToken: lookupResponse.body.data.challengeToken,
    });
    expect(replay.status).toBe(410);
    expect(replay.body.code).toBe("PAYOUT_VERIFICATION_EXPIRED");
  });

  it("alerts a replacement as changed and uses the configured waiting period", async () => {
    const now = new Date();
    mocks.userFindUnique.mockResolvedValue({ payout: { mobileMoneyNumber: "encrypted:255700000002" }, email: "owner@example.com", phone: "255700000009" });
    mocks.txAccountFindFirst.mockResolvedValue({ provider: "airtel", accountNumber: "255700000002" });
    mocks.systemSettingFindUnique.mockResolvedValue({ payoutReviewThresholdTzs: null, payoutDailyCapPerPayeeTzs: null, payoutRecentChangeHours: 96 });
    mocks.lookup.mockResolvedValue({ name: "ASHA MTUMWA", status: true, statusCode: 200, accountNumber: "255700000001", bankName: "azampesa" });
    mocks.txAccountCreate.mockResolvedValue({ id: 10, userId: 44, type: "MOBILE_MONEY", provider: "azampesa", accountNumber: "255700000001", accountName: "ASHA MTUMWA", isVerified: true, verifiedAt: now, lastVerifiedAt: now, destinationChangedAt: now });

    const lookup = await request(app()).post("/account/payouts/verify").send({ payoutPreferred: "MOBILE_MONEY", mobileMoneyProvider: "azampesa", mobileMoneyNumber: "255700000001" });
    const response = await request(app()).put("/account/payouts").send({ challengeToken: lookup.body.data.challengeToken });

    expect(response.status).toBe(200);
    expect(mocks.auditOrThrow).toHaveBeenCalledWith(tx, expect.anything(), "USER_PAYOUT_DESTINATION_VERIFIED", "user:44", null,
      expect.objectContaining({ change: "changed", accountNumber: expect.stringMatching(/^\*+0001$/), previousAccountNumber: expect.stringMatching(/^\*+0002$/) }), 44);
    expect(JSON.stringify(mocks.auditOrThrow.mock.calls[0][5])).not.toContain("ASHA MTUMWA");
    expect(mocks.sendMail.mock.calls[0][1]).toBe("Security alert: payout account changed");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("96-hour security waiting period");
    expect(mocks.sendMail.mock.calls[0][2]).not.toContain("255700000001");
    expect(mocks.sendSms.mock.calls[0][1]).toContain("payout account changed");
    expect(mocks.notificationCreate).toHaveBeenCalledExactlyOnceWith({ data: expect.objectContaining({
      userId: null,
      ownerId: null,
      title: "Changed the payout destination",
      unread: true,
      requiresAction: false,
      meta: {
        accountOwnerId: 44,
        change: "payoutChanged",
        changeTitle: "Changed the payout destination",
        href: "/admin/owners/44?tab=activity&category=payout",
        notificationKind: "owner_account_payout",
        severity: "info",
        category: "money",
      },
    }) });
  });

  it("rejects an owner payout confirmation when its transaction cannot write the audit event", async () => {
    mocks.lookup.mockResolvedValue({ name: "ASHA MTUMWA", status: true, statusCode: 200, accountNumber: "255700000001", bankName: "azampesa" });
    mocks.txAccountCreate.mockResolvedValue({ id: 10, type: "MOBILE_MONEY", provider: "azampesa", accountNumber: "255700000001" });
    mocks.auditOrThrow.mockRejectedValueOnce(new Error("Audit unavailable"));

    const lookup = await request(app()).post("/account/payouts/verify").send({ payoutPreferred: "MOBILE_MONEY", mobileMoneyProvider: "azampesa", mobileMoneyNumber: "255700000001" });
    await request(app()).put("/account/payouts").send({ challengeToken: lookup.body.data.challengeToken }).expect(500);
    expect(mocks.auditOrThrow).toHaveBeenCalledWith(tx, expect.anything(), "USER_PAYOUT_DESTINATION_VERIFIED", "user:44", null, expect.anything(), 44);
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(mocks.sendSms).not.toHaveBeenCalled();
    expect(mocks.notificationCreate).not.toHaveBeenCalled();
  });

  it("alerts a repeated confirmation as reverified rather than changed", async () => {
    const now = new Date();
    mocks.userFindUnique.mockResolvedValue({ payout: { mobileMoneyNumber: "encrypted:255700000001" }, email: "owner@example.com", phone: null });
    mocks.txAccountFindFirst.mockResolvedValue({ provider: "azampesa", accountNumber: "255700000001" });
    const originallyChangedAt = new Date("2026-10-01T08:00:00.000Z");
    mocks.txAccountFindUnique.mockResolvedValue({ id: 9, verifiedAt: now, destinationChangedAt: originallyChangedAt, createdAt: originallyChangedAt });
    mocks.txAccountUpdate.mockResolvedValue({ id: 9, userId: 44, type: "MOBILE_MONEY", provider: "azampesa", accountNumber: "255700000001", accountName: "ASHA MTUMWA", isVerified: true, verifiedAt: now, lastVerifiedAt: now, destinationChangedAt: now });
    mocks.lookup.mockResolvedValue({ name: "ASHA MTUMWA", status: true, statusCode: 200, accountNumber: "255700000001", bankName: "azampesa" });

    const lookup = await request(app()).post("/account/payouts/verify").send({ payoutPreferred: "MOBILE_MONEY", mobileMoneyProvider: "azampesa", mobileMoneyNumber: "255700000001" });
    const response = await request(app()).put("/account/payouts").send({ challengeToken: lookup.body.data.challengeToken });
    expect(mocks.notificationCreate).not.toHaveBeenCalled();

    expect(response.status).toBe(200);
    expect(mocks.sendMail.mock.calls[0][1]).toBe("Security alert: payout account reverified");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("did not start a new security waiting period");
    // Re-verifying the same wallet keeps its change time; it is not a new change.
    expect(mocks.txAccountUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ destinationChangedAt: originallyChangedAt }),
    }));
  });

  it("does not promise automatic payout when a bank account is first saved", async () => {
    const now = new Date();
    mocks.userFindUnique.mockResolvedValue({ payout: null, email: "owner@example.com", phone: "255700000009" });
    mocks.lookup.mockResolvedValue({ name: "ASHA MTUMWA", status: true, statusCode: 200, accountNumber: "12345678901234", bankName: "CRDB" });
    mocks.txAccountCreate.mockResolvedValue({ id: 11, userId: 44, type: "BANK", provider: "CRDB", accountNumber: "12345678901234", accountName: "ASHA MTUMWA", isVerified: true, verifiedAt: now, lastVerifiedAt: now, destinationChangedAt: now });

    const lookup = await request(app()).post("/account/payouts/verify").send({ payoutPreferred: "BANK", bankName: "CRDB", bankAccountName: "ASHA MTUMWA", bankAccountNumber: "12345678901234", bankBranch: "MLIMANI CITY" });
    const response = await request(app()).put("/account/payouts").send({ challengeToken: lookup.body.data.challengeToken });

    expect(response.status).toBe(200);
    expect(mocks.sendMail.mock.calls[0][1]).toBe("Security alert: payout account added");
    expect(mocks.sendMail.mock.calls[0][2]).toContain("Saving this account did not approve or send a payout");
    expect(mocks.sendMail.mock.calls[0][2]).not.toContain("hour security waiting period");
    expect(mocks.sendSms.mock.calls[0][1]).toContain("No security hold started");
    expect(mocks.sendSms.mock.calls[0][1]).not.toContain("12345678901234");
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

  it("logs only safe provider metadata for a failed payout name lookup", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.lookup.mockRejectedValue(new AzamPayDisburseError({
      httpStatus: 400,
      providerMessage: "Invalid account 255700000001 for ASHA MTUMWA",
      retryClass: "VALIDATION",
      rawBody: { statusCode: 400, token: "secret-token", accountNumber: "255700000001" },
    }));

    try {
      const response = await request(app("lookup-request-123")).post("/account/payouts/verify").send({
        payoutPreferred: "MOBILE_MONEY",
        mobileMoneyProvider: "azampesa",
        mobileMoneyNumber: "255700000001",
      });

      expect(response.status).toBe(502);
      const logLine = String(consoleError.mock.calls[0]?.[0] || "");
      expect(JSON.parse(logLine)).toEqual({
        level: "error",
        event: "payout_name_lookup_provider_error",
        requestId: "lookup-request-123",
        upstreamStatus: 400,
        providerStatusCode: 400,
        retryClass: "VALIDATION",
        reasonCategory: "ACCOUNT",
      });
      expect(logLine).not.toContain("255700000001");
      expect(logLine).not.toContain("ASHA MTUMWA");
      expect(logLine).not.toContain("secret-token");
    } finally {
      consoleError.mockRestore();
    }
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

  async function addFirstEmail() {
    const started = await request(app()).post("/account/contact/request-change").send({ field: "email", value: "owner-first@example.com" });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    if (started.body.data.stage === "AUTHORIZE_EXISTING") {
      const smsCode = String(mocks.sendSms.mock.calls.at(-1)?.[1]).match(/\b(\d{6})\b/)?.[1];
      const authorized = await request(app()).post("/account/contact/authorize-change").send({ field: "email", otp: smsCode });
      expect(authorized.status).toBe(200);
    }
    const mailCode = String(mocks.sendMail.mock.calls.at(-1)?.[2]).match(/\b(\d{6})\b/)?.[1];
    return request(app()).post("/account/contact/confirm-change").send({ field: "email", otp: mailCode });
  }

  const phoneOnlyOwner = {
    id: 44,
    email: null,
    phone: "+255700000001",
    emailVerifiedAt: null,
    phoneVerifiedAt: new Date("2025-01-01T00:00:00.000Z"),
    emailChangedAt: null,
    phoneChangedAt: null,
    passwordHash: "password-hash",
    twoFactorEnabled: false,
    twoFactorMethod: null,
    totpSecretEnc: null,
    payout: null,
  };

  it("does not start the payout cooling period when a new owner adds a first email before any payout account", async () => {
    mocks.userFindUnique.mockResolvedValue(phoneOnlyOwner);
    mocks.accountCount.mockResolvedValue(0);
    mocks.userUpdate.mockResolvedValue({ ...phoneOnlyOwner, email: "owner-first@example.com", emailVerifiedAt: new Date() });

    const confirmed = await addFirstEmail();
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.securityCooldownUntil).toBeNull();
    const data = mocks.userUpdate.mock.calls.at(-1)?.[0]?.data ?? {};
    expect(data.email).toBe("owner-first@example.com");
    expect(data).not.toHaveProperty("emailChangedAt");
  });

  it("still starts the cooling period when a first email is added after a payout account exists", async () => {
    mocks.userFindUnique.mockResolvedValue(phoneOnlyOwner);
    mocks.accountCount.mockResolvedValue(1);
    mocks.userUpdate.mockResolvedValue({ ...phoneOnlyOwner, email: "owner-first@example.com", emailChangedAt: new Date() });

    const confirmed = await addFirstEmail();
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.securityCooldownUntil).toBeTruthy();
    expect(mocks.userUpdate.mock.calls.at(-1)?.[0]?.data).toEqual(expect.objectContaining({ emailChangedAt: expect.any(Date) }));
  });

  it("still starts the cooling period when a first email is added after a payout destination was saved on the old profile", async () => {
    mocks.userFindUnique.mockResolvedValue({ ...phoneOnlyOwner, payout: { mobileMoneyNumber: "encrypted:255700000001" } });
    mocks.accountCount.mockResolvedValue(0);
    mocks.userUpdate.mockResolvedValue({ ...phoneOnlyOwner, email: "owner-first@example.com", emailChangedAt: new Date() });

    const confirmed = await addFirstEmail();
    expect(confirmed.status, JSON.stringify(confirmed.body)).toBe(200);
    expect(confirmed.body.data.securityCooldownUntil).toBeTruthy();
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
