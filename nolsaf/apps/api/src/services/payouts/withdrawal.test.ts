import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashCode } from "../../lib/otp.js";

const m = vi.hoisted(() => ({
  enabled: vi.fn(),
  decide: vi.fn(),
  accounts: vi.fn(),
  sendSms: vi.fn(),
  sendMail: vi.fn(),
  notifyAdmins: vi.fn(),
  notifyOwner: vi.fn(),
  decideLane: vi.fn(),
  ensureRecovery: vi.fn(),
  approveAuto: vi.fn(),
  openDebt: vi.fn(),
  startAuto: vi.fn(),
  autoSettings: vi.fn(),
  allowance: vi.fn(),
  lockOwnerDay: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    payoutRelease: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    payoutWithdrawalAllocation: { findFirst: vi.fn(), findMany: vi.fn() },
    payoutWithdrawalJob: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    disbursement: { findFirst: vi.fn() },
    ownerPayoutRecoveryApplication: { findFirst: vi.fn() },
    notification: { findFirst: vi.fn() },
    invoice: { findUnique: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    guardState: { ownerId: 3, failedAttempts: 0, lockedAt: null as Date | null },
    payoutWithdrawalOtpGuard: { upsert: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    payoutWithdrawalChallenge: {
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    auditLog: { create: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: m.prisma }));
vi.mock("./release.js", () => ({
  payoutReleaseEnabled: m.enabled,
  decideRelease: m.decide,
  loadReleaseContext: vi.fn().mockResolvedValue({}),
  applyReleaseDecision: vi.fn().mockResolvedValue(false),
  verifiedPayoutAccounts: m.accounts,
}));
vi.mock("./riskScoring.js", () => ({ loadPayoutSafeguards: vi.fn().mockResolvedValue({ recentChangeHours: 72 }) }));
vi.mock("../../lib/otp.js", async (original) => ({ ...(await original<any>()), generate6: () => "123456" }));
vi.mock("../../lib/sms.js", () => ({ sendSms: m.sendSms }));
vi.mock("../../lib/mailer.js", () => ({ sendMail: m.sendMail, SECURITY_EMAIL_FROM: "security@nolsaf.com" }));
vi.mock("../../lib/emailBase.js", () => ({ proEmail: () => "<html>", proNoteCard: () => "", proReferenceCard: () => "" }));
vi.mock("../../lib/notifications.js", () => ({ notifyAdmins: m.notifyAdmins, notifyOwner: m.notifyOwner }));
vi.mock("./recovery.js", () => ({ ensureRecoveryDeduction: m.ensureRecovery, openRecoveryTotal: m.openDebt }));
vi.mock("./ledger.js", () => ({ approveDisbursementAutomatically: m.approveAuto }));
vi.mock("./autoLane.js", () => ({
  decideOwnerPayoutLane: m.decideLane,
  startAutoPayout: m.startAuto,
  loadAutoLaneSettings: m.autoSettings,
}));
vi.mock("./ownerWithdrawalLimit.js", () => ({
  ownerWithdrawalAllowance: m.allowance,
  lockOwnerWithdrawalDay: m.lockOwnerDay,
  assertOwnerWithdrawalAmount: (amount: number, allowance: { remaining: number }) => {
    if (amount > allowance.remaining) throw Object.assign(new Error("Daily owner withdrawal limit reached"), { code: "DAILY_LIMIT" });
  },
}));

import {
  confirmWithdrawal,
  maskDestination,
  processWithdrawalJobs,
  resolveWithdrawalHandoff,
  withdrawalAccountFingerprint,
  remindUnclaimed,
  startWithdrawal,
  unclaimedReminderText,
  withdrawalFingerprint,
  withdrawUnclaimed,
} from "./withdrawal.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const ACCOUNT = { id: 7, provider: "Vodacom", accountNumber: "255754123456", destinationChangedAt: null, createdAt: new Date("2026-01-01") };
const OWNER = {
  name: "Daniel",
  fullName: null,
  email: "daniel@example.com",
  phone: "+255712000111",
  emailVerifiedAt: new Date("2026-01-01"),
  phoneVerifiedAt: new Date("2026-01-01"),
  emailChangedAt: null,
  phoneChangedAt: null,
};
const RELEASE = { id: 11, status: "AVAILABLE", holdReason: null, sourceId: 101, bookingId: 501, ownerId: 3, releaseAt: NOW };

function fingerprintFor(account = ACCOUNT) {
  return withdrawalFingerprint({ releaseIds: [11], total: 180000, currency: "TZS", account });
}

function challenge(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    reference: "wd_abcdefghijklmnop",
    userId: 3,
    releaseIds: [11],
    totalAmount: 180000,
    currency: "TZS",
    fingerprint: fingerprintFor(),
    codeHash: hashCode("123456"),
    channel: "SMS",
    destinationMasked: "Vodacom ***456",
    expiresAt: new Date(NOW.getTime() + 60_000),
    usedAt: null,
    attempts: 0,
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubEnv("DISBURSEMENTS_ENABLED", "true");
  vi.clearAllMocks();
  m.enabled.mockReturnValue(true);
  m.decide.mockReturnValue({ next: "AVAILABLE", reason: null });
  m.accounts.mockResolvedValue([ACCOUNT]);
  m.sendSms.mockResolvedValue({ success: true, provider: "sms" });
  m.sendMail.mockResolvedValue({ success: true, provider: "resend" });
  m.notifyAdmins.mockResolvedValue(undefined);
  m.notifyOwner.mockResolvedValue(undefined);
  m.prisma.user.findUnique.mockResolvedValue(OWNER);
  m.prisma.payoutRelease.findMany.mockResolvedValue([RELEASE]);
  m.prisma.payoutWithdrawalAllocation.findFirst.mockResolvedValue(null);
  m.prisma.payoutWithdrawalAllocation.findMany.mockResolvedValue([]);
  m.prisma.payoutRelease.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutRelease.findUnique.mockResolvedValue(RELEASE);
  m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, status: "DRAFT", invoiceNumber: "OINV-1", booking: { property: { id: 1, title: "NoLSAF Hotel" } } });
  m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutWithdrawalChallenge.count.mockResolvedValue(0);
  m.prisma.payoutWithdrawalChallenge.create.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
  m.prisma.payoutWithdrawalChallenge.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutWithdrawalJob.create.mockResolvedValue({ id: 1 });
  m.prisma.payoutWithdrawalJob.findMany.mockResolvedValue([]);
  m.prisma.payoutWithdrawalJob.findFirst.mockResolvedValue(null);
  m.prisma.payoutWithdrawalJob.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutWithdrawalJob.update.mockResolvedValue({ id: 1 });
  m.prisma.disbursement.findFirst.mockResolvedValue(null);
  m.prisma.ownerPayoutRecoveryApplication.findFirst.mockResolvedValue(null);
  m.prisma.notification.findFirst.mockResolvedValue(null);
  m.prisma.guardState.failedAttempts = 0;
  m.prisma.guardState.lockedAt = null;
  m.prisma.payoutWithdrawalOtpGuard.upsert.mockImplementation(async () => ({ ...m.prisma.guardState }));
  m.prisma.payoutWithdrawalOtpGuard.findUniqueOrThrow.mockImplementation(async () => ({ ...m.prisma.guardState }));
  m.prisma.payoutWithdrawalOtpGuard.findUnique.mockResolvedValue(null);
  m.prisma.payoutWithdrawalOtpGuard.updateMany.mockImplementation(async ({ data }: any) => {
    if (m.prisma.guardState.lockedAt || m.prisma.guardState.failedAttempts >= 3) return { count: 0 };
    if (data.failedAttempts?.increment) m.prisma.guardState.failedAttempts++;
    else if (data.failedAttempts === 0) m.prisma.guardState.failedAttempts = 0;
    return { count: 1 };
  });
  m.prisma.payoutWithdrawalOtpGuard.update.mockImplementation(async ({ data }: any) => {
    m.prisma.guardState.lockedAt = data.lockedAt;
    return { ...m.prisma.guardState };
  });
  m.prisma.auditLog.create.mockResolvedValue({});
  m.prisma.$transaction.mockImplementation(async (fn: any) => fn(m.prisma));
  m.decideLane.mockResolvedValue({ lane: "MANUAL", reason: "First payout to this owner is checked by our team" });
  m.ensureRecovery.mockResolvedValue(0);
  m.approveAuto.mockResolvedValue({ id: 77 });
  m.openDebt.mockResolvedValue(0);
  m.startAuto.mockResolvedValue({ ok: true, disbursementId: 77 });
  m.autoSettings.mockResolvedValue({ enabled: false, dailyCapTzs: null, unclaimedAutoDays: null });
  m.allowance.mockResolvedValue({ limit: 10_000_000, used: 0, remaining: 10_000_000 });
  m.lockOwnerDay.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllEnvs());

describe("helpers", () => {
  it("masks the destination to the provider and last three digits", () => {
    expect(maskDestination("Vodacom", "255754123456")).toBe("Vodacom ***456");
  });

  it("fingerprint changes when the destination changes", () => {
    expect(fingerprintFor()).not.toBe(fingerprintFor({ ...ACCOUNT, accountNumber: "255754999999" }));
    expect(fingerprintFor()).not.toBe(fingerprintFor({ ...ACCOUNT, destinationChangedAt: new Date("2026-10-08") as any }));
  });
});

describe("startWithdrawal", () => {
  it("does not issue a code for an amount above the remaining owner limit", async () => {
    m.allowance.mockResolvedValue({ limit: 10_000_000, used: 9_900_000, remaining: 100_000 });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    expect(m.prisma.payoutWithdrawalChallenge.create).not.toHaveBeenCalled();
  });
  it("does not issue an OTP while disbursement sending is paused", async () => {
    vi.stubEnv("DISBURSEMENTS_ENABLED", "false");
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "SENDING_PAUSED", httpStatus: 503 });
    expect(m.prisma.payoutWithdrawalChallenge.create).not.toHaveBeenCalled();
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it("refuses while the feature is off", async () => {
    m.enabled.mockReturnValue(false);
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "FEATURE_OFF" });
  });

  it("pauses after a recent phone change", async () => {
    m.prisma.user.findUnique.mockResolvedValue({ ...OWNER, phoneChangedAt: new Date(NOW.getTime() - 3_600_000) });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "CONTACT_RECENTLY_CHANGED" });
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it("rate limits code requests", async () => {
    m.prisma.payoutWithdrawalChallenge.count.mockResolvedValue(3);
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
  });

  it("refuses when nothing is ready", async () => {
    m.decide.mockReturnValue({ next: "HELD", reason: "open cancellation" });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "NOTHING_AVAILABLE" });
  });

  it("texts a bound code with the amount and destination, stores only its hash, never returns it", async () => {
    const result = await startWithdrawal(3, NOW);
    expect(m.sendSms).toHaveBeenCalledWith(
      OWNER.phone,
      expect.stringContaining("NoLSAF code 123456 to withdraw TZS 180,000 to Vodacom ***456"),
      { bypassEligibilityCheck: true, sensitiveContent: true }
    );
    const stored = m.prisma.payoutWithdrawalChallenge.create.mock.calls[0][0].data;
    expect(stored.codeHash).toBe(hashCode("123456"));
    expect(stored.fingerprint).toBe(fingerprintFor());
    expect(m.prisma.payoutWithdrawalChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 3, id: { not: 9 } }),
      data: { expiresAt: NOW },
    }));
    expect(JSON.stringify(result)).not.toContain("123456");
    expect(result).toMatchObject({ channel: "SMS", total: 180000, destination: "Vodacom ***456", count: 1 });
  });

  it("falls back to verified email when the SMS fails", async () => {
    m.sendSms.mockResolvedValue({ success: false, error: "down" });
    const result = await startWithdrawal(3, NOW);
    expect(m.sendMail).toHaveBeenCalledOnce();
    expect(result.channel).toBe("EMAIL");
  });

  it("falls back to verified email when the SMS provider throws", async () => {
    m.sendSms.mockRejectedValue(new Error("provider unavailable"));
    const result = await startWithdrawal(3, NOW);
    expect(result.channel).toBe("EMAIL");
    expect(m.sendMail).toHaveBeenCalledOnce();
  });

  it("does not treat development console delivery as a delivered withdrawal code", async () => {
    m.sendSms.mockResolvedValue({ success: true, provider: "console" });
    m.sendMail.mockResolvedValue({ success: true, provider: "console" });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "DELIVERY_FAILED" });
    expect(m.prisma.payoutWithdrawalChallenge.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { expiresAt: NOW } });
  });

  it("kills the code when it cannot be delivered", async () => {
    m.sendSms.mockResolvedValue({ success: false, error: "down" });
    m.prisma.user.findUnique.mockResolvedValue({ ...OWNER, emailVerifiedAt: null });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "DELIVERY_FAILED" });
    expect(m.prisma.payoutWithdrawalChallenge.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { expiresAt: NOW } });
  });
});

describe("confirmWithdrawal", () => {
  it("checks the owner limit again inside the same transaction that consumes the code", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.allowance.mockResolvedValue({ limit: 10_000_000, used: 9_900_000, remaining: 100_000 });
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "DAILY_LIMIT" });
    expect(m.lockOwnerDay).toHaveBeenCalled();
    expect(m.prisma.payoutWithdrawalChallenge.updateMany).not.toHaveBeenCalled();
    expect(m.prisma.payoutWithdrawalJob.create).not.toHaveBeenCalled();
  });
  it("does not consume an OTP or queue payouts while sending is paused", async () => {
    vi.stubEnv("DISBURSEMENTS_ENABLED", "false");
    await expect(confirmWithdrawal(3, "wd_abcdefghijklmnop", "123456", NOW)).rejects.toMatchObject({ code: "SENDING_PAUSED", httpStatus: 503 });
    expect(m.prisma.payoutWithdrawalChallenge.findUnique).not.toHaveBeenCalled();
    expect(m.prisma.payoutRelease.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a wrong code and counts the attempt", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    await expect(confirmWithdrawal(3, "wd_abcdefghijklmnop", "000000", NOW)).rejects.toMatchObject({
      code: "INVALID_CODE",
      extra: { attemptsRemaining: 2 },
    });
    expect(m.prisma.payoutWithdrawalChallenge.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 9, usedAt: null }),
      data: { attempts: { increment: 1 } },
    }));
  });

  it("locks withdrawal and new code requests after three wrong entries across challenges", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(challenge({ id: 10, reference: "wd_new" }))
      .mockResolvedValueOnce(challenge({ id: 10, reference: "wd_new" }));
    for (const remaining of [2, 1]) {
      await expect(confirmWithdrawal(3, remaining === 2 ? "wd_abcdefghijklmnop" : "wd_new", "000000", NOW)).rejects.toMatchObject({
        code: "INVALID_CODE", extra: { attemptsRemaining: remaining },
      });
    }
    await expect(confirmWithdrawal(3, "wd_new", "000000", NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    expect(m.prisma.guardState.lockedAt).toEqual(NOW);
    await expect(confirmWithdrawal(3, "wd_abcdefghijklmnop", "123456", NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    expect(m.prisma.payoutWithdrawalChallenge.create).not.toHaveBeenCalled();
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "OWNER_WITHDRAWAL_OTP_LOCKED" }),
    }));
  });

  it("clears earlier wrong-code count after a successful withdrawal", async () => {
    m.prisma.guardState.failedAttempts = 2;
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    await confirmWithdrawal(3, "wd_abcdefghijklmnop", "123456", NOW);
    expect(m.prisma.guardState.failedAttempts).toBe(0);
    expect(m.prisma.guardState.lockedAt).toBeNull();
  });

  it("keeps the support lock if writing the security audit fails", async () => {
    m.prisma.guardState.failedAttempts = 2;
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.prisma.auditLog.create.mockRejectedValue(new Error("audit unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(confirmWithdrawal(3, "wd_abcdefghijklmnop", "000000", NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
      expect(m.prisma.guardState.lockedAt).toEqual(NOW);
      await expect(startWithdrawal(3, NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    } finally {
      log.mockRestore();
    }
  });

  it("rejects another owner's challenge", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ userId: 99 }));
    await expect(confirmWithdrawal(3, "wd_abcdefghijklmnop", "123456", NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an expired, used or exhausted code", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ expiresAt: NOW }));
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "EXPIRED" });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ usedAt: NOW }));
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "ALREADY_USED" });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ attempts: 5 }));
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
  });

  it("burns the code when the payout account changed after it was sent", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.accounts.mockResolvedValue([{ ...ACCOUNT, accountNumber: "255754999999" }]);
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "CHANGED" });
    expect(m.prisma.payoutWithdrawalChallenge.updateMany).toHaveBeenCalledWith({ where: { id: 9, usedAt: null }, data: { usedAt: NOW } });
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("burns the code when a bound payout went on hold", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.decide.mockReturnValue({ next: "HELD", reason: "open cancellation" });
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "CHANGED" });
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("a concurrent confirm that lost the race submits nothing", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.prisma.payoutWithdrawalChallenge.updateMany.mockResolvedValue({ count: 0 });
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "ALREADY_USED" });
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("consumes the OTP and creates the durable handoff in one transaction", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: { in: [11] }, ownerId: 3, status: "AVAILABLE" },
      data: { status: "WITHDRAWING" },
    });
    expect(m.prisma.payoutWithdrawalJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      releaseId: 11, ownerId: 3, invoiceId: 101, challengeId: 9, payoutAccountId: 7,
      status: "PENDING", nextAttemptAt: NOW,
    }) });
    expect(result).toMatchObject({ count: 1, total: 180000, destination: "Vodacom ***456", queuedCount: 1, status: "PROCESSING" });
  });

  it("does not finish confirmation if the durable job cannot be written", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.prisma.payoutWithdrawalJob.create.mockRejectedValue(new Error("database unavailable"));
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toThrow("database unavailable");
    expect(m.startAuto).not.toHaveBeenCalled();
  });

  it("splits a confirmed recovery deduction across every release in order", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([RELEASE, { ...RELEASE, id: 12, sourceId: 102, bookingId: 502 }]);
    m.prisma.invoice.findUnique.mockImplementation(async ({ where }: any) => ({ netPayable: where.id === 101 ? 180000 : 120000 }));
    m.openDebt.mockResolvedValue(200000);
    m.prisma.payoutRelease.updateMany.mockResolvedValue({ count: 2 });
    const fingerprint = withdrawalFingerprint({ releaseIds: [11, 12], total: 300000, currency: "TZS", account: ACCOUNT, openDebt: 200000 });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ releaseIds: [11, 12], fingerprint, totalAmount: 100000 }));
    expect(await confirmWithdrawal(3, "wd_x", "123456", NOW)).toMatchObject({ queuedCount: 2, total: 100000, recoveryDeduction: 200000 });
    const jobs = m.prisma.payoutWithdrawalJob.create.mock.calls.map((call: any) => call[0].data);
    expect(jobs.map((job: any) => Number(job.plannedDeduction))).toEqual([180000, 20000]);
    expect(jobs.map((job: any) => job.releaseId)).toEqual([11, 12]);
  });
});

describe("recovery deduction (policy 6.3.3)", () => {
  it("shows the owner the amount after an open debt, and binds the debt into the code", async () => {
    m.openDebt.mockResolvedValue(30000);
    const result = await startWithdrawal(3, NOW);
    expect(result).toMatchObject({ total: 150000, grossTotal: 180000, recoveryDeduction: 30000 });
    expect(m.sendSms).toHaveBeenCalledWith(OWNER.phone, expect.stringContaining("withdraw TZS 150,000"), expect.anything());
    expect(m.prisma.payoutWithdrawalChallenge.create.mock.calls[0][0].data.fingerprint).not.toBe(fingerprintFor());
  });

  it("burns the code when a new debt appeared after it was sent", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge()); // issued with no debt
    m.openDebt.mockResolvedValue(30000);
    await expect(confirmWithdrawal(3, "wd_x", "123456", NOW)).rejects.toMatchObject({ code: "CHANGED" });
  });

  it("partial deduction: sends the rest and keeps the owner with an admin while debt is open", async () => {
    const debtFingerprint = withdrawalFingerprint({ releaseIds: [11], total: 180000, currency: "TZS", account: ACCOUNT, openDebt: 30000 });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ fingerprint: debtFingerprint, totalAmount: 150000 }));
    m.openDebt.mockResolvedValue(30000);
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.prisma.payoutWithdrawalJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      plannedDeduction: expect.objectContaining({}), grossAmount: expect.objectContaining({}),
    }) });
    expect(Number(m.prisma.payoutWithdrawalJob.create.mock.calls[0][0].data.plannedDeduction)).toBe(30000);
    expect(m.ensureRecovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 150000, recoveryDeduction: 30000, queuedCount: 1 });
  });

  it("full deduction: the claim settles the debt and nothing is sent", async () => {
    const debtFingerprint = withdrawalFingerprint({ releaseIds: [11], total: 180000, currency: "TZS", account: ACCOUNT, openDebt: 200000 });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ fingerprint: debtFingerprint, totalAmount: 0 }));
    m.openDebt.mockResolvedValue(200000);
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(Number(m.prisma.payoutWithdrawalJob.create.mock.calls[0][0].data.plannedDeduction)).toBe(180000);
    expect(m.ensureRecovery).not.toHaveBeenCalled();
    expect(result).toMatchObject({ total: 0, recoveryDeduction: 180000, queuedCount: 1 });
  });
});

describe("durable withdrawal handoff", () => {
  const job = (overrides: Record<string, unknown> = {}) => ({
    id: 1, releaseId: 11, ownerId: 3, invoiceId: 101, bookingId: 501,
    challengeId: 9, payoutAccountId: 7, accountFingerprint: withdrawalAccountFingerprint(ACCOUNT),
    grossAmount: 180000, plannedDeduction: 0, status: "PENDING", attempts: 0,
    ...overrides,
  });

  beforeEach(() => {
    m.prisma.payoutRelease.findUnique.mockResolvedValue({ ...RELEASE, status: "WITHDRAWING" });
    m.prisma.payoutRelease.findMany.mockResolvedValue([]);
    m.prisma.payoutWithdrawalJob.findMany.mockImplementation(async (args: any) => args.where?.OR ? [job()] : []);
  });

  it("moves a queued request to the manual finance lane without another OTP", async () => {
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1, retried: 0, review: 0 });
    expect(m.prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 101, ownerId: 3, status: "DRAFT" }, data: { status: "REQUESTED" },
    });
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 11, status: "WITHDRAWING" },
      data: expect.objectContaining({ status: "RELEASED", lane: "MANUAL" }),
    }));
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: "DONE", leaseUntil: null, lastError: null },
    });
    expect(m.prisma.payoutWithdrawalChallenge.updateMany).not.toHaveBeenCalled();
  });

  it("resumes after the invoice reached the manual queue, without requesting disbursement", async () => {
    m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, status: "REQUESTED" });
    m.prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1 });
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.disbursement.findFirst).toHaveBeenCalled();
  });

  it("resumes an existing automatic disbursement without creating another", async () => {
    m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, status: "APPROVED" });
    m.prisma.disbursement.findFirst.mockResolvedValue({
      id: 77, status: "APPROVED", releaseLane: "AUTO", payoutAccountId: 7, amount: 180000,
      remarks: "Owner withdrawal (automatic)",
    });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1 });
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lane: "AUTO", disbursementId: 77 }),
    }));
  });

  it("approves an already-created automatic request once, then completes handoff", async () => {
    m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, status: "APPROVED" });
    m.decideLane.mockResolvedValue({ lane: "AUTO", reason: null });
    m.prisma.disbursement.findFirst.mockResolvedValue({
      id: 77, status: "REQUESTED", releaseLane: null, payoutAccountId: 7, amount: 180000,
      remarks: "Owner withdrawal (automatic)",
    });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1 });
    expect(m.approveAuto).toHaveBeenCalledWith(77);
    expect(m.startAuto).not.toHaveBeenCalled();
  });

  it("finishes the durable job after a crash following release completion", async () => {
    m.prisma.payoutRelease.findUnique.mockResolvedValue({ ...RELEASE, status: "RELEASED" });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1 });
    expect(m.prisma.disbursement.findFirst).not.toHaveBeenCalled();
    expect(m.ensureRecovery).not.toHaveBeenCalled();
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith({
      where: { id: 1 }, data: { status: "DONE", leaseUntil: null, lastError: null },
    });
  });

  it("uses an existing recovery application as a checkpoint instead of deducting twice", async () => {
    m.prisma.payoutWithdrawalJob.findMany.mockImplementation(async (args: any) => args.where?.OR ? [job({ plannedDeduction: 180000 })] : []);
    m.ensureRecovery.mockResolvedValue(180000);
    m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, status: "PAID", notes: "Settled in full against a recovery from an earlier refund" });
    m.prisma.invoice.updateMany.mockResolvedValue({ count: 0 });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 1 });
    expect(m.ensureRecovery).toHaveBeenCalledOnce();
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lane: "OFFSET" }),
    }));
  });

  it("sends a changed destination to finance review without a payout", async () => {
    m.accounts.mockResolvedValue([{ ...ACCOUNT, accountNumber: "255754999999" }]);
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 0, review: 1 });
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "REVIEW_REQUIRED" }),
    }));
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_review", expect.objectContaining({ releaseId: 11 }));
  });

  it("holds a payout if its confirmed recovery deduction cannot be completed", async () => {
    m.prisma.payoutWithdrawalJob.findMany.mockImplementation(async (args: any) => args.where?.OR ? [job({ plannedDeduction: 30000 })] : []);
    m.ensureRecovery.mockResolvedValue(10000);
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ review: 1 });
    expect(m.ensureRecovery).toHaveBeenCalledOnce();
    expect(m.startAuto).not.toHaveBeenCalled();
  });

  it("does not start another payout after an earlier disbursement failed", async () => {
    m.prisma.disbursement.findFirst.mockImplementation(async (args: any) => args.where?.status === "FAILED" ? { id: 77 } : null);
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ review: 1 });
    expect(m.startAuto).not.toHaveBeenCalled();
  });

  it("holds later owner jobs when an earlier withdrawal requires review", async () => {
    m.prisma.payoutWithdrawalJob.findMany.mockImplementation(async (args: any) => args.where?.OR ? [job({ id: 2, releaseId: 12 })] : []);
    m.prisma.payoutWithdrawalJob.findFirst.mockResolvedValue({ id: 1, status: "REVIEW_REQUIRED" });
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 0, review: 1 });
    expect(m.prisma.payoutWithdrawalJob.updateMany).toHaveBeenCalledWith({
      where: { id: 2, status: { in: ["PENDING", "PROCESSING"] } },
      data: { status: "REVIEW_REQUIRED", leaseUntil: null, lastError: "Earlier withdrawal job 1 needs finance review" },
    });
    expect(m.startAuto).not.toHaveBeenCalled();
  });

  it("does not process jobs while the sender switch is off", async () => {
    vi.stubEnv("DISBURSEMENTS_ENABLED", "false");
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ done: 0, retried: 0, review: 0 });
    expect(m.prisma.payoutWithdrawalJob.findMany).not.toHaveBeenCalled();
  });

  it("retries a transient failure and escalates after the attempt limit", async () => {
    m.prisma.invoice.findUnique.mockRejectedValue(new Error("database unavailable"));
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ retried: 1, review: 0 });
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING" }),
    }));
    m.prisma.payoutWithdrawalJob.findMany.mockImplementation(async (args: any) => args.where?.OR ? [job({ attempts: 4 })] : []);
    expect(await processWithdrawalJobs(NOW)).toMatchObject({ retried: 0, review: 1 });
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_review", expect.objectContaining({ releaseId: 11 }));
  });
});

describe("finance handoff resolution", () => {
  beforeEach(() => {
    m.prisma.payoutRelease.findUnique.mockResolvedValue({ ...RELEASE, status: "WITHDRAWING" });
    m.prisma.payoutWithdrawalJob.findFirst.mockResolvedValue({ id: 1, releaseId: 11, ownerId: 3, invoiceId: 101, status: "REVIEW_REQUIRED" });
  });

  it("returns a side-effect-free request for a new OTP with an audit record", async () => {
    expect(await resolveWithdrawalHandoff({ releaseId: 11, action: "RESET", adminId: 8, note: "Checked invoice and provider: no payout exists.", now: NOW })).toBe("RESET");
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "WITHDRAWING" }, data: { status: "AVAILABLE" } });
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "CANCELLED" }) }));
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "OWNER_WITHDRAWAL_HANDOFF_RESET", actorId: 8 }) }));
    expect(m.notifyOwner).toHaveBeenCalledWith(3, "owner_payout_withdrawal_reset", { releaseId: 11 });
  });

  it("refuses to reset when a disbursement or recovery application exists", async () => {
    m.prisma.disbursement.findFirst.mockResolvedValue({ id: 77 });
    await expect(resolveWithdrawalHandoff({ releaseId: 11, action: "RESET", adminId: 8, note: "Checked the existing provider disbursement.", now: NOW })).rejects.toMatchObject({ code: "CHANGED" });
    expect(m.prisma.payoutRelease.updateMany).not.toHaveBeenCalled();
    m.prisma.disbursement.findFirst.mockResolvedValue(null);
    m.prisma.ownerPayoutRecoveryApplication.findFirst.mockResolvedValue({ id: 2 });
    await expect(resolveWithdrawalHandoff({ releaseId: 11, action: "RESET", adminId: 8, note: "Checked the existing recovery application.", now: NOW })).rejects.toMatchObject({ code: "CHANGED" });
    expect(m.prisma.payoutRelease.updateMany).not.toHaveBeenCalled();
  });

  it("requeues a reviewed job without creating a second payout", async () => {
    expect(await resolveWithdrawalHandoff({ releaseId: 11, action: "RETRY", adminId: 8, note: "Account and invoice verified after provider check.", now: NOW })).toBe("RETRY");
    expect(m.prisma.payoutWithdrawalJob.update).toHaveBeenCalledWith({ where: { id: 1 }, data: {
      status: "PENDING", attempts: 0, nextAttemptAt: NOW, leaseUntil: null, lastError: null,
    } });
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "OWNER_WITHDRAWAL_HANDOFF_RETRY" }) }));
  });

  it("can safely reset a pre-migration withdrawal without a job, but cannot retry it", async () => {
    m.prisma.payoutWithdrawalJob.findFirst.mockResolvedValue(null);
    await expect(resolveWithdrawalHandoff({ releaseId: 11, action: "RETRY", adminId: 8, note: "Reviewed the old request with no saved job.", now: NOW })).rejects.toMatchObject({ code: "CHANGED" });
    expect(await resolveWithdrawalHandoff({ releaseId: 11, action: "RESET", adminId: 8, note: "Verified there is no claim or payout side effect.", now: NOW })).toBe("RESET");
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({ where: { id: 11, status: "WITHDRAWING" }, data: { status: "AVAILABLE" } });
    expect(m.prisma.payoutWithdrawalJob.update).not.toHaveBeenCalled();
  });

  it("restarts the unclaimed timer when resetting an automatic withdrawal", async () => {
    m.prisma.payoutWithdrawalJob.findFirst.mockResolvedValue({ id: 1, releaseId: 11, ownerId: 3, invoiceId: 101, challengeId: null, status: "REVIEW_REQUIRED" });
    expect(await resolveWithdrawalHandoff({ releaseId: 11, action: "RESET", adminId: 8, note: "No claim, recovery or provider submission exists.", now: NOW })).toBe("RESET");
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "WITHDRAWING" }, data: { status: "AVAILABLE", availableAt: NOW },
    });
  });
});

describe("unclaimed payouts (policy 5.2.2)", () => {
  const DAY = 24 * 60 * 60 * 1000;

  it("does not remind or queue unclaimed payouts while sending is paused", async () => {
    vi.stubEnv("DISBURSEMENTS_ENABLED", "false");
    expect(await remindUnclaimed(NOW)).toBe(0);
    expect(await withdrawUnclaimed(NOW)).toBe(0);
    expect(m.prisma.payoutRelease.findMany).not.toHaveBeenCalled();
    expect(m.notifyOwner).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    m.autoSettings.mockResolvedValue({ enabled: true, dailyCapTzs: 2_000_000, unclaimedAutoDays: 14 });
    m.prisma.invoice.findMany.mockResolvedValue([{ netPayable: 180000 }]);
    m.prisma.auditLog.findMany.mockResolvedValue([]);
    m.prisma.auditLog.createMany.mockResolvedValue({ count: 1 });
    m.notifyOwner.mockResolvedValue(undefined);
  });

  it("reminder text names the amount, destination and send time, and carries no code", () => {
    const text = unclaimedReminderText({ total: 180000, destination: "Vodacom ***456", sendOn: new Date("2026-10-10T11:00:00Z") });
    expect(text).toBe("NoLSAF: TZS 180,000 is ready in My Payouts. If you do not withdraw it, we will send it to Vodacom ***456 on 10 Oct, 14:00 EAT.");
    expect(text).not.toContain("—");
  });

  it("reminds once, two days before the deadline, and records it", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([
      { id: 11, ownerId: 3, sourceId: 101, availableAt: new Date(NOW.getTime() - 12 * DAY) },
    ]);
    expect(await remindUnclaimed(NOW)).toBe(1);
    expect(m.notifyOwner).toHaveBeenCalledWith(3, "owner_payout_unclaimed_reminder", expect.objectContaining({ amountText: "TZS 180,000" }));
    expect(m.sendSms).toHaveBeenCalledWith(OWNER.phone, expect.stringContaining("is ready in My Payouts"));
    expect(m.prisma.auditLog.createMany.mock.calls[0][0].data[0]).toMatchObject({ action: "OWNER_PAYOUT_UNCLAIMED_REMINDER", entityId: 11 });
  });

  it("does not remind twice", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([
      { id: 11, ownerId: 3, sourceId: 101, availableAt: new Date(NOW.getTime() - 12 * DAY) },
    ]);
    m.prisma.auditLog.findMany.mockImplementation(async (args: any) => args.where?.action === "OWNER_PAYOUT_UNCLAIMED_REMINDER" ? [{ entityId: 11, createdAt: NOW }] : []);
    expect(await remindUnclaimed(NOW)).toBe(0);
    expect(m.sendSms).not.toHaveBeenCalled();
  });

  it("never sends an unclaimed payout without a reminder at least 48h old", async () => {
    m.prisma.payoutRelease.findMany.mockImplementation(async (args: any) =>
      args?.distinct ? [{ ownerId: 3 }] : args?.where?.availableAt ? [{ id: 11 }] : [RELEASE]
    );
    m.prisma.auditLog.findMany.mockResolvedValue([]); // no reminder old enough
    expect(await withdrawUnclaimed(NOW)).toBe(0);
    expect(m.decideLane).not.toHaveBeenCalled();
  });

  it("queues an unclaimed payout once the reminder is old enough", async () => {
    m.prisma.payoutRelease.findMany.mockImplementation(async (args: any) =>
      args?.distinct ? [{ ownerId: 3 }] : args?.where?.availableAt ? [{ id: 11 }] : [RELEASE]
    );
    m.prisma.auditLog.findMany.mockImplementation(async (args: any) => args.where?.action === "OWNER_PAYOUT_UNCLAIMED_REMINDER" ? [{ entityId: 11, createdAt: new Date(NOW.getTime() - 3 * DAY) }] : []);
    expect(await withdrawUnclaimed(NOW)).toBe(1);
    expect(m.prisma.payoutWithdrawalJob.create).toHaveBeenCalledWith({ data: expect.objectContaining({ releaseId: 11, challengeId: null, status: "PENDING" }) });
    expect(m.decideLane).not.toHaveBeenCalled();
  });

  it("does not claim a whole invoice if a partial withdrawal reserves it before the transaction", async () => {
    m.prisma.payoutRelease.findMany.mockImplementation(async (args: any) =>
      args?.distinct ? [{ ownerId: 3 }] : args?.where?.availableAt ? [{ id: 11 }] : [RELEASE]
    );
    m.prisma.auditLog.findMany.mockImplementation(async (args: any) => args.where?.action === "OWNER_PAYOUT_UNCLAIMED_REMINDER"
      ? [{ entityId: 11, createdAt: new Date(NOW.getTime() - 3 * DAY) }] : []);
    m.prisma.payoutWithdrawalAllocation.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 9 });
    expect(await withdrawUnclaimed(NOW)).toBe(0);
    expect(m.prisma.payoutWithdrawalJob.create).not.toHaveBeenCalled();
  });

  it("ignores an old automatic reminder after finance resets the withdrawal", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([{ id: 11, ownerId: 3, sourceId: 101, availableAt: new Date(NOW.getTime() - 12 * DAY) }]);
    m.prisma.auditLog.findMany.mockImplementation(async (args: any) => args.where?.action === "OWNER_PAYOUT_UNCLAIMED_REMINDER"
      ? [{ entityId: 11, createdAt: new Date(NOW.getTime() - 20 * DAY) }]
      : [{ entityId: 11, createdAt: new Date(NOW.getTime() - 13 * DAY) }]);
    expect(await remindUnclaimed(NOW)).toBe(1);
  });

  it("holds unclaimed automatic sending while withdrawal OTP is support-locked", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([{ ownerId: 3 }]);
    m.prisma.payoutWithdrawalOtpGuard.findUnique.mockResolvedValue({ lockedAt: NOW, failedAttempts: 3 });
    expect(await withdrawUnclaimed(NOW)).toBe(0);
    expect(m.decideLane).not.toHaveBeenCalled();
  });
});
