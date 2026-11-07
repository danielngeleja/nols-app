// Leaderboard scoring and the team-lead permission boundary. Database, auth and
// limits are stood in for; the real routers and rules run over HTTP.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { badgesFor, monthKey, monthRange, pointsFor, publicName, quarterMonths, rankEntries, shiftMonth } from "../lib/salesLeaderboard.js";

describe("scoring", () => {
  it("adds verified results and takes off owner denials and reversals", () => {
    expect(pointsFor({ confirmed: 2, live: 1, visits: 3, flaggedVisits: 4, revenuePoints: 12, denials: 1, reversalPoints: 2 })).toBe(100 + 30 + 15 + 12 - 40 - 2);
  });

  it("never shows full names on the shared board", () => {
    expect(publicName("amina mussa juma")).toBe("Amina J.");
    expect(publicName("Halima")).toBe("Halima");
  });

  it("ranks with ties sharing a place and leaves excluded partners off", () => {
    const ranked = rankEntries([
      { partnerId: 1, points: 90, confirmed: 1, visits: 0 },
      { partnerId: 2, points: 120, confirmed: 2, visits: 0 },
      { partnerId: 3, points: 90, confirmed: 1, visits: 0 },
      { partnerId: 4, points: 500, confirmed: 9, visits: 0, excluded: true },
      { partnerId: 5, points: 10, confirmed: 0, visits: 2 },
    ]);
    expect(ranked.map((r) => [r.partnerId, r.rank])).toEqual([[2, 1], [1, 2], [3, 2], [5, 4]]);
  });

  it("uses EAT calendar months", () => {
    expect(monthKey(new Date("2026-10-31T21:30:00Z"))).toBe("2026-11");
    expect(monthRange("2026-11").start.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(quarterMonths("2026-11")).toEqual(["2026-10", "2026-11"]);
  });

  it("gives badges only for earned results", () => {
    expect(badgesFor({ rank: 1, points: 300, confirmed: 3, denials: 0, flaggedVisits: 0 }, null, 1)).toEqual(["TOP_1", "MOST_TRUSTED"]);
    expect(badgesFor({ rank: 2, points: 0, confirmed: 0, denials: 0, flaggedVisits: 0 }, 7, 7)).toEqual(["RISING_STAR"]);
    expect(badgesFor({ rank: 9, points: 80, confirmed: 2, denials: 1, flaggedVisits: 0 }, null, 1)).toEqual([]);
  });
});

// ---- team lead boundary -----------------------------------------------------

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesTeam: { findUnique: fn() },
    salesTeamMember: { findMany: fn(), findUnique: fn() },
    salesLead: { findUnique: fn(), findMany: fn(), updateMany: fn(), groupBy: fn() },
    salesLeadActivity: { create: fn() },
    salesPartnerProfile: { findUnique: fn(), findMany: fn() },
    salesPartnerMonth: { upsert: fn(), findMany: fn(), findUnique: fn().mockResolvedValue({ target: 8 }) },
    auditLog: { findMany: fn().mockResolvedValue([]), create: fn() },
    salesLeadVisit: { groupBy: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, notify: vi.fn(async () => undefined), audit: vi.fn(async () => undefined), board: vi.fn(async () => []) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notify }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = Number(req.get("x-test-user-id"));
    if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id, role: "USER", imp: req.get("x-test-impersonated") === "true" };
    return next();
  },
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during support session" }) : next()),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => {
    req.salesPartner = { partnerId: Number(req.get("x-test-partner")) };
    next();
  },
  requireActivePartnerContract: (_req: any, _res: any, next: any) => next(),
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeaderboard: pass, limitSalesLeadWrite: pass };
});
vi.mock("../lib/salesLeaderboard.js", async (original) => ({ ...(await original<any>()), computeBoard: h.board }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret", publicLinkSecrets: () => ["test-secret"] }));

import teamRouter from "../routes/sales.team.js";
import { leadRef, partnerRef } from "../lib/salesReference.js";

const app = express();
app.use(express.json());
app.use("/api/sales", teamRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const asLead = { "x-test-user-id": "100", "x-test-partner": "10" };

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  // Partner 10 leads team 1 with members 11 and 12.
  h.db.salesTeam.findUnique.mockImplementation(async ({ where }: any) =>
    where.leadPartnerId === 10 ? { id: 1, name: "Asha's team", region: "Dar es Salaam", status: "ACTIVE" } : null,
  );
  h.db.salesTeamMember.findMany.mockResolvedValue([{ salesPartnerId: 11 }, { salesPartnerId: 12 }]);
});

describe("team lead boundary", () => {
  it("a partner who leads no team cannot open My team", async () => {
    const res = await request(app).get("/api/sales/team").set({ "x-test-user-id": "200", "x-test-partner": "20" });
    expect(res.status).toBe(403);
  });

  it("cannot see a partner outside the team", async () => {
    const res = await request(app).get(`/api/sales/team/members/${partnerRef(99)}/leads`).set(asLead);
    expect(res.status).toBe(404);
    expect(h.db.salesLead.findMany).not.toHaveBeenCalled();
  });

  it("member leads never include contact details", async () => {
    h.db.salesLead.findMany.mockResolvedValue([{ id: 5, propertyName: "Jamirex", region: "Dar", district: null, status: "CONTACTED", proposedProduct: "NRMS", nextFollowUpAt: null, protectionExpiresAt: null, updatedAt: new Date(), _count: { visits: 1 } }]);
    const res = await request(app).get(`/api/sales/team/members/${partnerRef(11)}/leads`).set(asLead);
    expect(res.status).toBe(200);
    const select = h.db.salesLead.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty("contactPhone");
    expect(select).not.toHaveProperty("contactEmail");
    expect(res.body.leads[0]).toMatchObject({ ref: leadRef(5), visits: 1 });
    expect(res.body.leads[0]).not.toHaveProperty("id");
  });

  it("moves an open lead between members and records why", async () => {
    h.db.salesLead.findMany.mockResolvedValue([{ id: 5 }, { id: 6 }]);
    h.db.salesLead.findUnique.mockResolvedValue({ id: 5, salesPartnerId: 11, status: "CONTACTED", propertyName: "Jamirex", salesPartner: { userId: 111 } });
    h.db.salesPartnerProfile.findUnique.mockResolvedValue({ status: "ACTIVE", userId: 112, user: { name: "Peter N" } });
    h.db.salesLead.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post(`/api/sales/team/leads/${leadRef(5)}/reassign`).set(asLead).send({ toPartner: partnerRef(12), reason: "Peter is closer to the site" });
    expect(res.status).toBe(200);
    expect(h.db.salesLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { salesPartnerId: 12 } }));
    expect(h.db.salesLeadActivity.create).toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith(112, "sales_partner_lead_reassigned_to", expect.any(Object));
  });

  it("cannot move a lead to, or from, outside the team", async () => {
    expect((await request(app).post(`/api/sales/team/leads/${leadRef(5)}/reassign`).set(asLead).send({ toPartner: partnerRef(99), reason: "Outside the team" })).status).toBe(404);
    h.db.salesLead.findMany.mockResolvedValue([{ id: 5 }]);
    h.db.salesLead.findUnique.mockResolvedValue({ id: 6, salesPartnerId: 77, status: "CONTACTED", propertyName: "X", salesPartner: { userId: 1 } });
    expect((await request(app).post(`/api/sales/team/leads/${leadRef(6)}/reassign`).set(asLead).send({ toPartner: partnerRef(12), reason: "Not my team's lead" })).status).toBe(404);
    expect(h.db.salesLead.updateMany).not.toHaveBeenCalled();
  });

  it("cannot move a lead that is waiting for conversion", async () => {
    h.db.salesLead.findMany.mockResolvedValue([{ id: 5 }]);
    h.db.salesLead.findUnique.mockResolvedValue({ id: 5, salesPartnerId: 11, status: "CONVERSION_REQUESTED", propertyName: "Jamirex", salesPartner: { userId: 111 } });
    const res = await request(app).post(`/api/sales/team/leads/${leadRef(5)}/reassign`).set(asLead).send({ toPartner: partnerRef(12), reason: "Trying to take credit" });
    expect(res.status).toBe(409);
  });

  it("sets targets only within the limits, and never during a support session", async () => {
    h.db.salesPartnerMonth.upsert.mockResolvedValue({ salesPartner: { userId: 111 } });
    expect((await request(app).put(`/api/sales/team/members/${partnerRef(11)}/target`).set(asLead).send({ target: 500 })).status).toBe(400);
    expect((await request(app).put(`/api/sales/team/members/${partnerRef(11)}/target`).set({ ...asLead, "x-test-impersonated": "true" }).send({ target: 6 })).status).toBe(403);
    const ok = await request(app).put(`/api/sales/team/members/${partnerRef(11)}/target`).set(asLead).send({ target: 6 });
    expect(ok.status).toBe(200);
    expect(h.db.salesPartnerMonth.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ target: 6, targetSetByRole: "TEAM_LEAD" }) }));
  });

  it("refuses anonymous requests", async () => {
    expect((await request(app).get("/api/sales/team")).status).toBe(401);
  });
});
