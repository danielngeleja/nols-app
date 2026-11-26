// Assisted listing routes: closed unless NoLSAF granted the right, scoped to the
// partner's own leads, edits only while a draft, and the only public route is a
// random token that can only pause a listing.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesLead: { findFirst: fn(), updateMany: fn() },
    salesPartnerProfile: { findUnique: fn(), updateMany: fn(), update: fn() },
    salesAssistedListing: { findFirst: fn(), findUnique: fn(), create: fn(), count: fn(), update: fn(), updateMany: fn(), findMany: fn(), groupBy: fn() },
    salesLeadVisit: { findFirst: fn() },
    salesLeadActivity: { create: fn() },
    user: { findFirst: fn(), findUnique: fn(), create: fn(), update: fn() },
    property: { create: fn(), update: fn(), count: fn() },
    booking: { count: fn() },
    // Long-stay requests (section 15): nothing waiting unless a test says so.
    longStayAccessRequest: { updateMany: vi.fn(async () => ({ count: 0 })), findFirst: vi.fn(async () => null) },
    longStayLandlordGrant: { findUnique: vi.fn(async () => null), delete: fn() },
  };
  db.$transaction = vi.fn(async (op: (tx: any) => unknown) => op(db));
  return {
    db,
    session: { user: { id: 501, role: "USER" } as any, partnerId: 77 as number | null },
    handlerCalls: [] as Array<{ name: string; scope: any; id: string }>,
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: vi.fn(async () => undefined), notifyUser: vi.fn(async () => undefined), notifyOwner: vi.fn(async () => undefined) }));
vi.mock("../lib/sms.js", () => ({ sendSms: vi.fn(async () => ({ success: true, provider: "test" })) }));
vi.mock("../lib/performance.js", () => ({ invalidateCache: vi.fn(async () => undefined), cacheKeys: { property: () => "p", adminSummary: () => "a" } }));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass, limitSalesAdminRead: pass, limitSalesAdminWrite: pass, limitAssistedListingNotice: pass };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (req: any, res: any, next: any) => (req.user?.imp ? res.status(403).json({ error: "Not during a support session" }) : next()),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => { if (h.session.partnerId) req.salesPartner = { partnerId: h.session.partnerId }; next(); },
  requireActivePartnerContract: (_req: any, _res: any, next: any) => next(),
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));
// Only the partner's own lead reference resolves.
vi.mock("../lib/salesReference.js", () => ({
  resolvePartnerLead: vi.fn(async (_db: any, value: string) => (value === "sl_own" ? 11 : null)),
  propertyRef: (id: number) => `pp_${id}`,
  leadRef: (id: number) => `sl_${id}`,
}));
// The shared owner listing handlers: record how the partner route calls them.
vi.mock("../routes/owner.properties.js", () => {
  const make = (name: string) => (req: any, res: any) => {
    h.handlerCalls.push({ name, scope: req.listingScope, id: req.params.id });
    res.json({ ok: true, handler: name });
  };
  return { getListingProperty: make("get"), updateListingProperty: make("update"), submitListingProperty: make("submit") };
});

import partnerRouter from "../routes/sales.assistedListing.js";
import adminRouter from "../routes/admin.sales.assistedListings.js";
import { publicListingNoticeRouter } from "../routes/public.listingNotice.js";

const app = express();
app.use(express.json());
app.use("/api/sales", partnerRouter);
app.use("/api/admin/sales", adminRouter);
app.use("/api/public/listing-notice", publicListingNoticeRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const granted = {
  id: 77,
  userId: 501,
  agentCode: "NSA-DAR-0001",
  status: "ACTIVE",
  phone: "0755000111",
  payoutAccount: null,
  user: { email: "partner@example.com", phone: "+255755000111", name: "Partner", fullName: "Partner One" },
  assistedListingEnabledAt: new Date("2026-11-01"),
  assistedListingPausedAt: null,
  assistedListingPauseReason: null,
};
const openLead = { id: 11, status: "CONTACTED", propertyName: "Sea View Flats", propertyType: "Apartment", region: "Dar es Salaam", district: "Kinondoni", ward: null };

beforeEach(() => {
  vi.clearAllMocks();
  h.handlerCalls.length = 0;
  h.session.user = { id: 501, role: "USER" };
  h.session.partnerId = 77;
  h.db.$transaction.mockImplementation(async (op: (tx: any) => unknown) => op(h.db));
  h.db.salesPartnerProfile.findUnique.mockResolvedValue(granted);
  h.db.salesLead.findFirst.mockResolvedValue(openLead);
  h.db.salesAssistedListing.findFirst.mockResolvedValue(null);
  h.db.salesAssistedListing.count.mockResolvedValue(0);
  h.db.salesLeadVisit.findFirst.mockResolvedValue(null);
  h.db.user.findFirst.mockResolvedValue(null);
  h.db.user.create.mockResolvedValue({ id: 900 });
  h.db.property.create.mockResolvedValue({ id: 300, title: "Sea View Flats" });
  h.db.salesAssistedListing.create.mockResolvedValue({ id: 40 });
  h.db.salesAssistedListing.findUnique.mockResolvedValue({ id: 40, status: "DRAFTING", propertyId: 300 });
});

const start = (body: any = { ownerName: "Asha Mussa", ownerPhone: "0712 345 678" }) =>
  request(app).post("/api/sales/leads/sl_own/assisted-listing").send(body);

describe("starting an assisted listing", () => {
  it("is refused until NoLSAF grants the right", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue({ ...granted, assistedListingEnabledAt: null });
    const res = await start();
    expect(res.status).toBe(403);
    expect(h.db.user.create).not.toHaveBeenCalled();
  });

  it("is refused while the right is paused", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue({ ...granted, assistedListingPausedAt: new Date() });
    expect((await start()).status).toBe(403);
  });

  it("cannot reach another partner's lead", async () => {
    const res = await request(app).post("/api/sales/leads/sl_someone_else/assisted-listing").send({ ownerName: "Asha Mussa", ownerPhone: "0712345678" });
    expect(res.status).toBe(404);
  });

  it("is refused during a support session", async () => {
    h.session.user = { id: 501, role: "USER", imp: true };
    expect((await start()).status).toBe(403);
  });

  it("works without an on-site visit and creates a passwordless owner", async () => {
    const res = await start();
    expect(res.status).toBe(201);
    expect(h.db.user.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ role: "OWNER", passwordHash: null, phone: "+255712345678", registrationSource: "SALES_ASSISTED" }),
    }));
    expect(h.db.salesAssistedListing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitId: null }) }));
  });

  it("links the latest verified visit when there is one", async () => {
    h.db.salesLeadVisit.findFirst.mockResolvedValue({ id: 8 });
    await start();
    expect(h.db.salesAssistedListing.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ visitId: 8 }) }));
  });

  it("never lets the partner be the owner", async () => {
    const res = await start({ ownerName: "Me Myself", ownerPhone: "0755 000 111" });
    expect(res.status).toBe(409);
    expect(h.db.user.create).not.toHaveBeenCalled();
  });
});

describe("editing the listing", () => {
  const draft = { id: 40, status: "DRAFTING", propertyId: 300, ownerUserId: 900, property: { status: "DRAFT" } };

  it("runs the owner handler as the owner, on that listing only", async () => {
    h.db.salesAssistedListing.findFirst.mockResolvedValue(draft);
    const res = await request(app).put("/api/sales/leads/sl_own/assisted-listing/property").send({ title: "Sea View" });
    expect(res.status).toBe(200);
    expect(h.handlerCalls[0]).toMatchObject({ name: "update", id: "300", scope: { ownerId: 900 } });
  });

  it("is refused once the listing is submitted", async () => {
    h.db.salesAssistedListing.findFirst.mockResolvedValue({ ...draft, status: "SUBMITTED", property: { status: "PENDING" } });
    const res = await request(app).put("/api/sales/leads/sl_own/assisted-listing/property").send({ title: "Sea View" });
    expect(res.status).toBe(409);
    expect(h.handlerCalls).toHaveLength(0);
  });

  it("is refused if the property itself is no longer a draft", async () => {
    h.db.salesAssistedListing.findFirst.mockResolvedValue({ ...draft, property: { status: "APPROVED" } });
    expect((await request(app).post("/api/sales/leads/sl_own/assisted-listing/submit")).status).toBe(409);
    expect(h.handlerCalls).toHaveLength(0);
  });
});

describe("the owner's public link", () => {
  it("refuses a malformed token without touching the database", async () => {
    const res = await request(app).get("/api/public/listing-notice/not-a-token");
    expect(res.status).toBe(404);
    expect(h.db.salesAssistedListing.findUnique).not.toHaveBeenCalled();
  });

  it("refuses an unknown token", async () => {
    h.db.salesAssistedListing.findUnique.mockResolvedValue(null);
    const res = await request(app).post(`/api/public/listing-notice/${"a".repeat(32)}/object`).send({ note: "This is not my property" });
    expect(res.status).toBe(404);
  });

  it("refuses to pause without a reason", async () => {
    for (const body of [{}, { note: null }, { note: "" }, { note: "  " }]) {
      const res = await request(app).post(`/api/public/listing-notice/${"c".repeat(32)}/object`).send(body);
      expect(res.status).toBe(400);
    }
    expect(h.db.salesAssistedListing.updateMany).not.toHaveBeenCalled();
    expect(h.db.property.update).not.toHaveBeenCalled();
  });

  it("can only pause the listing", async () => {
    h.db.salesAssistedListing.findUnique.mockResolvedValue({
      id: 40, status: "APPROVED", objectedAt: null, propertyId: 300,
      property: { title: "Sea View Flats", status: "APPROVED" },
      salesPartner: { agentCode: "NSA-DAR-0001", userId: 501, user: { name: "Partner" } },
    });
    h.db.salesAssistedListing.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post(`/api/public/listing-notice/${"b".repeat(32)}/object`).send({ note: "I never agreed" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ paused: true });
    expect(h.db.salesAssistedListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PAUSED_OBJECTION" }) }));
    expect(h.db.property.update).toHaveBeenCalledWith({ where: { id: 300 }, data: { status: "SUSPENDED" } });
  });
});

describe("admin", () => {
  const listing = { id: 40, status: "DRAFTING", propertyId: 300, ownerUserId: 900, ownerAccountOutcome: "CREATED", property: { title: "Sea View Flats" }, salesPartner: { userId: 501 } };

  it("is closed to anyone who is not an admin", async () => {
    expect((await request(app).get("/api/admin/sales/assisted-listings")).status).toBe(403);
  });

  it("releases a never-used owner account when cancelling", async () => {
    h.session.user = { id: 1, role: "ADMIN" };
    h.db.salesAssistedListing.findUnique.mockResolvedValue(listing);
    h.db.salesAssistedListing.updateMany.mockResolvedValue({ count: 1 });
    h.db.user.findUnique.mockResolvedValue({ id: 900, phoneVerifiedAt: null, emailVerifiedAt: null, passwordHash: null, registrationSource: "SALES_ASSISTED" });
    h.db.property.count.mockResolvedValue(0);
    h.db.salesAssistedListing.count.mockResolvedValue(0);
    h.db.booking.count.mockResolvedValue(0);
    const res = await request(app).post("/api/admin/sales/assisted-listings/40/cancel").send({ reason: "Wrong phone number entered" });
    expect(res.status).toBe(200);
    expect(res.body.accountReleased).toBe(true);
    expect(h.db.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 900 }, data: expect.objectContaining({ phone: null, email: null, isDisabled: true }) }));
  });

  it("never releases an account the owner has signed in to", async () => {
    h.session.user = { id: 1, role: "ADMIN" };
    h.db.salesAssistedListing.findUnique.mockResolvedValue(listing);
    h.db.salesAssistedListing.updateMany.mockResolvedValue({ count: 1 });
    h.db.user.findUnique.mockResolvedValue({ id: 900, phoneVerifiedAt: new Date(), emailVerifiedAt: null, passwordHash: null, registrationSource: "SALES_ASSISTED" });
    const res = await request(app).post("/api/admin/sales/assisted-listings/40/cancel").send({ reason: "Owner changed their mind" });
    expect(res.status).toBe(200);
    expect(res.body.accountReleased).toBe(false);
    expect(h.db.user.update).not.toHaveBeenCalled();
  });
});
