import { describe, expect, it, vi } from "vitest";
import { cancelReserved, cancellationTerms, confirmMoveOut, giveNotice, startRenewal, sweepTenancyEndings } from "./lifecycle.js";
import { closeClaim, escalateOverdueClaims, openClaim, planClaimRecovery } from "./claims.js";
import { approveTenancyPayout, landlordPayoutOf } from "./payout.js";
import { longStayRevenueFigures } from "./revenueFigures.js";
import { termsToRow } from "./listing.js";

const reserved = {
  id: 1, publicRef: "tn_abcdefghijklmnopqrstuv", tenantId: 20, landlordId: 3, propertyId: 9, status: "RESERVED", version: 5,
  currency: "USD", monthlyRent: 4500, tenantFee: 1080, landlordCommission: 1350, bookingAmount: 5580, paidAmount: 5580,
  paidAt: new Date("2026-12-14T10:00:00Z"), moveInDate: new Date("2027-01-01T00:00:00Z"), endDate: new Date("2027-07-01T00:00:00Z"),
  termMonths: 6, payoutStatus: "HELD", termsSnapshot: { landlordPayout: 3150, listing: { noticePeriodDays: 30 } },
};

const renewListing = termsToRow({
  monthlyRent: 4500, currency: "USD", minTermMonths: 6, maxTermMonths: 12, upfrontMonths: 6, furnished: "FURNISHED",
  utilities: { water: "INCLUDED", electricity: "TENANT", internet: "TENANT", security: "INCLUDED", serviceCharge: "INCLUDED" },
  securityDepositMonths: 1, noticePeriodDays: 30, balanceMethods: ["BANK"], availableFrom: "2026-12-01",
} as any);

function db(over: Record<string, any> = {}) {
  return {
    tenancy: { updateMany: vi.fn(async () => ({ count: 1 })), findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null), create: vi.fn(async ({ data }: any) => ({ id: 2, ...data })) },
    tenancyEvent: { create: vi.fn(), count: vi.fn(async () => 0) },
    longStayLandlordGrant: { findUnique: vi.fn(async () => ({ enabledAt: new Date(), pausedAt: null })), update: vi.fn() },
    property: { findUnique: vi.fn(async () => ({ status: "APPROVED", rentalMode: "LONG_STAY", longStayListing: renewListing })) },
    tenancyClaim: { findMany: vi.fn(async () => []), update: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })), create: vi.fn(async ({ data }: any) => ({ id: 1, ...data })) },
    payoutAccount: { findMany: vi.fn(async () => [{ id: 44 }]) },
    ...over,
  } as any;
}

describe("cancellation after payment (section 6.4)", () => {
  it("more than 14 days out: tenant gets the first month back, NoLSAF keeps the fee", () => {
    expect(cancellationTerms(reserved, "TENANT", "2026-12-10")).toEqual({ by: "TENANT", daysToMoveIn: 22, refundToTenant: 4500, landlordPayout: 0, nolsafKeeps: 1080 });
  });

  it("14 days or less: landlord gets the first month less 5% (spec: USD 4,275), NoLSAF keeps fee + 225", () => {
    expect(cancellationTerms(reserved, "TENANT", "2026-12-25")).toEqual({ by: "TENANT", daysToMoveIn: 7, refundToTenant: 0, landlordPayout: 4275, nolsafKeeps: 1305 });
  });

  it("landlord cancels: everything back to the tenant", () => {
    expect(cancellationTerms(reserved, "LANDLORD", "2026-12-25")).toMatchObject({ refundToTenant: 5580, landlordPayout: 0, nolsafKeeps: 0 });
  });

  it("freezes the split on the tenancy and pauses a landlord after repeated cancellations", async () => {
    const d = db({ tenancyEvent: { create: vi.fn(), count: vi.fn(async () => 2) } });
    const result = await cancelReserved(d, reserved, "LANDLORD", 3, "Sold the house", "2026-12-25");
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "CANCELLED", payoutStatus: "REFUND_DUE", termsSnapshot: { cancellation: { refundToTenant: 5580 } } });
    expect(result.landlordPaused).toBe(true);
    expect(d.longStayLandlordGrant.update).toHaveBeenCalled();
  });

  it("only from a paid reservation", async () => {
    await expect(cancelReserved(db(), { ...reserved, status: "MOVE_IN" }, "TENANT", 20, "changed plans")).rejects.toMatchObject({ status: 409 });
  });

  it("revenue: what NoLSAF keeps is earned at the cancellation; a full refund earns nothing", () => {
    const at = new Date("2026-12-25T08:00:00Z");
    const late = { ...reserved, status: "CANCELLED", cancelledAt: at, termsSnapshot: { ...reserved.termsSnapshot, cancellation: cancellationTerms(reserved, "TENANT", "2026-12-25") } };
    expect(longStayRevenueFigures(late)).toMatchObject({ at, gross: 5580, commission: 1305, partnerNet: 4275, kind: "CANCELLATION" });
    expect(landlordPayoutOf({ ...late, payoutStatus: "READY" })).toBe(4275);
    const byLandlord = { ...late, termsSnapshot: { cancellation: cancellationTerms(reserved, "LANDLORD", "2026-12-25") } };
    expect(longStayRevenueFigures(byLandlord)).toBeNull();
  });
});

describe("notice, move-out, overdue, renewal", () => {
  const active = { ...reserved, status: "ACTIVE", moveInConfirmedAt: new Date("2027-01-02T00:00:00Z") };

  it("notice needs the lease's notice period, a date inside the lease, and a ground from the landlord", async () => {
    await expect(giveNotice(db(), active, "TENANT", 20, { leaveOn: "2027-03-10" }, "2027-03-01")).rejects.toThrow(/30 days/);
    await expect(giveNotice(db(), active, "TENANT", 20, { leaveOn: "2027-08-01" }, "2027-03-01")).rejects.toThrow(/already ends/);
    await expect(giveNotice(db(), active, "LANDLORD", 3, { leaveOn: "2027-04-15" }, "2027-03-01")).rejects.toThrow(/lawful ground/);
    const d = db();
    await giveNotice(d, active, "TENANT", 20, { leaveOn: "2027-04-19" }, "2027-03-20");
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ENDING", noticeGivenBy: "TENANT", endDate: new Date("2027-04-19T00:00:00Z") });
  });

  it("move-out is confirmed by the landlord from the end date only", async () => {
    await expect(confirmMoveOut(db(), active, 3, "2027-06-30")).rejects.toThrow(/from the end date/);
    const d = db();
    await confirmMoveOut(d, active, 3, "2027-07-01");
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "ENDED" });
  });

  it("marks overdue after 3 days and sends one renewal reminder in the notice window", async () => {
    const late = { ...active, endDate: new Date("2027-06-01T00:00:00Z") };
    const soon = { ...active, id: 2, endDate: new Date("2027-07-01T00:00:00Z") };
    const d = db({ tenancy: { findMany: vi.fn().mockResolvedValueOnce([late]).mockResolvedValueOnce([soon]), updateMany: vi.fn(async () => ({ count: 1 })) } });
    expect(await sweepTenancyEndings(d, "2027-06-05")).toEqual({ overdue: 1, reminded: 1 });
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ status: "OVERDUE" });
  });

  it("renewal reserves the next term from the end date, within 60 days of it", async () => {
    await expect(startRenewal(db(), active, 20, null, "2027-03-01")).rejects.toThrow(/You can renew from/);
    await expect(startRenewal(db(), active, 20, 3, "2027-06-01")).rejects.toThrow(/Choose a term/);
    const d = db();
    const result = await startRenewal(d, active, 20, 12, "2027-06-01");
    expect(result.existing).toBe(false);
    expect(d.tenancy.create.mock.calls[0][0].data).toMatchObject({ status: "OFFERED", tenantId: 20, landlordId: 3, propertyId: 9, termMonths: 12, moveInDate: new Date("2027-07-01T00:00:00Z"), endDate: new Date("2028-07-01T00:00:00Z") });
  });
});

describe("claims and recovery (section 6.6)", () => {
  const moved = { ...reserved, status: "ENDED", moveInConfirmedAt: new Date("2027-01-02T00:00:00Z") };

  it("an admin opens a claim within the lease's rent, due in 14 days", async () => {
    const now = new Date("2027-05-01T00:00:00Z");
    const claim = await openClaim(db(), moved, 1, { kind: "UNUSED_RENT", amount: 9000, reason: "May and June prepaid, tenant left in April" }, now);
    expect(claim).toMatchObject({ amount: 9000, status: "OPEN", dueAt: new Date("2027-05-15T00:00:00Z") });
    await expect(openClaim(db(), moved, 1, { kind: "OTHER", amount: 999999, reason: "far too much money" }, now)).rejects.toThrow(/within the lease/);
    await expect(openClaim(db(), { ...moved, moveInConfirmedAt: null }, 1, { kind: "OTHER", amount: 10, reason: "not moved in at all" }, now)).rejects.toMatchObject({ status: 409 });
  });

  it("past due: pauses the landlord and starts recovery, once", async () => {
    const d = db({ tenancyClaim: { findMany: vi.fn(async () => [{ id: 4, landlordId: 3, amount: 9000, currency: "USD" }]), updateMany: vi.fn(async () => ({ count: 1 })) } });
    expect(await escalateOverdueClaims(d, new Date())).toEqual({ escalated: 1 });
    expect(d.longStayLandlordGrant.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ pauseReason: expect.stringMatching(/claim/) }) }));
  });

  it("recovers oldest claims first from the next payout, in the same currency", async () => {
    const d = db({ tenancyClaim: { findMany: vi.fn(async () => [{ id: 4, amount: 2000, recoveredAmount: 0 }, { id: 5, amount: 5000, recoveredAmount: 1000 }]) } });
    expect(await planClaimRecovery(d, 3, "USD", 3150, 1)).toEqual({ total: 3150, allocations: [{ claimId: 4, amount: 2000, remainingAfter: 0 }, { claimId: 5, amount: 1150, remainingAfter: 2850 }] });
  });

  it("a payout covering only claims sends nothing to the landlord and records the deduction", async () => {
    const d = db({ tenancyClaim: { findMany: vi.fn(async () => [{ id: 4, amount: 9_999_999, recoveredAmount: 0 }]), update: vi.fn() } });
    const tzs = { ...moved, status: "ACTIVE", currency: "TZS", monthlyRent: 1_500_000, paidAmount: 1_860_000, payoutStatus: "READY", termsSnapshot: { landlordPayout: 1_050_000 } };
    const request = vi.fn();
    expect(await approveTenancyPayout(d, tzs, 1, request)).toEqual({ disbursementId: null, recovered: 1_050_000, net: 0 });
    expect(request).not.toHaveBeenCalled();
    expect(d.tenancy.updateMany.mock.calls[0][0].data).toMatchObject({ payoutStatus: "RELEASED", payoutDeduction: 1_050_000, payoutAmount: 0 });
  });

  it("closing: settled directly, waived, or passed to the tenant after recovery", async () => {
    await expect(closeClaim(db(), { id: 4, status: "OPEN", recoveredAmount: 500 }, "SETTLED", "paid directly")).rejects.toThrow(/already recovered/);
    await expect(closeClaim(db(), { id: 4, status: "OPEN", recoveredAmount: 0 }, "PAID_TO_TENANT", "sent")).rejects.toThrow(/fully recovered/);
    await expect(closeClaim(db(), { id: 4, status: "SETTLED", recoveredAmount: 0 }, "WAIVED", "dropping it")).rejects.toThrow(/already closed/);
  });
});
