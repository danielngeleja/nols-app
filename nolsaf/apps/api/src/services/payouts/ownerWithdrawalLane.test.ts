import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  prisma: {
    payoutAccount: { count: vi.fn() },
    payoutWithdrawalChallenge: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    payoutWithdrawalAllocation: { findMany: vi.fn() },
    disbursement: { findFirst: vi.fn(), findMany: vi.fn() },
    user: { findUnique: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
  },
  requestDisbursement: vi.fn(),
  approveDisbursementAutomatically: vi.fn(),
  decideOwnerPayoutLane: vi.fn(),
  loadOwnerPayoutPolicy: vi.fn(),
  loadControl: vi.fn(),
  openRecoveryTotal: vi.fn(),
  notifyAdmins: vi.fn(),
  notifyOwner: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: m.prisma }));
vi.mock("./ledger.js", () => ({
  requestDisbursement: m.requestDisbursement,
  approveDisbursementAutomatically: m.approveDisbursementAutomatically,
}));
vi.mock("./autoLane.js", () => ({
  decideOwnerPayoutLane: m.decideOwnerPayoutLane,
  loadOwnerPayoutPolicy: m.loadOwnerPayoutPolicy,
}));
vi.mock("./recovery.js", () => ({
  openRecoveryTotal: m.openRecoveryTotal,
  ensureRecoveryDeduction: vi.fn(async (_o: number, _i: number, target: number) => target),
  recoveredFromClaim: vi.fn(),
}));
vi.mock("./senderSwitch.js", () => ({ disbursementSendingEnabled: () => true }));
vi.mock("./ownerPayoutControl.js", () => ({
  HOLD_OWNER_MESSAGE: "Withdrawals are paused",
  loadOwnerPayoutControl: m.loadControl,
}));
vi.mock("../../lib/notifications.js", () => ({ notifyAdmins: m.notifyAdmins, notifyOwner: m.notifyOwner }));
vi.mock("./withdrawal.js", () => ({
  assertWithdrawalOtpUnlocked: vi.fn(), codeMatches: vi.fn(), deliverCode: vi.fn(), loadOwnerContact: vi.fn(),
  maskDestination: vi.fn(), recordWrongWithdrawalCode: vi.fn(), withdrawalAccountFingerprint: () => "fp",
  WithdrawalError: class extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
}));
vi.mock("./release.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./release.js")>()),
  payoutReleaseEnabled: () => true,
  verifiedPayoutAccounts: vi.fn(async () => [ACCOUNT]),
}));

const ACCOUNT = { id: 7, userId: 5, provider: "Tigo", accountNumber: "255700000001", destinationChangedAt: null, createdAt: new Date("2026-11-01T00:00:00Z") };
const NOW = new Date("2026-11-25T09:00:00Z");

import {
  alertOverdueOwnerWithdrawals, confirmAmountWithdrawal, processAmountWithdrawalHandoffs, startAmountWithdrawal,
} from "./partialWithdrawal.js";
import { destinationChangeAnchor } from "./riskScoring.js";
import { formatEatDateTime } from "./release.js";

function pendingChallenge() {
  m.prisma.payoutWithdrawalChallenge.findMany.mockResolvedValue([{
    id: 31, userId: 5, handoffAttempts: 0, payoutAccountId: 7, accountFingerprint: "fp",
    totalAmount: 2_000_000, releaseIds: [1],
  }]);
  m.prisma.payoutWithdrawalChallenge.updateMany.mockResolvedValue({ count: 1 });
  m.prisma.payoutWithdrawalAllocation.findMany.mockResolvedValue([{ invoiceId: 10, recoveryTarget: 0 }]);
  m.prisma.disbursement.findFirst.mockResolvedValue(null);
  m.requestDisbursement.mockResolvedValue({ id: 900 });
  m.prisma.user.findUnique.mockResolvedValue({ name: "Juma", fullName: "Juma Mussa" });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.notifyAdmins.mockResolvedValue(undefined);
  m.openRecoveryTotal.mockResolvedValue(0);
  m.loadOwnerPayoutPolicy.mockResolvedValue({ firstPayoutAutoMaxTzs: null, reviewAlertHours: 4 });
  m.loadControl.mockResolvedValue({ available: true, hold: null, alwaysReview: null });
});

describe("a paused owner cannot withdraw", () => {
  it("refuses to send a code, and refuses a code sent before the pause", async () => {
    m.loadControl.mockResolvedValue({ available: true, hold: { at: NOW, reason: "x", byId: 1 }, alwaysReview: null });
    await expect(startAmountWithdrawal(5, 100_000, NOW)).rejects.toMatchObject({ code: "ON_HOLD" });
    await expect(confirmAmountWithdrawal(5, "wd_reference_x", "123456", NOW)).rejects.toMatchObject({ code: "ON_HOLD" });
    expect(m.prisma.payoutWithdrawalChallenge.findMany).not.toHaveBeenCalled();
  });
});

describe("owner amount withdrawal lane", () => {
  it("keeps the owner's first payout with a person and tells finance at once", async () => {
    pendingChallenge();
    m.decideOwnerPayoutLane.mockResolvedValue({ lane: "MANUAL", reason: "First payout to this owner is checked by our team" });
    const result = await processAmountWithdrawalHandoffs(NOW);
    expect(result.done).toBe(1);
    expect(m.decideOwnerPayoutLane).toHaveBeenCalledWith(expect.objectContaining({
      ownerId: 5, amount: 2_000_000, source: { type: "OWNER_WITHDRAWAL", id: 31, disbursementId: 900 },
    }));
    expect(m.approveDisbursementAutomatically).not.toHaveBeenCalled();
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_requested", expect.objectContaining({
      disbursementId: 900, ownerName: "Juma Mussa", amountText: "TZS 2,000,000",
      reason: "First payout to this owner is checked by our team",
    }));
  });

  it("approves a later clean withdrawal as the system, with no admin alert", async () => {
    pendingChallenge();
    m.decideOwnerPayoutLane.mockResolvedValue({ lane: "AUTO", reason: null });
    await processAmountWithdrawalHandoffs(NOW);
    expect(m.approveDisbursementAutomatically).toHaveBeenCalledWith(900);
    expect(m.notifyAdmins).not.toHaveBeenCalled();
  });

  it("sends it to a person while a refund recovery is still open", async () => {
    pendingChallenge();
    m.decideOwnerPayoutLane.mockResolvedValue({ lane: "AUTO", reason: null });
    m.openRecoveryTotal.mockResolvedValue(50_000);
    await processAmountWithdrawalHandoffs(NOW);
    expect(m.approveDisbursementAutomatically).not.toHaveBeenCalled();
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_requested",
      expect.objectContaining({ reason: "A recovery from an earlier refund is still open" }));
  });

  it("leaves the transfer with finance when automatic approval fails", async () => {
    pendingChallenge();
    m.decideOwnerPayoutLane.mockResolvedValue({ lane: "AUTO", reason: null });
    m.approveDisbursementAutomatically.mockRejectedValue(new Error("Disbursement 900 is APPROVED, expected REQUESTED"));
    const result = await processAmountWithdrawalHandoffs(NOW);
    expect(result.done).toBe(1);
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_requested",
      expect.objectContaining({ reason: expect.stringMatching(/Automatic approval could not run/) }));
  });
});

describe("overdue owner withdrawal alert", () => {
  it("alerts finance once per withdrawal past the review target", async () => {
    m.prisma.disbursement.findMany
      .mockResolvedValueOnce([{ id: 900 }, { id: 901 }])
      .mockResolvedValueOnce([
        { id: 900, amount: 2_000_000, createdAt: new Date("2026-11-25T03:00:00Z"), payoutAccount: { user: { name: "Juma", fullName: null } } },
      ]);
    m.prisma.auditLog.findMany.mockResolvedValue([{ entityId: 901 }]);
    m.prisma.auditLog.create.mockResolvedValue({});
    expect(await alertOverdueOwnerWithdrawals(NOW)).toBe(1);
    expect(m.notifyAdmins).toHaveBeenCalledTimes(1);
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_overdue", expect.objectContaining({
      disbursementId: 900, ownerName: "Juma", hoursWaiting: 6,
    }));
  });
});

describe("first payout destination is onboarding, not a change", () => {
  it("has no change anchor when the payee never had another destination", async () => {
    m.prisma.payoutAccount.count.mockResolvedValue(0);
    expect(await destinationChangeAnchor({ ...ACCOUNT, destinationChangedAt: NOW })).toBeNull();
  });

  it("keeps the anchor when it replaced an earlier destination", async () => {
    m.prisma.payoutAccount.count.mockResolvedValue(1);
    expect(await destinationChangeAnchor({ ...ACCOUNT, destinationChangedAt: NOW })).toEqual(NOW);
  });

  it("keeps the anchor when it replaced a wallet saved only on the old profile", async () => {
    m.prisma.payoutAccount.count.mockResolvedValue(0);
    m.prisma.auditLog.findMany.mockResolvedValue([
      { afterJson: { change: "changed", payoutAccountId: 7 } },
    ]);
    expect(await destinationChangeAnchor({ ...ACCOUNT, destinationChangedAt: NOW })).toEqual(NOW);
  });

  it("ignores a 'changed' save that belongs to a different account", async () => {
    m.prisma.payoutAccount.count.mockResolvedValue(0);
    m.prisma.auditLog.findMany.mockResolvedValue([
      { afterJson: { change: "changed", payoutAccountId: 99 } },
      { afterJson: { change: "added", payoutAccountId: 7 } },
    ]);
    expect(await destinationChangeAnchor({ ...ACCOUNT, destinationChangedAt: NOW })).toBeNull();
  });

  it("fails closed (keeps the wait) when the save history cannot be read", async () => {
    m.prisma.payoutAccount.count.mockResolvedValue(0);
    m.prisma.auditLog.findMany.mockRejectedValue(new Error("db down"));
    expect(await destinationChangeAnchor({ ...ACCOUNT, destinationChangedAt: NOW })).toEqual(NOW);
  });
});

describe("overdue alert uses the admin's hours", () => {
  it("looks back by the configured hours", async () => {
    m.loadOwnerPayoutPolicy.mockResolvedValue({ firstPayoutAutoMaxTzs: null, reviewAlertHours: 2 });
    m.prisma.disbursement.findMany.mockResolvedValueOnce([]);
    await alertOverdueOwnerWithdrawals(NOW);
    expect(m.prisma.disbursement.findMany.mock.calls[0][0].where.createdAt).toEqual({ lte: new Date("2026-11-25T07:00:00Z") });
  });
});

describe("overdue alert never starves newer withdrawals", () => {
  it("skips rows already alerted and reaches the next ones", async () => {
    m.prisma.disbursement.findMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }])
      .mockResolvedValueOnce([
        { id: 3, amount: 100_000, createdAt: new Date("2026-11-25T01:00:00Z"), payoutAccount: { user: null } },
      ]);
    m.prisma.auditLog.findMany.mockResolvedValue([{ entityId: 1 }, { entityId: 2 }]);
    m.prisma.auditLog.create.mockResolvedValue({});
    expect(await alertOverdueOwnerWithdrawals(NOW, 1)).toBe(1);
    expect(m.prisma.disbursement.findMany.mock.calls[1][0].where.id).toEqual({ in: [3] });
    expect(m.notifyAdmins).toHaveBeenCalledWith("owner_payout_withdrawal_overdue", expect.objectContaining({ disbursementId: 3 }));
  });
});

describe("owner-facing times", () => {
  it("are East Africa Time and say so", () => {
    expect(formatEatDateTime(new Date("2026-11-28T06:12:00Z"))).toBe("28 Nov 2026, 09:12 EAT");
  });

  it("show midnight as 00:00, never 24:00", () => {
    expect(formatEatDateTime(new Date("2026-11-27T21:00:00Z"))).toBe("28 Nov 2026, 00:00 EAT");
  });
});
