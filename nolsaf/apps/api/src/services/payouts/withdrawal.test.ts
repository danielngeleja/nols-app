import { beforeEach, describe, expect, it, vi } from "vitest";
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
  applyRecoveries: vi.fn(),
  openDebt: vi.fn(),
  startAuto: vi.fn(),
  autoSettings: vi.fn(),
  prisma: {
    $transaction: vi.fn(),
    payoutRelease: { findMany: vi.fn(), updateMany: vi.fn() },
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
vi.mock("./recovery.js", () => ({ applyRecoveriesToClaim: m.applyRecoveries, openRecoveryTotal: m.openDebt }));
vi.mock("./autoLane.js", () => ({
  decideOwnerPayoutLane: m.decideLane,
  startAutoPayout: m.startAuto,
  loadAutoLaneSettings: m.autoSettings,
}));

import {
  confirmWithdrawal,
  maskDestination,
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
  vi.clearAllMocks();
  m.enabled.mockReturnValue(true);
  m.decide.mockReturnValue({ next: "AVAILABLE", reason: null });
  m.accounts.mockResolvedValue([ACCOUNT]);
  m.sendSms.mockResolvedValue({ success: true, provider: "sms" });
  m.sendMail.mockResolvedValue({ success: true, provider: "resend" });
  m.notifyAdmins.mockResolvedValue(undefined);
  m.prisma.user.findUnique.mockResolvedValue(OWNER);
  m.prisma.payoutRelease.findMany.mockResolvedValue([RELEASE]);
  m.prisma.payoutRelease.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.invoice.findUnique.mockResolvedValue({ netPayable: 180000, invoiceNumber: "OINV-1", booking: { property: { id: 1, title: "NoLSAF Hotel" } } });
  m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutWithdrawalChallenge.count.mockResolvedValue(0);
  m.prisma.payoutWithdrawalChallenge.create.mockImplementation(async ({ data }: any) => ({ id: 9, ...data }));
  m.prisma.payoutWithdrawalChallenge.updateMany.mockResolvedValue({ count: 1 });
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
  m.applyRecoveries.mockResolvedValue(0);
  m.openDebt.mockResolvedValue(0);
  m.startAuto.mockResolvedValue({ ok: true, disbursementId: 77 });
  m.autoSettings.mockResolvedValue({ enabled: false, dailyCapTzs: null, unclaimedAutoDays: null });
});

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

  it("MANUAL lane: submits the claim to the admin queue and records why", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.startAuto).not.toHaveBeenCalled();
    expect(m.prisma.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: 101, ownerId: 3, status: "DRAFT" },
      data: { status: "REQUESTED" },
    });
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "WITHDRAWING" },
      data: {
        status: "RELEASED",
        lane: "MANUAL",
        releasedAt: NOW,
        holdReason: "First payout to this owner is checked by our team",
        disbursementId: null,
      },
    });
    expect(m.prisma.auditLog.create).toHaveBeenCalledOnce();
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_claim_submitted", expect.objectContaining({ invoiceId: 101 }));
    expect(result).toMatchObject({ count: 1, total: 180000, destination: "Vodacom ***456", autoCount: 0, manualCount: 1 });
  });

  it("AUTO lane: the system starts the payout and admins are not asked", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.decideLane.mockResolvedValue({ lane: "AUTO", reason: null });
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.startAuto).toHaveBeenCalledWith({ ownerId: 3, invoiceId: 101, payoutAccountId: 7, now: NOW });
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(m.notifyAdmins).not.toHaveBeenCalled();
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "WITHDRAWING" },
      data: { status: "RELEASED", lane: "AUTO", releasedAt: NOW, holdReason: null, disbursementId: 77 },
    });
    expect(result).toMatchObject({ autoCount: 1, manualCount: 0 });
  });

  it("AUTO that cannot start falls back to admins with the reason", async () => {
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge());
    m.decideLane.mockResolvedValue({ lane: "AUTO", reason: null });
    m.startAuto.mockResolvedValue({ ok: false, reason: "provider rails disabled" });
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_claim_submitted", expect.objectContaining({ invoiceId: 101 }));
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "WITHDRAWING" },
      data: expect.objectContaining({ lane: "MANUAL", holdReason: "Automatic payout could not start: provider rails disabled" }),
    });
    expect(result).toMatchObject({ autoCount: 0, manualCount: 1 });
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
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ fingerprint: debtFingerprint }));
    m.openDebt.mockResolvedValue(30000);
    m.applyRecoveries.mockResolvedValue(30000);
    m.decideLane.mockResolvedValue({ lane: "AUTO", reason: null });
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.decideLane).toHaveBeenCalledWith(expect.objectContaining({ amount: 150000 }));
    expect(m.startAuto).not.toHaveBeenCalled(); // debt still reported open by the mock
    expect(result).toMatchObject({ total: 150000, recoveryDeduction: 30000, manualCount: 1 });
  });

  it("full deduction: the claim settles the debt and nothing is sent", async () => {
    const debtFingerprint = withdrawalFingerprint({ releaseIds: [11], total: 180000, currency: "TZS", account: ACCOUNT, openDebt: 200000 });
    m.prisma.payoutWithdrawalChallenge.findUnique.mockResolvedValue(challenge({ fingerprint: debtFingerprint }));
    m.openDebt.mockResolvedValue(200000);
    m.applyRecoveries.mockResolvedValue(180000);
    const result = await confirmWithdrawal(3, "wd_x", "123456", NOW);
    expect(m.decideLane).not.toHaveBeenCalled();
    expect(m.notifyAdmins).not.toHaveBeenCalled();
    expect(m.prisma.payoutRelease.updateMany).toHaveBeenCalledWith({
      where: { id: 11, status: "WITHDRAWING" },
      data: expect.objectContaining({ status: "RELEASED", lane: "OFFSET" }),
    });
    expect(result).toMatchObject({ total: 0, recoveryDeduction: 180000, autoCount: 0, manualCount: 0 });
  });
});

describe("unclaimed payouts (policy 5.2.2)", () => {
  const DAY = 24 * 60 * 60 * 1000;

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
    m.prisma.auditLog.findMany.mockResolvedValue([{ entityId: 11 }]);
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

  it("sends an unclaimed payout once the reminder is old enough", async () => {
    m.prisma.payoutRelease.findMany.mockImplementation(async (args: any) =>
      args?.distinct ? [{ ownerId: 3 }] : args?.where?.availableAt ? [{ id: 11 }] : [RELEASE]
    );
    m.prisma.auditLog.findMany.mockResolvedValue([{ entityId: 11 }]);
    expect(await withdrawUnclaimed(NOW)).toBe(1);
    expect(m.decideLane).toHaveBeenCalledOnce();
  });

  it("holds unclaimed automatic sending while withdrawal OTP is support-locked", async () => {
    m.prisma.payoutRelease.findMany.mockResolvedValue([{ ownerId: 3 }]);
    m.prisma.payoutWithdrawalOtpGuard.findUnique.mockResolvedValue({ lockedAt: NOW, failedAttempts: 3 });
    expect(await withdrawUnclaimed(NOW)).toBe(0);
    expect(m.decideLane).not.toHaveBeenCalled();
  });
});
