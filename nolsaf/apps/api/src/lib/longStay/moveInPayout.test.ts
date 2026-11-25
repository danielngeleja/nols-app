import { describe, expect, it, vi } from "vitest";
import { autoConfirmMoveIns, balanceMismatch, confirmMoveIn, ensureMoveInDay, openDispute } from "./moveIn.js";
import { approveTenancyPayout, landlordPayoutOf, markTenancyPayoutPaid, recordManualPayout, tenancyPayoutSource } from "./payout.js";

const NOW = new Date("2027-01-01T12:00:00Z");
const base = {
  id: 1, publicRef: "tn_abcdefghijklmnopqrstuv", tenantId: 20, landlordId: 3, propertyId: 9,
  status: "MOVE_IN", version: 8, currency: "TZS", balanceDue: 7_500_000, monthlyRent: 1_500_000, paidAmount: 1_860_000,
  moveInDate: new Date("2027-01-01T00:00:00Z"), landlordConfirmedAt: null, tenantConfirmedAt: null,
  landlordBalanceAmount: null, tenantBalanceAmount: null, payoutStatus: "HELD",
  termsSnapshot: { landlordPayout: 1_050_000 },
};

function db(row: any = base, over: Record<string, any> = {}) {
  return {
    tenancy: { updateMany: vi.fn(async () => ({ count: 1 })), findUnique: vi.fn(async () => row), findMany: vi.fn(async () => [row]) },
    tenancyEvent: { create: vi.fn(), count: vi.fn(async () => 0) },
    payoutAccount: { findMany: vi.fn(async () => [{ id: 44 }]) },
    tenancyClaim: { findMany: vi.fn(async () => []), update: vi.fn() },
    ...over,
  } as any;
}

describe("move-in confirmation", () => {
  it("lets the home when both sides confirm the lease balance", async () => {
    const both = { ...base, version: 9, landlordConfirmedAt: NOW, tenantConfirmedAt: NOW, landlordBalanceAmount: 7_500_000, tenantBalanceAmount: 7_500_000 };
    const d = db(both);
    const result = await confirmMoveIn(d, { ...base, landlordConfirmedAt: NOW, landlordBalanceAmount: 7_500_000 }, "TENANT", 20, { balanceAmount: 7_500_000, method: "BANK", keysReceived: true, matchesListing: true }, NOW);
    expect(result).toEqual({ let: true, mismatch: false });
    const move = d.tenancy.updateMany.mock.calls[1][0];
    expect(move.data).toMatchObject({ status: "ACTIVE", moveInConfirmedBy: "BOTH", balanceMismatch: false, payoutStatus: "READY" });
  });

  it("holds the payout for review when a confirmed balance differs from the lease", async () => {
    const both = { ...base, version: 9, landlordConfirmedAt: NOW, tenantConfirmedAt: NOW, landlordBalanceAmount: 6_000_000, tenantBalanceAmount: 7_500_000 };
    const d = db(both);
    const result = await confirmMoveIn(d, { ...base, landlordConfirmedAt: NOW, landlordBalanceAmount: 6_000_000 }, "TENANT", 20, { balanceAmount: 7_500_000, method: "BANK", keysReceived: true, matchesListing: true }, NOW);
    expect(result.mismatch).toBe(true);
    expect(d.tenancy.updateMany.mock.calls[1][0].data).toMatchObject({ payoutStatus: "REVIEW", balanceMismatch: true });
  });

  it("refuses before move-in day, twice from the same side, or with a silly amount", async () => {
    await expect(confirmMoveIn(db(), { ...base, status: "RESERVED" }, "LANDLORD", 3, { balanceAmount: 1, method: "BANK" }, NOW)).rejects.toThrow(/move-in day/);
    await expect(confirmMoveIn(db(), { ...base, landlordConfirmedAt: NOW }, "LANDLORD", 3, { balanceAmount: 1, method: "BANK" }, NOW)).rejects.toThrow(/already/);
    await expect(confirmMoveIn(db(), base, "LANDLORD", 3, { balanceAmount: 999_999_999, method: "BANK" }, NOW)).rejects.toThrow(/far above/);
    await expect(confirmMoveIn(db(), base, "LANDLORD", 3, { balanceAmount: 100.5, method: "BANK" }, NOW)).rejects.toThrow(/as it was paid/);
  });

  it("opens move-in day for a reserved tenancy whose date has come", async () => {
    const d = db({ ...base, status: "MOVE_IN" });
    await ensureMoveInDay(d, { ...base, status: "RESERVED" }, "2027-01-01");
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "MOVE_IN" });
    const later = db();
    await ensureMoveInDay(later, { ...base, status: "RESERVED" }, "2026-12-31");
    expect(later.tenancy.updateMany).not.toHaveBeenCalled();
  });

  it("knows a mismatch only from balances someone confirmed", () => {
    expect(balanceMismatch(base)).toBe(false);
    expect(balanceMismatch({ ...base, tenantBalanceAmount: 7_500_000 })).toBe(false);
    expect(balanceMismatch({ ...base, tenantBalanceAmount: 7_499_999 })).toBe(true);
  });
});

describe("disputes and silence", () => {
  it("a dispute freezes the tenancy and holds the payout", async () => {
    const d = db();
    await openDispute(d, { ...base, status: "ACTIVE", payoutStatus: "READY" }, "TENANT", 20, "The landlord kept the keys", NOW);
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "DISPUTED", payoutStatus: "REVIEW" });
    await expect(openDispute(db(), { ...base, status: "CANCELLED" }, "TENANT", 20, "too late to complain", NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("lets the home on one confirmation after 72 hours of silence", async () => {
    const one = { ...base, landlordConfirmedAt: new Date("2026-12-29T10:00:00Z"), landlordBalanceAmount: 7_500_000 };
    const d = db(one);
    expect(await autoConfirmMoveIns(d, NOW)).toEqual({ auto: 1, silent: 0 });
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ACTIVE", moveInConfirmedBy: "AUTO_LANDLORD" });
  });

  it("waits before 72 hours, and alerts once when nobody confirms for a week", async () => {
    const recent = db({ ...base, tenantConfirmedAt: new Date("2027-01-01T08:00:00Z") });
    expect(await autoConfirmMoveIns(recent, NOW)).toEqual({ auto: 0, silent: 0 });
    const alert = vi.fn(async () => undefined);
    const silent = db({ ...base, moveInDate: new Date("2026-12-20T00:00:00Z") });
    expect(await autoConfirmMoveIns(silent, NOW, alert)).toEqual({ auto: 0, silent: 1 });
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe("landlord payout", () => {
  const active = { ...base, status: "ACTIVE", payoutStatus: "READY" };

  it("is the frozen payout, never more than was paid or a month's rent", () => {
    expect(landlordPayoutOf(active)).toBe(1_050_000);
    expect(landlordPayoutOf({ ...active, paidAmount: 0 })).toBe(0);
    expect(landlordPayoutOf({ ...active, termsSnapshot: { landlordPayout: 9_000_000 } })).toBe(0);
  });

  it("approval requests a TENANCY disbursement once, to a verified mobile money account", async () => {
    const d = db();
    const request = vi.fn(async () => ({ id: 77 }));
    expect(await approveTenancyPayout(d, active, 1, request)).toEqual({ disbursementId: 77, recovered: 0, net: 1_050_000 });
    expect(d.tenancy.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 1, payoutStatus: "READY", version: 8 }, data: { payoutStatus: "APPROVED" } });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "TENANCY", sourceId: 1, payoutAccountId: 44 }));
  });

  it("refuses USD, a missing account, an unconfirmed move-in, and puts the status back if the ledger refuses", async () => {
    await expect(approveTenancyPayout(db(), { ...active, currency: "USD" }, 1, vi.fn())).rejects.toThrow(/USD/);
    await expect(approveTenancyPayout(db(active, { payoutAccount: { findMany: vi.fn(async () => []) } }), active, 1, vi.fn())).rejects.toThrow(/mobile money/);
    await expect(approveTenancyPayout(db(), { ...active, status: "MOVE_IN" }, 1, vi.fn())).rejects.toThrow(/not confirmed/);
    const d = db();
    await expect(approveTenancyPayout(d, active, 1, vi.fn(async () => { throw new Error("ledger said no"); }))).rejects.toThrow(/ledger said no/);
    expect(d.tenancy.updateMany.mock.calls[1][0]).toMatchObject({ where: { id: 1, payoutStatus: "APPROVED" }, data: { payoutStatus: "READY" } });
  });

  it("the ledger pays only an APPROVED TZS tenancy, and marks it released once", async () => {
    expect(await tenancyPayoutSource(db({ ...active, payoutStatus: "APPROVED" }), 1)).toMatchObject({ ok: true, payeeUserId: 3, amount: 1_050_000, currency: "TZS" });
    expect(await tenancyPayoutSource(db(active), 1)).toMatchObject({ ok: false });
    const d = db();
    expect(await markTenancyPayoutPaid(d, 1, 1_050_000, "NoLSAF-L-1", NOW)).toBe(true);
    expect(d.tenancy.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 1, payoutStatus: "APPROVED" }, data: { payoutStatus: "RELEASED" } });
  });

  it("records a bank payout by hand with its reference", async () => {
    const d = db();
    expect(await recordManualPayout(d, { ...active, currency: "USD", termsSnapshot: { landlordPayout: 3150 }, paidAmount: 5580, monthlyRent: 4500 }, 1, "CRDB-889", NOW)).toEqual({ amount: 3150, recovered: 0 });
    expect(d.tenancyEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ type: "PAYOUT_RECORDED" }) }));
  });
});
