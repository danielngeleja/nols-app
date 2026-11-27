import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@nolsaf/prisma", () => ({ prisma: {} }));
vi.mock("./salesLeaderboard.js", () => ({ computeBoard: vi.fn(async () => []), DEFAULT_MONTHLY_TARGET: 5, monthKey: () => "2026-11", monthRange: () => ({ start: new Date(0), end: new Date() }) }));
vi.mock("./salesTeamHealth.js", () => ({ computeTeamHealth: vi.fn(async () => []) }));

import { matchRegionId, overrideBaseReady, overrideSourceKey, recommend, runRegionalOverrides, setRegionLead } from "./salesRegions.js";

const REGIONS = [
  { id: 1, areas: ["dar es salaam", "dar", "dsm"] },
  { id: 2, areas: ["arusha", "kilimanjaro", "manyara"] },
  { id: 3, areas: ["zanzibar", "unguja", "pemba"] },
];
const NOW = new Date("2026-11-26T09:00:00Z");
const contract = { id: 70, status: "ACTIVE", startsAt: new Date("2026-01-01"), expiresAt: new Date("2028-01-01") };

describe("matchRegionId (old free-text regions)", () => {
  it.each([
    ["Dar es Salaam", 1], ["DSM", 1], ["Kinondoni, Dar", 1], ["Arusha Region", 2], ["kilimanjaro", 2], ["Unguja", 3],
  ])("%s -> region %s", (text, id) => expect(matchRegionId(text, REGIONS)).toBe(id));

  it("leaves unclear or unknown text for an admin", () => {
    expect(matchRegionId("Darajani", REGIONS)).toBeNull(); // not the word "dar"
    expect(matchRegionId("Dar and Arusha", REGIONS)).toBeNull(); // two regions
    expect(matchRegionId("", REGIONS)).toBeNull();
    expect(matchRegionId("Mwanza", REGIONS)).toBeNull();
  });
});

function overrideDb(opts: { baseStatus?: string; leadStatus?: string; overrides?: any[] } = {}) {
  const commissions: any[] = [
    { id: 501, salesPartnerId: 11, propertyId: 9, commissionAmount: 100_000, currency: "TZS", earnedAt: NOW, eligibleAt: new Date("2026-12-26"), status: opts.baseStatus ?? "VALIDATING", type: "MARKETPLACE_BOOKING" },
    ...(opts.overrides ?? []),
  ];
  const db: any = {
    commissions,
    salesRegion: { findMany: async () => [{ id: 1, name: "Dar es Salaam", leadPartnerId: 10, leadSince: new Date("2026-11-01"), overridePercent: 5, status: "ACTIVE" }] },
    salesPartnerProfile: {
      findUnique: async () => ({ id: 10, status: opts.leadStatus ?? "ACTIVE", contracts: [contract] }),
      findMany: async () => [{ id: 11 }],
    },
    salesCommission: {
      findMany: async ({ where }: any) => {
        if (where.sourceKey) return commissions.filter((c) => where.sourceKey.in.includes(c.sourceKey));
        if (where.type === "REGIONAL_OVERRIDE") return commissions.filter((c) => c.type === "REGIONAL_OVERRIDE" && !["REVERSED", "CANCELLED"].includes(c.status));
        if (where.id) return commissions.filter((c) => where.id.in.includes(c.id) && where.status.in.includes(c.status));
        return commissions.filter((c) => where.salesPartnerId.in.includes(c.salesPartnerId) && where.type.in.includes(c.type) && !where.status.notIn.includes(c.status));
      },
      findUnique: async ({ where }: any) => {
        const row = commissions.find((c) => c.id === where.id);
        return row ? { ...row, payoutItem: null } : null;
      },
      create: async ({ data }: any) => {
        if (commissions.some((c) => c.sourceKey === data.sourceKey)) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row = { id: 900 + commissions.length, reversalOfId: null, ...data };
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
    auditLog: { create: async () => ({}) },
  };
  db.$transaction = async (fn: any) => fn(db);
  return db;
}

describe("regional override", () => {
  it("pays the lead the override on a region partner's commission, once", async () => {
    const db = overrideDb();
    expect(await runRegionalOverrides(db, NOW)).toMatchObject({ accrued: 1 });
    await runRegionalOverrides(db, NOW);
    const overrides = db.commissions.filter((c: any) => c.type === "REGIONAL_OVERRIDE");
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({ salesPartnerId: 10, sourceKey: overrideSourceKey(501), commissionAmount: 5_000, status: "VALIDATING", contractId: 70 });
  });

  it("pays nothing when the lead is not active", async () => {
    const db = overrideDb({ leadStatus: "SUSPENDED" });
    expect(await runRegionalOverrides(db, NOW)).toMatchObject({ accrued: 0 });
  });

  it("waits for the base to be withdrawable, and reverses with it", async () => {
    const db = overrideDb();
    await runRegionalOverrides(db, NOW);
    expect(await overrideBaseReady(db, overrideSourceKey(501))).toBe(false);
    db.commissions[0].status = "ELIGIBLE";
    expect(await overrideBaseReady(db, overrideSourceKey(501))).toBe(true);
    db.commissions[0].status = "REVERSED";
    expect(await runRegionalOverrides(db, NOW)).toMatchObject({ reversed: 1 });
    expect(db.commissions.find((c: any) => c.type === "REGIONAL_OVERRIDE").status).toBe("REVERSED");
  });
});

describe("setRegionLead", () => {
  const leadDb = (partner: any, elsewhere: any = null) => ({
    salesPartnerProfile: { findUnique: async () => partner, update: vi.fn(async () => ({})) },
    salesRegion: { findFirst: async () => elsewhere, findUnique: async () => ({ leadPartnerId: null }), update: vi.fn(async () => ({})) },
  });

  it("appoints an active partner with a contract", async () => {
    const db = leadDb({ id: 10, status: "ACTIVE", contracts: [contract] });
    expect(await setRegionLead(db, 1, "nsa-dar-0010", NOW)).toBe(10);
    expect(db.salesRegion.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { leadPartnerId: 10, leadSince: NOW } });
  });

  it("refuses inactive partners and a second region", async () => {
    await expect(setRegionLead(leadDb({ id: 10, status: "SUSPENDED", contracts: [contract] }), 1, "NSA-DAR-0010", NOW)).rejects.toMatchObject({ status: 409 });
    await expect(setRegionLead(leadDb({ id: 10, status: "ACTIVE", contracts: [contract] }, { name: "Zanzibar" }), 1, "NSA-DAR-0010", NOW)).rejects.toThrow(/already leads Zanzibar/);
    await expect(setRegionLead(leadDb(null), 1, "NSA-XXX-9999", NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("recommend", () => {
  const region = { id: 1, leadPartnerId: 10 };
  let db: any;
  beforeEach(() => {
    db = {
      longStayAccessRequest: { findUnique: async ({ where }: any) => (where.publicRef === "lr_ok" ? { id: 5, salesPartnerId: 11, status: "PENDING" } : where.publicRef === "lr_mine" ? { id: 6, salesPartnerId: 10, status: "PENDING" } : null) },
      salesPayoutRequest: { findUnique: async () => ({ id: 7, salesPartnerId: 12, status: "REQUESTED" }) },
      salesPartnerProfile: { findUnique: async ({ where }: any) => ({ regionId: where.id === 12 ? 2 : 1 }) },
      salesRegionRecommendation: { create: vi.fn(async () => ({})) },
    };
  });

  it("records a recommendation for a region partner's waiting item", async () => {
    await recommend(db, region, { subjectType: "LONG_STAY_REQUEST", ref: "lr_ok", note: null });
    expect(db.salesRegionRecommendation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ subjectType: "LONG_STAY_REQUEST", subjectId: 5, leadPartnerId: 10 }) });
  });

  it("refuses the lead's own request, other regions and closed items", async () => {
    await expect(recommend(db, region, { subjectType: "LONG_STAY_REQUEST", ref: "lr_mine", note: null })).rejects.toMatchObject({ status: 403 });
    await expect(recommend(db, region, { subjectType: "SALES_PAYOUT", ref: "SP-1", note: null })).rejects.toThrow(/not in your region/);
    await expect(recommend(db, region, { subjectType: "LONG_STAY_REQUEST", ref: "lr_gone", note: null })).rejects.toMatchObject({ status: 404 });
  });
});
