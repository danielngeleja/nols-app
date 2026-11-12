// Agency Desk routes: closed to everyone who does not hold the capability,
// admin-granted only, finance OTP on every grant-like action.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesPartnerProfile: { findUnique: fn() },
    salesPartnerCapability: { updateMany: fn(), create: fn(), findUnique: fn(), findMany: fn() },
    salesAgencyLink: { count: fn(), create: fn(), update: fn(), updateMany: fn(), findMany: fn(), groupBy: fn() },
    bookingChannelAttribution: { findMany: fn(), findUnique: fn(), groupBy: fn(), updateMany: fn() },
    salesCommission: { findMany: fn(), groupBy: fn(), findFirst: fn() },
    booking: { findMany: fn() },
    property: { findFirst: fn(), findMany: fn() },
  };
  db.$transaction = vi.fn(async (op: (tx: any) => unknown) => op(db));
  return {
    db,
    audit: vi.fn(async () => undefined),
    notifyUser: vi.fn(async () => undefined),
    session: { user: { id: 501, role: "USER" } as any, partner: { partnerId: 77 } as any },
    financeGrant: { ok: true },
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: vi.fn() }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSecrets: () => ["test-secret"], publicLinkSigningSecret: () => "test-secret" }));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass, limitSalesAdminRead: pass, limitSalesAdminWrite: pass };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => { if (h.session.partner) req.salesPartner = h.session.partner; next(); },
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
vi.mock("../middleware/financeGrant.js", () => ({
  requireAdminFinanceGrant: (_req: any, res: any, next: any) => (h.financeGrant.ok ? next() : res.status(403).json({ error: "OTP required", require2fa: true })),
}));

import partnerRouter from "../routes/sales.agency.js";
import adminRouter from "../routes/admin.sales.agency.js";
import { agencyTermsHash } from "../lib/salesAgency.js";

const app = express();
app.use(express.json());
app.use("/api/sales", partnerRouter);
app.use("/api/admin/sales", adminRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 24 * 60 * 60 * 1000;
const liveContract = { id: 5, status: "ACTIVE", startsAt: new Date(Date.now() - 30 * DAY), expiresAt: new Date(Date.now() + 300 * DAY) };

function partner(capStatus: string | null, overrides: any = {}) {
  return {
    id: 77,
    userId: 501,
    agentCode: "NSA-DAR-0001",
    status: "ACTIVE",
    payoutHoldAt: null,
    contracts: [liveContract],
    capabilities: capStatus
      ? [{ id: 3, salesPartnerId: 77, status: capStatus, stayRate: "25", maxActiveLinks: 2, termsVersion: "2026-11-v1", acceptedAt: null, acceptedTermsHash: null }]
      : [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SALES_AGENCY_ENABLED = "true";
  h.session.user = { id: 501, role: "USER" };
  h.session.partner = { partnerId: 77 };
  h.financeGrant.ok = true;
  h.db.$transaction.mockImplementation(async (op: (tx: any) => unknown) => op(h.db));
});

describe("partner gate", () => {
  const routes: Array<["get" | "post", string]> = [
    ["get", "/api/sales/agency/status"],
    ["get", "/api/sales/agency/links"],
    ["post", "/api/sales/agency/links"],
    ["get", "/api/sales/agency/bookings"],
    ["post", "/api/sales/agency/links/al_0123456789abcdef0123/revoke"],
  ];

  it.each(routes)("%s %s is 404 for a sales partner without the capability", async (method, path) => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner(null));
    const res = await (request(app) as any)[method](path).send({});
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Not found" });
  });

  it("is 404 for everyone while the kill switch is off", async () => {
    delete process.env.SALES_AGENCY_ENABLED;
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
    expect((await request(app).get("/api/sales/agency/links")).status).toBe(404);
  });

  it("gives an admin with no partner profile no way in", async () => {
    h.session.user = { id: 1, role: "ADMIN" };
    h.session.partner = null;
    expect((await request(app).get("/api/sales/agency/status")).status).toBe(404);
    expect(h.db.salesPartnerProfile.findUnique).not.toHaveBeenCalled();
  });

  it("closes the desk when the partner is suspended, on hold or out of contract", async () => {
    for (const p of [
      partner("ACTIVE", { status: "SUSPENDED" }),
      partner("ACTIVE", { payoutHoldAt: new Date() }),
      partner("ACTIVE", { contracts: [] }),
    ]) {
      h.db.salesPartnerProfile.findUnique.mockResolvedValue(p);
      expect((await request(app).get("/api/sales/agency/links")).status).toBe(404);
    }
  });

  it("lets a pending partner read the addendum but not use the desk", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("PENDING_ACCEPTANCE"));
    h.db.salesAgencyLink.count.mockResolvedValue(0);
    const status = await request(app).get("/api/sales/agency/status");
    expect(status.status).toBe(200);
    expect(status.body.termsHash).toBe(agencyTermsHash(25));
    expect((await request(app).get("/api/sales/agency/links")).status).toBe(404);
    expect((await request(app).post("/api/sales/agency/links").send({ label: "Wedding" })).status).toBe(404);
  });
});

describe("addendum acceptance", () => {
  it("refuses a hash that does not match the current rate", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("PENDING_ACCEPTANCE"));
    const res = await request(app).post("/api/sales/agency/addendum/accept").send({ acceptedName: "Amon Mushi", termsHash: agencyTermsHash(30) });
    expect(res.status).toBe(409);
    expect(h.db.salesPartnerCapability.updateMany).not.toHaveBeenCalled();
  });

  it("accepts the exact text shown, conditionally on the unchanged rate", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("PENDING_ACCEPTANCE"));
    h.db.salesPartnerCapability.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post("/api/sales/agency/addendum/accept").send({ acceptedName: "Amon Mushi", termsHash: agencyTermsHash(25) });
    expect(res.status).toBe(200);
    expect(h.db.salesPartnerCapability.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 3, status: "PENDING_ACCEPTANCE", stayRate: "25" }, data: { status: "ACTIVE" } });
  });

  it("rejects unknown fields", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("PENDING_ACCEPTANCE"));
    const res = await request(app).post("/api/sales/agency/addendum/accept").send({ acceptedName: "Amon Mushi", termsHash: agencyTermsHash(25), stayRate: 90 });
    expect(res.status).toBe(400);
  });
});

describe("links", () => {
  beforeEach(() => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
  });

  it("enforces the live link cap", async () => {
    h.db.salesAgencyLink.count.mockResolvedValue(2);
    const res = await request(app).post("/api/sales/agency/links").send({ label: "Church conference" });
    expect(res.status).toBe(409);
    expect(h.db.salesAgencyLink.create).not.toHaveBeenCalled();
  });

  it("never accepts a partner id or token from the client", async () => {
    const res = await request(app).post("/api/sales/agency/links").send({ label: "x1", salesPartnerId: 1, tokenHash: "f".repeat(64) });
    expect(res.status).toBe(400);
  });

  it("only pins approved properties", async () => {
    h.db.property.findFirst.mockResolvedValue(null);
    const res = await request(app).post("/api/sales/agency/links").send({ label: "Lodge", propertyUrl: "https://www.nolsaf.com/public/properties/lodge-cm1abc23xyz" });
    expect(res.status).toBe(400);
    expect(h.db.property.findFirst.mock.calls[0][0].where).toMatchObject({ nrmsBookingKey: "cm1abc23xyz", status: "APPROVED" });
  });

  it("creates a link whose stored hash is the hash of the shown token", async () => {
    h.db.salesAgencyLink.count.mockResolvedValue(0);
    h.db.salesAgencyLink.create.mockImplementation(async ({ data }: any) => ({ id: 12, createdAt: new Date(), useCount: 0, revokedAt: null, ...data }));
    h.db.salesAgencyLink.update.mockImplementation(async ({ data }: any) => ({ id: 12, createdAt: new Date(), useCount: 0, revokedAt: null, ...h.db.salesAgencyLink.create.mock.calls[0][0].data, ...data }));
    const res = await request(app).post("/api/sales/agency/links").send({ label: "School trip", clientPhone: "0712345678" });
    expect(res.status).toBe(201);
    expect(res.body.link.url).toMatch(/\?ag=[A-Za-z0-9_-]{43}$/);
    expect(res.body.link.clientPhone).toBe("••• 678");
    expect(JSON.stringify(res.body)).not.toContain("salt");
    expect(JSON.stringify(res.body)).not.toContain("tokenHash");
  });

  it("cannot revoke another partner's link", async () => {
    h.db.salesAgencyLink.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/api/sales/agency/links/al_0123456789abcdef0123/revoke").send({});
    expect(res.status).toBe(404);
    expect(h.db.salesAgencyLink.updateMany.mock.calls[0][0].where).toMatchObject({ salesPartnerId: 77 });
  });
});

describe("admin", () => {
  beforeEach(() => {
    h.session.user = { id: 1, role: "ADMIN" };
  });

  it("voids a stay credit by its opaque reference, only among that partner's credits", async () => {
    const { customerRecordReference } = await import("../lib/customerBookingReference.js");
    h.db.bookingChannelAttribution.findMany.mockResolvedValue([{ bookingId: 1000 }, { bookingId: 1001 }]);
    h.db.bookingChannelAttribution.findUnique.mockResolvedValue({ id: 4, bookingId: 1000, status: "ACTIVE" });
    h.db.bookingChannelAttribution.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesCommission.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/api/admin/sales/partners/77/agency/bookings/void").send({ bookingRef: "1000", reason: "Fake guest" })).status).toBe(404);
    const other = customerRecordReference("booking", 5555);
    expect((await request(app).post("/api/admin/sales/partners/77/agency/bookings/void").send({ bookingRef: other, reason: "Fake guest" })).status).toBe(404);
    const res = await request(app).post("/api/admin/sales/partners/77/agency/bookings/void").send({ bookingRef: customerRecordReference("booking", 1000), reason: "Fake guest" });
    expect(res.status).toBe(200);
    expect(h.db.bookingChannelAttribution.findMany.mock.calls[0][0].where).toEqual({ salesPartnerId: 77 });
    expect(h.db.bookingChannelAttribution.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 4 }, data: { status: "VOID" } });
    h.financeGrant.ok = false;
    expect((await request(app).post("/api/admin/sales/partners/77/agency/bookings/void").send({ bookingRef: customerRecordReference("booking", 1000), reason: "Fake guest" })).status).toBe(403);
  });

  it("shows exactly which condition blocks the desk", async () => {
    delete process.env.SALES_AGENCY_ENABLED;
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner(null, { status: "PENDING", contracts: [] }));
    const res = await request(app).get("/api/admin/sales/partners/77/agency");
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.checks.map((c: any) => [c.key, c.ok]));
    expect(byKey).toEqual({ partner: false, contract: false, hold: true, switch: false });
    expect(res.body.activity).toBeNull();
  });

  it("is admin only", async () => {
    h.session.user = { id: 501, role: "USER" };
    expect((await request(app).post("/api/admin/sales/partners/77/agency/grant").send({ stayRate: 25, reason: "Pilot partner" })).status).toBe(403);
  });

  it("needs the finance OTP grant to grant, change the rate or reinstate", async () => {
    h.financeGrant.ok = false;
    for (const path of ["grant", "rate", "reinstate"]) {
      const res = await request(app).post(`/api/admin/sales/partners/77/agency/${path}`).send({ stayRate: 25, reason: "Pilot partner" });
      expect(res.status).toBe(403);
      expect(res.body.require2fa).toBe(true);
    }
    expect(h.db.salesPartnerCapability.create).not.toHaveBeenCalled();
  });

  it("only grants to an active partner with a live contract and no payout hold", async () => {
    for (const p of [partner(null, { status: "PENDING" }), partner(null, { contracts: [] }), partner(null, { payoutHoldAt: new Date() })]) {
      h.db.salesPartnerProfile.findUnique.mockResolvedValue(p);
      const res = await request(app).post("/api/admin/sales/partners/77/agency/grant").send({ stayRate: 25, reason: "Pilot partner" });
      expect(res.status).toBe(409);
    }
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(null);
    expect((await request(app).post("/api/admin/sales/partners/999/agency/grant").send({ stayRate: 25, reason: "Pilot partner" })).status).toBe(404);
    expect(h.db.salesPartnerCapability.create).not.toHaveBeenCalled();
  });

  it("grants as pending acceptance, within rate bounds, with a reason", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner(null));
    expect((await request(app).post("/api/admin/sales/partners/77/agency/grant").send({ stayRate: 90, reason: "Pilot partner" })).status).toBe(400);
    expect((await request(app).post("/api/admin/sales/partners/77/agency/grant").send({ stayRate: 25 })).status).toBe(400);
    h.db.salesPartnerCapability.create.mockImplementation(async ({ data }: any) => ({ id: 3, ...data }));
    const res = await request(app).post("/api/admin/sales/partners/77/agency/grant").send({ stayRate: 25, reason: "Pilot partner" });
    expect(res.status).toBe(200);
    expect(h.db.salesPartnerCapability.create.mock.calls[0][0].data).toMatchObject({ salesPartnerId: 77, capability: "AGENCY", status: "PENDING_ACCEPTANCE", grantedById: 1 });
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), "SALES_AGENCY_GRANT", "SALES_PARTNER", null, expect.anything(), 77);
  });

  it("revoke closes every live link", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
    h.db.salesPartnerCapability.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesAgencyLink.updateMany.mockResolvedValue({ count: 4 });
    const res = await request(app).post("/api/admin/sales/partners/77/agency/revoke").send({ reason: "Collected cash from a client" });
    expect(res.status).toBe(200);
    expect(res.body.linksClosed).toBe(4);
    expect(h.db.salesAgencyLink.updateMany.mock.calls[0][0].where).toMatchObject({ salesPartnerId: 77, revokedAt: null });
  });

  it("a rate change on a live desk sends the partner back to acceptance", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
    h.db.salesPartnerCapability.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesPartnerCapability.findUnique.mockResolvedValue({ status: "PENDING_ACCEPTANCE", stayRate: "30" });
    const res = await request(app).post("/api/admin/sales/partners/77/agency/rate").send({ stayRate: 30, reason: "Pilot review" });
    expect(res.status).toBe(200);
    expect(h.db.salesPartnerCapability.updateMany.mock.calls[0][0].data).toMatchObject({ stayRate: 30, status: "PENDING_ACCEPTANCE", acceptedAt: null });
  });
});
