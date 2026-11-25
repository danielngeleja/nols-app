import { describe, expect, it } from "vitest";
import { assessRisk, balanceState, ledgerRow, paymentStage, type LedgerContext } from "./paymentLedger.js";

const NOW = new Date("2026-12-01T09:00:00Z");
const ctx = (over: Partial<LedgerContext> = {}): LedgerContext => ({
  now: NOW,
  cardFeePercent: 2.9,
  landlordsPaidBefore: new Set([3]),
  landlordsPaused: new Set(),
  landlordOpenClaims: new Map(),
  tenantIdExpiry: new Map(),
  ...over,
});
const base = {
  publicRef: "tn_x", status: "RESERVED", payoutStatus: "HELD", currency: "USD", landlordId: 3, tenantId: 20,
  monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, tenantFee: 1080, landlordCommission: 1350,
  bookingAmount: 5580, paidAmount: 5580, paidAt: new Date("2026-11-20T10:00:00Z"), paymentRef: "LST-1",
  balanceDue: 22500, moveInDate: new Date("2026-12-10T00:00:00Z"), endDate: new Date("2027-06-10T00:00:00Z"),
};

describe("payment ledger", () => {
  it("splits the card payment as the spec does (USD 4,500 x 6)", () => {
    const row = ledgerRow(base, ctx(), 3150);
    expect(row.booking).toMatchObject({ expected: 5580, paid: 5580, method: "Card", reference: "LST-1" });
    expect(row.split).toMatchObject({ tenantFee: 1080, landlordCommission: 1350, cardFee: 161.82, landlordPayout: 3150 });
    expect(row.split.nolsafKeeps).toBe(2268.18);
    expect(row.remaining).toEqual({ months: 0, amount: 0, firstDueOn: null, paidTo: null });
    expect(row.stage).toBe("HELD");
    // USD 5,580 is a large single card payment: worth a look, nothing else wrong.
    expect(row.risk.flags.map((f) => f.code)).toEqual(["LARGE_AMOUNT"]);
    expect(ledgerRow({ ...base, monthlyRent: 1000, bookingAmount: 1240, paidAmount: 1240, tenantFee: 240, landlordCommission: 300 }, ctx(), 700).risk.level).toBe("LOW");
  });

  it("shows what remains after the prepaid months and when it starts", () => {
    const row = ledgerRow({ ...base, termMonths: 12, upfrontMonths: 6 }, ctx(), 2250);
    expect(row.remaining).toMatchObject({ months: 6, amount: 27000, firstDueOn: "2027-06-10" });
  });

  it("flags money problems as high risk, with reasons", () => {
    const r = assessRisk({ ...base, paidAmount: 5000, balanceMismatch: true, status: "DISPUTED" }, ctx());
    expect(r.level).toBe("HIGH");
    expect(r.flags.map((f) => f.code)).toEqual(expect.arrayContaining(["AMOUNT_MISMATCH", "BALANCE_MISMATCH", "DISPUTED"]));
  });

  it("flags a first payout, an expiring ID and a late payment as medium", () => {
    const first = assessRisk({ ...base, landlordId: 9 }, ctx());
    expect(first.flags.map((f) => f.code)).toContain("FIRST_PAYOUT");
    const id = assessRisk(base, ctx({ tenantIdExpiry: new Map([[20, "2027-01-01"]]) }));
    expect(id.flags.map((f) => f.code)).toContain("ID_EXPIRES");
    const late = assessRisk({ ...base, status: "AWAITING_PAYMENT", paidAt: null, paidAmount: null, paymentDueAt: new Date("2026-11-30T09:00:00Z") }, ctx());
    expect(late).toMatchObject({ level: "MEDIUM" });
    expect(late.flags.map((f) => f.code)).toContain("PAYMENT_LATE");
  });

  it("reads the move-in balance from both sides", () => {
    expect(balanceState({ ...base, status: "RESERVED" })).toBe("NOT_DUE");
    expect(balanceState({ ...base, status: "MOVE_IN", landlordConfirmedAt: new Date() })).toBe("ONE_SIDE");
    expect(balanceState({ ...base, status: "ACTIVE", landlordConfirmedAt: new Date(), tenantConfirmedAt: new Date() })).toBe("CONFIRMED");
    expect(balanceState({ ...base, balanceMismatch: true })).toBe("MISMATCH");
  });

  it("knows where the money is", () => {
    expect(paymentStage({ ...base, payoutStatus: "REFUND_DUE" })).toBe("REFUND_DUE");
    expect(paymentStage({ ...base, payoutStatus: "READY" })).toBe("TO_RELEASE");
    expect(paymentStage({ ...base, payoutStatus: "RELEASED" })).toBe("RELEASED");
    expect(paymentStage({ ...base, paidAt: null, paidAmount: null, status: "AWAITING_PAYMENT", payoutStatus: "NONE", paymentDueAt: new Date(Date.now() + 3_600_000) })).toBe("AWAITING");
  });

  it("counts a reserved tenancy as paid even when only its status or amount says so", () => {
    expect(paymentStage({ ...base, paidAt: null })).toBe("HELD");
    const row = ledgerRow({ ...base, paidAt: null, paidAmount: null }, ctx(), 3150);
    expect(row.booking.paid).toBe(5580);
    expect(row.stage).toBe("HELD");
  });
});
