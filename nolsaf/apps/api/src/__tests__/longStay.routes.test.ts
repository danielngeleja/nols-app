// Long-stay routes: the admin switch is admin-only and audited; the owner quote
// is only for switched-on landlords and computed on the server.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    user: { findFirst: fn() },
    longStayLandlordGrant: { findUnique: fn(), upsert: fn(), delete: fn(), update: fn() },
    property: { findMany: fn(), findUnique: fn() },
    systemSetting: { findUnique: fn() },
  };
  return { db, session: { user: { id: 1, role: "ADMIN" } as any } };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during a support session" }) : next()),
}));

import adminRouter from "../routes/admin.longStay.js";
import ownerRouter from "../routes/owner.longStay.js";
import { audit } from "../lib/audit.js";

const app = express();
app.use(express.json());
app.use("/api/admin/long-stay", adminRouter);
app.use("/api/owner/long-stay", ownerRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.session.user = { id: 1, role: "ADMIN" };
  h.db.user.findFirst.mockResolvedValue({ id: 3, suspendedAt: null, deletedAt: null });
  h.db.longStayLandlordGrant.findUnique.mockResolvedValue(null);
  h.db.property.findMany.mockResolvedValue([]);
  h.db.systemSetting.findUnique.mockResolvedValue(null);
});

describe("admin landlord switch", () => {
  it("is refused to anyone but an admin", async () => {
    h.session.user = { id: 3, role: "OWNER" };
    const res = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" });
    expect(res.status).toBe(403);
    expect(h.db.longStayLandlordGrant.upsert).not.toHaveBeenCalled();
  });

  it("switches an owner on, recording the admin, and audits it", async () => {
    const res = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" });
    expect(res.status).toBe(200);
    expect(h.db.longStayLandlordGrant.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 3 }, create: expect.objectContaining({ userId: 3, enabledById: 1 }) }));
    expect(audit).toHaveBeenCalledWith(expect.anything(), "LONG_STAY_LANDLORD_SWITCH", "USER", expect.anything(), expect.objectContaining({ action: "ENABLE" }), 3);
  });

  it("never switches on a suspended account or a non-owner", async () => {
    h.db.user.findFirst.mockResolvedValueOnce({ id: 3, suspendedAt: new Date(), deletedAt: null });
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "ENABLE" })).status).toBe(409);
    h.db.user.findFirst.mockResolvedValueOnce(null);
    expect((await request(app).post("/api/admin/long-stay/landlords/4").send({ action: "ENABLE" })).status).toBe(404);
    expect(h.db.longStayLandlordGrant.upsert).not.toHaveBeenCalled();
  });

  it("needs a reason to pause or switch off, and rejects unknown actions", async () => {
    h.db.longStayLandlordGrant.findUnique.mockResolvedValue({ userId: 3, pausedAt: null });
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "PAUSE" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "DISABLE", reason: "no" })).status).toBe(400);
    expect((await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "GRANT_ALL" })).status).toBe(400);
    const paused = await request(app).post("/api/admin/long-stay/landlords/3").send({ action: "PAUSE", reason: "Complaint under review" });
    expect(paused.status).toBe(200);
    expect(h.db.longStayLandlordGrant.update).toHaveBeenCalledWith({ where: { userId: 3 }, data: expect.objectContaining({ pauseReason: "Complaint under review" }) });
  });
});

describe("owner quote", () => {
  beforeEach(() => { h.session.user = { id: 3, role: "OWNER" }; });

  it("is closed until NoLSAF switches the landlord on", async () => {
    const res = await request(app).post("/api/owner/long-stay/quote").send({ monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, currency: "USD" });
    expect(res.status).toBe(403);
  });

  it("returns the server's amounts for a switched-on landlord", async () => {
    h.db.longStayLandlordGrant.findUnique.mockResolvedValue({ enabledAt: new Date(), pausedAt: null, pauseReason: null });
    const res = await request(app).post("/api/owner/long-stay/quote").send({ monthlyRent: 4500, termMonths: 6, upfrontMonths: 6, currency: "USD" });
    expect(res.status).toBe(200);
    expect(res.body.quote).toMatchObject({ bookingAmount: 5580, balanceDue: 22500, landlordPayout: 3150 });
  });

  it("tells an owner whether they are switched on", async () => {
    const res = await request(app).get("/api/owner/long-stay/eligibility");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ granted: false, bookingsOpen: false, termMonths: [3, 6, 12] });
    expect(res.body.propertyTypes).not.toContain("HOTEL");
  });
});
