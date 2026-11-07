import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
  const fn = () => vi.fn();
  return {
    db: {
      systemSetting: { findUnique: fn() },
      salesPartnerProfile: { findUnique: fn(), updateMany: fn(), update: fn() },
      salesCommission: { findMany: fn() },
      payoutAccount: { findFirst: fn(), findUnique: fn(), count: fn() },
      salesPayoutRequest: { findFirst: fn(), findUnique: fn(), findMany: fn(), count: fn(), create: fn(), updateMany: fn() },
      salesPayoutItem: { createMany: fn() },
      salesPayoutChallenge: { count: fn(), create: fn(), update: fn(), updateMany: fn(), findUnique: fn() },
      salesOwnerConfirmation: { findFirst: fn() },
      salesLeadVisit: { count: fn() },
      salesPartnerMonth: { findUnique: fn() },
      booking: { findMany: fn(), findFirst: fn() },
      user: { findUnique: fn() },
      disbursement: { findFirst: fn() },
      auditLog: { create: fn() },
      $transaction: fn(),
    } as any,
    assess: vi.fn(),
    autoLane: vi.fn(),
    contact: vi.fn(),
    deliver: vi.fn(),
    codeMatches: vi.fn(),
    requestDisbursement: vi.fn(),
    approveAuto: vi.fn(),
    notifyAdmins: vi.fn(),
    notifyUser: vi.fn(),
    ownsProperty: vi.fn(),
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: m.db }));
vi.mock("./riskScoring.js", async (original) => ({
  ...(await original<any>()),
  assessDisbursementRisk: m.assess,
  loadPayoutSafeguards: vi.fn().mockResolvedValue({ reviewThresholdTzs: null, dailyCapPerPayeeTzs: null, recentChangeHours: 72 }),
}));
vi.mock("./autoLane.js", () => ({ loadAutoLaneSettings: m.autoLane }));
vi.mock("./withdrawal.js", () => ({
  loadOwnerContact: m.contact,
  deliverCode: m.deliver,
  codeMatches: m.codeMatches,
  maskDestination: (provider: string, n: string) => `${provider} ***${String(n).slice(-3)}`,
}));
vi.mock("./ledger.js", () => ({ requestDisbursement: m.requestDisbursement, approveDisbursementAutomatically: m.approveAuto }));
vi.mock("./senderSwitch.js", () => ({ disbursementSendingEnabled: () => true }));
vi.mock("../../lib/notifications.js", () => ({ notifyAdmins: m.notifyAdmins, notifyUser: m.notifyUser }));
vi.mock("../../lib/salesSelfDealing.js", () => ({
  loadPartnerIdentity: vi.fn().mockResolvedValue({ userId: 21, emails: new Set(), phones: new Set(), payoutKeys: new Set() }),
  partnerOwnsPropertyReason: m.ownsProperty,
  partnerBookedStayReason: vi.fn().mockReturnValue(null),
  payoutAccountKey: (v: string) => String(v).slice(-9),
}));

import {
  confirmSalesWithdrawal,
  evaluateSalesWithdrawalPolicy,
  partnerMessage,
  salesWithdrawalFingerprint,
  startSalesAutoPayout,
  startSalesWithdrawal,
} from "./salesWithdrawal.js";

const NOW = new Date("2026-11-08T09:00:00Z");
const OLD = new Date("2026-09-01T00:00:00Z");
const ACCOUNT = {
  id: 7, userId: 21, provider: "Vodacom", accountNumber: "255754123456", accountName: "AMINA J MUSHI",
  destinationChangedAt: OLD, createdAt: OLD,
};
const COMMISSIONS = [
  { id: 1, type: "NRMS_USAGE", commissionAmount: 120000, propertyId: 5, sourceBookingId: null },
  { id: 2, type: "MARKETPLACE_BOOKING", commissionAmount: 80000, propertyId: 6, sourceBookingId: 900 },
];
const PARTNER = {
  id: 11, userId: 21, status: "ACTIVE", agentCode: "SP-24017",
  payoutHoldAt: null, payoutHoldReason: null, withdrawalOtpFailures: 0, withdrawalOtpLockedAt: null,
};

const policyInput = () => ({ partnerId: 11, userId: 21, commissions: COMMISSIONS, total: 200000, account: ACCOUNT, now: NOW });
const codes = (flags: Array<{ code: string }>) => flags.map((f) => f.code);

beforeEach(() => {
  vi.clearAllMocks();
  const d = m.db;
  d.systemSetting.findUnique.mockResolvedValue({ salesAutoPayoutEnabled: true, salesAutoPayoutMaxTzs: 500000 });
  m.autoLane.mockResolvedValue({ enabled: true, dailyCapTzs: 2_000_000, unclaimedAutoDays: null });
  d.salesPartnerProfile.findUnique.mockResolvedValue({ ...PARTNER, payoutName: "AMINA J MUSHI", payoutMethod: "Vodacom" });
  d.salesPartnerProfile.updateMany.mockResolvedValue({ count: 1 });
  d.salesCommission.findMany.mockResolvedValue(COMMISSIONS);
  d.payoutAccount.findFirst.mockResolvedValue(ACCOUNT);
  d.payoutAccount.findUnique.mockResolvedValue({ ...ACCOUNT, isVerified: true, isActive: true });
  d.payoutAccount.count.mockResolvedValue(0);
  d.salesPayoutRequest.findFirst.mockResolvedValue(null);
  d.salesPayoutRequest.count.mockImplementation(({ where }: any) => Promise.resolve(where.status === "PAID" ? 4 : 1));
  d.salesPayoutRequest.findMany.mockResolvedValue([]);
  d.salesPayoutRequest.updateMany.mockResolvedValue({ count: 1 });
  d.salesPayoutChallenge.count.mockResolvedValue(0);
  d.salesPayoutChallenge.updateMany.mockResolvedValue({ count: 1 });
  d.salesOwnerConfirmation.findFirst.mockResolvedValue(null);
  d.salesLeadVisit.count.mockResolvedValue(0);
  d.salesPartnerMonth.findUnique.mockResolvedValue(null);
  d.booking.findMany.mockResolvedValue([]);
  d.booking.findFirst.mockResolvedValue(null);
  d.user.findUnique.mockResolvedValue({ name: "Amina Mushi", fullName: null });
  d.disbursement.findFirst.mockResolvedValue(null);
  d.auditLog.create.mockResolvedValue({});
  d.$transaction.mockImplementation((cb: any) => cb(d));
  m.assess.mockResolvedValue({ level: "LOW", flags: [] });
  m.ownsProperty.mockResolvedValue(null);
  m.contact.mockResolvedValue({ phone: "+255754000111", phoneVerifiedAt: OLD, email: null, emailVerifiedAt: null, phoneChangedAt: null, emailChangedAt: null });
  m.deliver.mockResolvedValue({ channel: "SMS", sentTo: "***111" });
  m.notifyAdmins.mockResolvedValue(undefined);
  m.notifyUser.mockResolvedValue(undefined);
  m.requestDisbursement.mockResolvedValue({ id: 501 });
  m.approveAuto.mockResolvedValue({ id: 501 });
});

describe("evaluateSalesWithdrawalPolicy", () => {
  it("passes a clean withdrawal from a returning partner", async () => {
    expect(await evaluateSalesWithdrawalPolicy(policyInput())).toEqual([]);
  });

  it("sends the first withdrawal to a person, without freezing the partner", async () => {
    m.db.salesPayoutRequest.count.mockImplementation(({ where }: any) => Promise.resolve(where.status === "PAID" ? 0 : 1));
    const flags = await evaluateSalesWithdrawalPolicy(policyInput());
    expect(codes(flags)).toEqual(["FIRST_WITHDRAWAL"]);
    expect(flags[0].severity).toBe("REVIEW");
  });

  it("reviews anything above the automatic limit", async () => {
    const flags = await evaluateSalesWithdrawalPolicy({ ...policyInput(), total: 650000 });
    expect(codes(flags)).toContain("OVER_AUTO_LIMIT");
  });

  it("treats an owner denial, flagged visits, a shared account and a leaderboard exclusion as fraud signals", async () => {
    m.db.salesOwnerConfirmation.findFirst.mockResolvedValue({ id: 3 });
    m.db.salesLeadVisit.count.mockResolvedValue(2);
    m.db.payoutAccount.count.mockResolvedValue(1);
    m.db.salesPartnerMonth.findUnique.mockResolvedValue({ excludedAt: NOW, excludedReason: "Visit photos under review" });
    const flags = await evaluateSalesWithdrawalPolicy(policyInput());
    const suspicious = flags.filter((f) => f.severity === "SUSPICIOUS").map((f) => f.code);
    expect(suspicious).toEqual(expect.arrayContaining(["OWNER_DENIAL", "FLAGGED_VISITS", "ACCOUNT_SHARED", "LEADERBOARD_EXCLUDED"]));
  });

  it("flags a payout account registered to someone else, but not a differently written own name", async () => {
    expect(await evaluateSalesWithdrawalPolicy(policyInput())).toEqual([]);
    m.db.user.findUnique.mockResolvedValue({ name: "Peter Lyimo", fullName: null });
    expect(codes(await evaluateSalesWithdrawalPolicy(policyInput()))).toContain("NAME_MISMATCH");
  });

  it("flags self-dealing on a property the partner is tied to", async () => {
    m.ownsProperty.mockResolvedValueOnce("The sales partner is paid into the same account as the property owner.");
    const flags = await evaluateSalesWithdrawalPolicy(policyInput());
    expect(flags.find((f) => f.code === "SELF_DEALING")?.severity).toBe("SUSPICIOUS");
  });

  it("reviews manual credits, frequent withdrawals, cancelled stays and a usual-size spike", async () => {
    m.db.salesPayoutRequest.count.mockImplementation(({ where }: any) => Promise.resolve(where.status === "PAID" ? 4 : 3));
    m.db.salesPayoutRequest.findMany.mockResolvedValue([{ netPaidAmount: 40000 }, { netPaidAmount: 50000 }, { netPaidAmount: 60000 }]);
    m.db.booking.findFirst.mockResolvedValue({ id: 900 });
    const flags = await evaluateSalesWithdrawalPolicy({
      ...policyInput(),
      commissions: [...COMMISSIONS, { id: 3, type: "MANUAL_ADJUSTMENT", commissionAmount: 10000, propertyId: null, sourceBookingId: null }],
    });
    expect(codes(flags)).toEqual(expect.arrayContaining(["FREQUENT_WITHDRAWALS", "AMOUNT_SPIKE", "MANUAL_CREDIT", "CANCELLED_BOOKING"]));
    expect(flags.every((f) => f.severity === "REVIEW")).toBe(true);
  });

  it("uses the shared risk scorer: CRITICAL is a fraud signal, other non-auto levels a review", async () => {
    m.assess.mockResolvedValueOnce({ level: "CRITICAL", flags: ["RECENT_ACCOUNT_CHANGE", "PAYEE_HAS_PRIOR_PAYOUT_ELSEWHERE"] });
    expect((await evaluateSalesWithdrawalPolicy(policyInput()))[0]).toMatchObject({ code: "RISK_CRITICAL", severity: "SUSPICIOUS" });
    m.assess.mockResolvedValueOnce({ level: "HIGH", flags: ["AMOUNT_AT_REVIEW_THRESHOLD"] });
    expect((await evaluateSalesWithdrawalPolicy(policyInput()))[0]).toMatchObject({ code: "RISK_REVIEW", severity: "REVIEW" });
  });

  it("keeps everything with a person while automatic sales payouts are off", async () => {
    m.db.systemSetting.findUnique.mockResolvedValue({ salesAutoPayoutEnabled: false, salesAutoPayoutMaxTzs: 500000 });
    expect(await evaluateSalesWithdrawalPolicy(policyInput())).toEqual([expect.objectContaining({ code: "AUTO_OFF", severity: "INFO" })]);
  });
});

describe("partnerMessage", () => {
  it("never names the fraud signal", () => {
    const text = partnerMessage("REVIEW", [{ code: "OWNER_DENIAL", severity: "SUSPICIOUS", message: "A property owner denied knowing this partner." }]);
    expect(text).not.toMatch(/owner|denied/i);
    expect(text).toMatch(/paused/);
  });
});

describe("startSalesWithdrawal", () => {
  it("refuses while the partner's withdrawals are frozen", async () => {
    m.db.salesPartnerProfile.findUnique.mockResolvedValue({ ...PARTNER, payoutHoldAt: NOW });
    await expect(startSalesWithdrawal(11, NOW)).rejects.toMatchObject({ code: "ON_HOLD" });
    expect(m.deliver).not.toHaveBeenCalled();
  });

  it("refuses right after a payout account change", async () => {
    m.db.payoutAccount.findFirst.mockResolvedValue({ ...ACCOUNT, destinationChangedAt: new Date(NOW.getTime() - 3600_000) });
    await expect(startSalesWithdrawal(11, NOW)).rejects.toMatchObject({ code: "ACCOUNT_RECENTLY_CHANGED" });
  });

  it("allows one withdrawal on its way at a time", async () => {
    m.db.salesPayoutRequest.findFirst.mockResolvedValue({ referenceNumber: "SP-2026-11-AAA" });
    await expect(startSalesWithdrawal(11, NOW)).rejects.toMatchObject({ code: "OPEN_WITHDRAWAL" });
  });

  it("sends a code bound to the earnings, total and account", async () => {
    m.db.salesPayoutChallenge.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 1, ...data }));
    const out = await startSalesWithdrawal(11, NOW);
    expect(out).toMatchObject({ total: 200000, count: 2, destination: "Vodacom ***456", channel: "SMS" });
    const saved = m.db.salesPayoutChallenge.create.mock.calls[0][0].data;
    expect(saved.fingerprint).toBe(salesWithdrawalFingerprint({ commissionIds: [1, 2], total: 200000, currency: "TZS", account: ACCOUNT }));
    expect(saved.codeHash).not.toMatch(/^\d{6}$/);
  });
});

describe("confirmSalesWithdrawal", () => {
  const challenge = () => ({
    id: 40, reference: "sw_abcdefghijklmnop", salesPartnerId: 11, usedAt: null, attempts: 0,
    expiresAt: new Date(NOW.getTime() + 60_000), commissionIds: [1, 2], currency: "TZS", payoutAccountId: 7,
    fingerprint: salesWithdrawalFingerprint({ commissionIds: [1, 2], total: 200000, currency: "TZS", account: ACCOUNT }),
    codeHash: "x", destinationMasked: "Vodacom ***456",
  });

  beforeEach(() => {
    m.db.salesPayoutChallenge.findUnique.mockResolvedValue(challenge());
    m.codeMatches.mockReturnValue(true);
    m.db.salesPayoutRequest.create.mockImplementation(({ data }: any) => Promise.resolve({ id: 77, referenceNumber: data.referenceNumber, requestedAmount: data.requestedAmount, status: data.status }));
    m.db.salesPayoutRequest.findUnique.mockResolvedValue({
      id: 77, status: "REQUESTED", lane: "AUTO", requestedAmount: 200000, requestedAt: NOW, payoutAccountId: 7,
      handoffAttempts: 0, referenceNumber: "SP-X", salesPartner: { id: 11, userId: 21, payoutHoldAt: null, status: "ACTIVE" },
    });
  });

  it("approves and queues a clean withdrawal with no admin", async () => {
    const out = await confirmSalesWithdrawal(11, "sw_abcdefghijklmnop", "123456", NOW);
    expect(out).toMatchObject({ lane: "AUTO", status: "PROCESSING", total: 200000 });
    expect(m.db.salesPayoutRequest.create.mock.calls[0][0].data).toMatchObject({ status: "REQUESTED", lane: "AUTO", payoutAccountId: 7 });
    expect(m.requestDisbursement).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "SALES_PAYOUT", sourceId: 77, payoutAccountId: 7 }));
    expect(m.approveAuto).toHaveBeenCalledWith(501);
  });

  it("freezes the partner and sends the payout to review on a fraud signal", async () => {
    m.db.salesOwnerConfirmation.findFirst.mockResolvedValue({ id: 3 });
    const out = await confirmSalesWithdrawal(11, "sw_abcdefghijklmnop", "123456", NOW);
    expect(out.lane).toBe("REVIEW");
    expect(m.db.salesPayoutRequest.create.mock.calls[0][0].data.status).toBe("UNDER_REVIEW");
    expect(m.db.salesPartnerProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payoutHoldAt: NOW }) }));
    expect(m.requestDisbursement).not.toHaveBeenCalled();
    expect(m.notifyAdmins).toHaveBeenCalledWith("sales_partner_payout_hold", expect.any(Object));
  });

  it("reviews without freezing for a normal check", async () => {
    m.db.salesPayoutRequest.count.mockImplementation(({ where }: any) => Promise.resolve(where.status === "PAID" ? 0 : 1));
    const out = await confirmSalesWithdrawal(11, "sw_abcdefghijklmnop", "123456", NOW);
    expect(out.lane).toBe("REVIEW");
    expect(m.db.salesPartnerProfile.update).not.toHaveBeenCalled();
  });

  it("kills the code when the earnings changed after it was sent", async () => {
    m.db.salesCommission.findMany.mockResolvedValue([COMMISSIONS[0]]);
    await expect(confirmSalesWithdrawal(11, "sw_abcdefghijklmnop", "123456", NOW)).rejects.toMatchObject({ code: "CHANGED" });
    expect(m.db.salesPayoutRequest.create).not.toHaveBeenCalled();
  });

  it("locks withdrawals and freezes the partner on the third wrong code", async () => {
    m.codeMatches.mockReturnValue(false);
    m.db.salesPartnerProfile.findUnique
      .mockResolvedValueOnce({ ...PARTNER })
      .mockResolvedValueOnce({ withdrawalOtpFailures: 3 });
    await expect(confirmSalesWithdrawal(11, "sw_abcdefghijklmnop", "000000", NOW)).rejects.toMatchObject({ code: "OTP_LOCKED" });
    expect(m.db.salesPartnerProfile.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ withdrawalOtpLockedAt: NOW, payoutHoldAt: NOW }),
    }));
  });
});

describe("startSalesAutoPayout", () => {
  it("sends to review when the account changed after the partner confirmed", async () => {
    m.db.salesPayoutRequest.findUnique.mockResolvedValue({
      id: 77, status: "REQUESTED", lane: "AUTO", requestedAmount: 200000, requestedAt: OLD, payoutAccountId: 7,
      handoffAttempts: 0, referenceNumber: "SP-X", salesPartner: { id: 11, userId: 21, payoutHoldAt: null, status: "ACTIVE" },
      reviewFlags: [],
    });
    m.db.payoutAccount.findUnique.mockResolvedValue({ ...ACCOUNT, isVerified: true, isActive: true, destinationChangedAt: NOW });
    expect(await startSalesAutoPayout(77, NOW)).toBe("REVIEW");
    expect(m.db.salesPayoutRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lane: "REVIEW", status: "UNDER_REVIEW" }),
    }));
    expect(m.requestDisbursement).not.toHaveBeenCalled();
  });

  it("finishes a half-done handoff without creating a second disbursement", async () => {
    m.db.salesPayoutRequest.findUnique.mockResolvedValue({
      id: 77, status: "APPROVED", lane: "AUTO", requestedAmount: 200000, requestedAt: NOW, payoutAccountId: 7,
      handoffAttempts: 1, referenceNumber: "SP-X", salesPartner: { id: 11, userId: 21, payoutHoldAt: null, status: "ACTIVE" },
    });
    m.db.disbursement.findFirst.mockResolvedValueOnce({ id: 501, status: "REQUESTED", releaseLane: null, payoutAccountId: 7 });
    expect(await startSalesAutoPayout(77, NOW)).toBe("QUEUED");
    expect(m.approveAuto).toHaveBeenCalledWith(501);
    expect(m.requestDisbursement).not.toHaveBeenCalled();
  });
});
