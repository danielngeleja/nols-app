import { beforeEach, describe, expect, it } from "vitest";
import { LONG_STAY_SHARE_HOLD_DAYS, accrueLongStaySalesCommission } from "../salesCommission.js";
import { syncLongStaySalesCommission } from "./salesShare.js";

const MOVED_IN = new Date("2026-12-01T09:00:00Z");
const PARTNER = { id: 5, userId: 500 };

/** A 12-month lease at TSh 500,000: NoLSAF keeps 250,000 + 125,000 at move-in. */
function tenancy(overrides: Record<string, unknown> = {}) {
  return {
    id: 7, publicRef: "tn_abc", propertyId: 30, tenantId: 900, currency: "TZS",
    bookingAmount: 625_000, tenantFee: 125_000, landlordCommission: 250_000, monthlyRent: 500_000,
    moveInConfirmedAt: MOVED_IN, paidAt: new Date("2026-11-20T09:00:00Z"), cancelledAt: null,
    payoutStatus: "READY", termsSnapshot: {},
    ...overrides,
  };
}

function fakeDb(state: { tenancy: any; ownerId?: number; tenant?: { email?: string; phone?: string }; partnerPhone?: string; attributionOpen?: boolean }) {
  const commissions: any[] = [];
  const audits: any[] = [];
  const db: any = {
    commissions,
    audits,
    tenancy: { findUnique: async () => state.tenancy },
    salesCommission: {
      // Copies, like Prisma: a later update must not change a row already read.
      findUnique: async ({ where }: any) => {
        const row = where.sourceKey ? commissions.find((c) => c.sourceKey === where.sourceKey) : commissions.find((c) => c.id === where.id);
        return row ? { ...row } : null;
      },
      create: async ({ data }: any) => {
        if (commissions.some((c) => c.sourceKey === data.sourceKey)) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row = { id: commissions.length + 1, payoutItem: null, reversalOfId: null, ...data };
        commissions.push(row);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = commissions.find((c) => c.id === where.id && c.status === where.status);
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    propertySalesAttribution: {
      findUnique: async () => state.attributionOpen === false ? null : {
        id: 11, status: "ACTIVE", salesPartnerId: PARTNER.id, contractId: 21,
        commissionStartsAt: new Date("2026-01-01T00:00:00Z"), commissionEndsAt: null,
        contract: { id: 21, status: "ACTIVE", salesPartnerId: PARTNER.id, startsAt: new Date("2026-01-01T00:00:00Z"), expiresAt: new Date("2028-01-01T00:00:00Z"), marketplaceRevenueRate: 20 },
        salesPartner: { userId: PARTNER.userId },
      },
    },
    systemSetting: { findUnique: async () => ({ taxPercent: 18 }) },
    salesPartnerProfile: { findUnique: async () => ({ userId: PARTNER.userId, phone: state.partnerPhone ?? "255700000001", payoutAccount: null, user: { email: "partner@example.com", phone: null } }) },
    user: { findUnique: async () => state.tenant ?? { email: "tenant@example.com", phone: "255711111111" } },
    property: { findUnique: async () => ({ owner: { id: state.ownerId ?? 600, email: "owner@example.com", phone: "255722222222" } }) },
    payoutAccount: { findMany: async () => [] },
    auditLog: { create: async ({ data }: any) => { audits.push(data); return data; } },
  };
  db.$transaction = async (work: any) => work(db);
  return db;
}

describe("long-stay Sales Partner share", () => {
  let db: any;
  beforeEach(() => { db = fakeDb({ tenancy: tenancy() }); });

  it("earns the contract rate on NoLSAF's net fees at move-in, withdrawable after 14 days", async () => {
    const result = await accrueLongStaySalesCommission(db, 7);
    expect(result.created).toBe(true);
    const row = db.commissions[0];
    expect(row).toMatchObject({
      type: "LONG_STAY_TENANCY", status: "VALIDATING", sourceKey: "TENANCY:7",
      salesPartnerId: PARTNER.id, propertyId: 30, grossAmount: 375_000, commissionRate: 20, currency: "TZS",
    });
    // 375,000 is tax-inclusive at 18%: net 317,796.61, 20% of it.
    expect(row.eligibleNetRevenue).toBeCloseTo(317_796.61, 2);
    expect(row.commissionAmount).toBeCloseTo(63_559.32, 2);
    expect(row.earnedAt).toEqual(MOVED_IN);
    expect(row.eligibleAt.getTime() - MOVED_IN.getTime()).toBe(LONG_STAY_SHARE_HOLD_DAYS * 86_400_000);
    expect(db.audits[0]).toMatchObject({ action: "SALES_COMMISSION_ACCRUE" });
  });

  it("is earned once per tenancy, however often it is synced", async () => {
    await syncLongStaySalesCommission(db, 7);
    await syncLongStaySalesCommission(db, 7);
    expect(db.commissions).toHaveLength(1);
  });

  it("earns nothing before move-in or on a refunded first month", async () => {
    db = fakeDb({ tenancy: tenancy({ moveInConfirmedAt: null }) });
    expect(await accrueLongStaySalesCommission(db, 7)).toMatchObject({ created: false, skippedReason: "NOT_MOVED_IN" });
    db = fakeDb({ tenancy: tenancy({ payoutStatus: "REFUND_DUE" }) });
    expect(await accrueLongStaySalesCommission(db, 7)).toMatchObject({ created: false, skippedReason: "NOT_MOVED_IN" });
  });

  it("earns nothing without an open attribution", async () => {
    db = fakeDb({ tenancy: tenancy(), attributionOpen: false });
    expect(await accrueLongStaySalesCommission(db, 7)).toMatchObject({ created: false, skippedReason: "NO_ACTIVE_ATTRIBUTION" });
  });

  it("records but never pays a share when the partner is the tenant (same phone)", async () => {
    db = fakeDb({ tenancy: tenancy(), tenant: { email: "other@example.com", phone: "0700000001" } });
    await accrueLongStaySalesCommission(db, 7);
    expect(db.commissions[0]).toMatchObject({ status: "REVERSED", reversalReason: "The partner is the tenant on this lease." });
  });

  it("records but never pays a share on the partner's own home", async () => {
    db = fakeDb({ tenancy: tenancy(), ownerId: PARTNER.userId });
    await accrueLongStaySalesCommission(db, 7);
    expect(db.commissions[0].status).toBe("REVERSED");
    expect(db.commissions[0].reversalReason).toMatch(/property owner/);
  });

  it("reverses the share when the first month is later refunded", async () => {
    await syncLongStaySalesCommission(db, 7);
    db.tenancy.findUnique = async () => tenancy({ payoutStatus: "REFUNDED" });
    expect(await syncLongStaySalesCommission(db, 7)).toBe("REVERSED");
    expect(db.commissions[0]).toMatchObject({ status: "REVERSED" });
    expect(db.commissions[0].reversalReason).toMatch(/refunded/);
  });

  it("offsets an already paid share against the next payout", async () => {
    await syncLongStaySalesCommission(db, 7);
    db.commissions[0].status = "PAID";
    db.tenancy.findUnique = async () => tenancy({ payoutStatus: "REFUNDED" });
    expect(await syncLongStaySalesCommission(db, 7)).toBe("OFFSET");
    const offset = db.commissions.find((c: any) => c.reversalOfId === 1);
    expect(offset.commissionAmount).toBeCloseTo(-63_559.32, 2);
  });
});
