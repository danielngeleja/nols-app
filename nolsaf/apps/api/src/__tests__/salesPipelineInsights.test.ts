/**
 * The lead pulse and the earnings summary behind the redesigned sales pages:
 * focus filters agree with the pulse, closed leads never count as overdue,
 * and earnings never leave the server with a row id or idempotency key.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import leadsRouter from "../routes/sales.leads.js";
import earningsRouter from "../routes/sales.earnings.js";

const h = vi.hoisted(() => {
  const db: any = {
    salesLead: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    salesCommission: { count: vi.fn(), findMany: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
  };
  return { db };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 5, role: "USER" }; next(); },
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => { req.salesPartner = { partnerId: 11 }; next(); },
  requireActivePartnerContract: (_req: any, _res: any, next: any) => next(),
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass, limitSalesPropertyRead: pass };
});

const app = express();
app.use(express.json());
app.use("/api/sales", leadsRouter);
app.use("/api/sales", earningsRouter);

const DAY = 86_400_000;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("lead pulse", () => {
  it("counts stages, open leads and builds a worklist without ids", async () => {
    const now = Date.now();
    h.db.salesLead.groupBy.mockResolvedValue([
      { status: "NEW", _count: { id: 4 } },
      { status: "CONTACTED", _count: { id: 2 } },
      { status: "CONVERTED", _count: { id: 3 } },
      { status: "LOST", _count: { id: 1 } },
    ]);
    h.db.salesLead.count.mockResolvedValue(2);
    const lead = (id: number, extra: any) => ({ id, propertyName: `Lodge ${id}`, location: null, status: "CONTACTED", nextFollowUpAt: null, protectionExpiresAt: null, updatedAt: new Date(now), ...extra });
    h.db.salesLead.findMany
      .mockResolvedValueOnce([lead(1, { nextFollowUpAt: new Date(now - 3 * DAY) })]) // overdue
      .mockResolvedValueOnce([lead(2, { protectionExpiresAt: new Date(now + 1 * DAY) }), lead(1, { protectionExpiresAt: new Date(now + 5 * DAY) })]) // protection
      .mockResolvedValueOnce([]); // stale

    const res = await request(app).get("/api/sales/leads/pulse");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(10);
    expect(res.body.open).toBe(6);
    expect(res.body.byStage.NEW).toBe(4);
    // Protection ending within 3 days beats an overdue follow-up; each lead appears once.
    expect(res.body.next.map((n: any) => n.reason)).toEqual(["PROTECTION", "OVERDUE"]);
    expect(res.body.next).toHaveLength(2);
    expect(JSON.stringify(res.body.next)).not.toMatch(/"id"/);
    expect(res.body.next[0].ref).toMatch(/^sl_/);
  });

  it("keeps closed leads out of the overdue filter", async () => {
    h.db.salesLead.count.mockResolvedValue(0);
    h.db.salesLead.findMany.mockResolvedValue([]);
    await request(app).get("/api/sales/leads").query({ followUp: "OVERDUE" });
    const where = h.db.salesLead.count.mock.calls[0][0].where;
    expect(where.status).toEqual({ notIn: ["CONVERTED", "LOST", "CANCELLED"] });
    expect(where.nextFollowUpAt.lt).toBeInstanceOf(Date);
    expect(where.salesPartnerId).toBe(11);
  });

  it("lets a chosen stage win over the focus's open-only rule", async () => {
    h.db.salesLead.count.mockResolvedValue(0);
    h.db.salesLead.findMany.mockResolvedValue([]);
    await request(app).get("/api/sales/leads").query({ followUp: "STALE", status: "CONTACTED" });
    const where = h.db.salesLead.count.mock.calls[0][0].where;
    expect(where.status).toBe("CONTACTED");
    expect(where.updatedAt.lt).toBeInstanceOf(Date);
  });
});

describe("earnings", () => {
  it("returns an opaque reference and a plain source, never the id or source key", async () => {
    h.db.salesCommission.count.mockResolvedValue(1);
    h.db.salesCommission.findMany.mockResolvedValue([{
      id: 42, type: "MARKETPLACE_BOOKING", status: "VALIDATING", sourceKey: "INVOICE:9001",
      grossAmount: 100_000, taxAmount: 0, processingFeeAmount: 0, refundAmount: 0, discountAmount: 0,
      eligibleNetRevenue: 100_000, commissionRate: 10, commissionAmount: 10_000, currency: "TZS",
      description: null, earnedAt: new Date(), eligibleAt: new Date(), approvedAt: null, availableAt: null, paidAt: null, reversedAt: null,
      property: { id: 77, title: "Sea View Lodge" }, contract: { id: 3, contractNumber: "SPC-1" },
    }]);
    const res = await request(app).get("/api/sales/earnings");
    expect(res.status).toBe(200);
    const [earning] = res.body.earnings;
    expect(earning.ref).toMatch(/^se_/);
    expect(earning.source).toBe("Marketplace booking invoice");
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("9001");
    expect(text).not.toContain("sourceKey");
    expect(earning.id).toBeUndefined();
    expect(earning.property).toEqual({ title: "Sea View Lodge" });
  });

  it("works out when pending money unlocks and the six-month trend", async () => {
    const now = Date.now();
    h.db.salesCommission.groupBy.mockResolvedValue([
      { status: "VALIDATING", type: "NRMS_USAGE", currency: "TZS", _sum: { commissionAmount: 30_000, eligibleNetRevenue: 0 }, _count: { id: 3 } },
      { status: "AVAILABLE", type: "NRMS_USAGE", currency: "TZS", _sum: { commissionAmount: 80_000, eligibleNetRevenue: 0 }, _count: { id: 2 } },
    ]);
    h.db.salesCommission.aggregate
      .mockResolvedValueOnce({ _sum: { commissionAmount: 5_000 } }) // this month
      .mockResolvedValueOnce({ _sum: { commissionAmount: 60_000 } }); // withdrawable
    h.db.salesCommission.findMany
      .mockResolvedValueOnce([{ earnedAt: new Date(now), commissionAmount: 5_000 }]) // trend rows
      .mockResolvedValueOnce([
        { eligibleAt: new Date(now + 2 * DAY), commissionAmount: 10_000 },
        { eligibleAt: new Date(now + 20 * DAY), commissionAmount: 15_000 },
        { eligibleAt: null, commissionAmount: 5_000 },
      ]);
    const res = await request(app).get("/api/sales/earnings/summary");
    expect(res.status).toBe(200);
    const s = res.body.summary;
    expect(s.unlocks).toMatchObject({ within7Days: 10_000, within30Days: 15_000, later: 5_000 });
    expect(s.unlocks.next.amount).toBe(10_000);
    expect(s.trend).toHaveLength(6);
    expect(s.trend[5].amount).toBe(5_000);
    expect(s.statusCounts).toEqual({ VALIDATING: 3, AVAILABLE: 2 });
    expect(s.inWithdrawal).toBe(20_000);
    expect(s.minimum).toBe(50_000);
  });
});
