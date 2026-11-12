// Agency Desk phase 2: client book, client-confirmed group stays, shortlist
// review, full prepayment and the group commission.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesPartnerProfile: { findUnique: fn() },
    salesClientAccount: { count: fn(), create: fn(), findFirst: fn(), findMany: fn(), update: fn() },
    salesClientActivity: { create: fn(), findMany: fn() },
    salesAgencyGroupRequest: { count: fn(), create: fn(), findFirst: fn(), findUnique: fn(), findMany: fn(), update: fn(), updateMany: fn() },
    groupBooking: { create: fn(), findUnique: fn(), findMany: fn(), update: fn(), updateMany: fn() },
    groupBookingClaim: { findMany: fn(), count: fn() },
    groupBookingPassenger: { createMany: fn() },
    groupBookingAudit: { create: fn(), count: fn() },
    groupBookingMessage: { create: fn() },
    property: { findUnique: fn(), findMany: fn() },
    payoutAccount: { findMany: fn() },
    salesCommission: { findUnique: fn(), create: fn() },
    salesLead: { findMany: fn(), findUnique: fn() },
    user: { findUnique: fn() },
    auditLog: { create: fn() },
  };
  db.$transaction = vi.fn(async (op: any) => (typeof op === "function" ? op(db) : Promise.all(op)));
  return {
    db,
    audit: vi.fn(async () => undefined),
    notifyUser: vi.fn(async () => undefined),
    notifyAdmins: vi.fn(async () => undefined),
    sendSms: vi.fn(async () => ({ ok: true })),
    session: { user: { id: 501, role: "USER" } as any, partner: { partnerId: 77 } as any },
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: h.notifyAdmins }));
vi.mock("../lib/sms.js", () => ({ sendSms: h.sendSms }));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSecrets: () => ["test-secret"] }));
vi.mock("../lib/accommodationPayout.js", () => ({ getEffectiveCommissionPercent: async () => 10 }));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesLeadRead: pass, limitSalesLeadWrite: pass, limitSalesAdminRead: pass, limitSalesAdminWrite: pass, limitAgencyGroupConfirm: pass };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.session.user; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/salesWorkspace.js", () => ({
  requireWorkspaceAccess: () => (req: any, _res: any, next: any) => { if (h.session.partner) req.salesPartner = h.session.partner; next(); },
  partnerIdFor: (req: any) => req.salesPartner?.partnerId ?? null,
}));

import groupsRouter from "../routes/sales.agency.groups.js";
import confirmRouter from "../routes/agency.groupConfirm.js";
import { accrueAgencyGroupCommission, hashGroupRequestToken, newGroupRequestToken, notifyAgencyPartnerAboutGroup, shortlistNeedsReview } from "../lib/salesAgencyGroups.js";

const app = express();
app.use(express.json());
app.use("/api/sales", groupsRouter);
app.use("/api/agency-group", confirmRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 24 * 60 * 60 * 1000;
const liveContract = { id: 5, status: "ACTIVE", startsAt: new Date(Date.now() - 300 * DAY), expiresAt: new Date(Date.now() + 300 * DAY) };
const partnerRow = (overrides: any = {}) => ({
  id: 77,
  userId: 501,
  agentCode: "NSA-DAR-0001",
  status: "ACTIVE",
  payoutHoldAt: null,
  contracts: [liveContract],
  capabilities: [{ id: 3, salesPartnerId: 77, status: "ACTIVE", stayRate: "25", maxActiveLinks: 20, acceptedAt: new Date(Date.now() - 200 * DAY) }],
  phone: "0712000111",
  payoutAccount: null,
  user: { email: "partner@example.com", phone: "0712000111" },
  ...overrides,
});

const groupPayload = {
  groupType: "event",
  toRegion: "Mwanza",
  accommodationType: "hotel",
  minHotelStarLabel: "moderate",
  headcount: 40,
  roomSize: 2,
  roomsNeeded: 20,
  needsPrivateRoom: false,
  privateRoomCount: 0,
  checkin: new Date(Date.now() + 30 * DAY).toISOString(),
  checkout: new Date(Date.now() + 33 * DAY).toISOString(),
  arrangements: { pickup: false, transport: false, meals: true, guide: false, equipment: false },
  roster: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SALES_AGENCY_ENABLED = "true";
  h.session.user = { id: 501, role: "USER" };
  h.session.partner = { partnerId: 77 };
  h.db.$transaction.mockImplementation(async (op: any) => (typeof op === "function" ? op(h.db) : Promise.all(op)));
  h.db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow());
  h.db.property.findUnique.mockResolvedValue({ owner: { id: 300, email: "owner@example.com", phone: "0766000000" } });
  h.db.payoutAccount.findMany.mockResolvedValue([]);
});

describe("client book", () => {
  const client = { type: "BANK", name: "Lake Bank Mwanza branch", phone: "0755123456" };

  it("is closed to partners without the desk", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ capabilities: [] }));
    expect((await request(app).post("/api/sales/agency/clients").send(client)).status).toBe(404);
    expect((await request(app).get("/api/sales/agency/groups")).status).toBe(404);
  });

  it("refuses another partner's protected client without saying whose", async () => {
    h.db.salesClientAccount.count
      .mockResolvedValueOnce(0) // book size
      .mockResolvedValueOnce(0) // own duplicate
      .mockResolvedValueOnce(1) // other partner, same phone
      .mockResolvedValueOnce(0);
    const res = await request(app).post("/api/sales/agency/clients").send(client);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/another NoLSAF partner/);
    expect(JSON.stringify(res.body)).not.toMatch(/NSA-|partnerId|salesPartnerId/);
    expect(h.db.salesClientAccount.create).not.toHaveBeenCalled();
  });

  it("does not let a partner register themself", async () => {
    const res = await request(app).post("/api/sales/agency/clients").send({ ...client, phone: "+255 712 000 111" });
    expect(res.status).toBe(400);
  });

  it("creates a protected client and flags a similar name for review", async () => {
    h.db.salesClientAccount.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    h.db.salesClientAccount.create.mockImplementation(async ({ data }: any) => ({ ...data, createdAt: new Date() }));
    const res = await request(app).post("/api/sales/agency/clients").send(client);
    expect(res.status).toBe(201);
    expect(res.body.client.reference).toMatch(/^sc_[a-f0-9]{20}$/);
    expect(res.body.warning).toBeTruthy();
    const data = h.db.salesClientAccount.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ salesPartnerId: 77, phoneKey: "755123456", duplicateReviewStatus: "POSSIBLE_DUPLICATE" });
    expect(data.protectionExpiresAt.getTime()).toBeGreaterThan(Date.now() + 360 * DAY);
  });
});

describe("group requests", () => {
  it("validates the group like the customer form", async () => {
    const res = await request(app).post("/api/sales/agency/groups").send({ clientName: "Mary", clientPhone: "0755123456", request: { ...groupPayload, headcount: 0 } });
    expect(res.status).toBe(400);
  });

  it("refuses the partner's own phone as the client", async () => {
    const res = await request(app).post("/api/sales/agency/groups").send({ clientName: "Me", clientPhone: "0712000111", request: groupPayload });
    expect(res.status).toBe(400);
    expect(h.db.salesAgencyGroupRequest.create).not.toHaveBeenCalled();
  });

  it("stores only the token hash and texts the client", async () => {
    h.db.salesAgencyGroupRequest.count.mockResolvedValue(0);
    h.db.salesAgencyGroupRequest.create.mockImplementation(async ({ data }: any) => ({ ...data, status: "AWAITING_CLIENT" }));
    const res = await request(app).post("/api/sales/agency/groups").send({ clientName: "Mary", clientPhone: "0755123456", request: groupPayload });
    expect(res.status).toBe(201);
    const data = h.db.salesAgencyGroupRequest.create.mock.calls[0][0].data;
    expect(data.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const sms = String((h.sendSms.mock.calls[0] as unknown[])[1]);
    const token = /t=([A-Za-z0-9_-]{43})/.exec(sms)![1];
    expect(hashGroupRequestToken(token)).toBe(data.tokenHash);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(sms).toContain("only ever pay NoLSAF");
  });
});

describe("client confirmation", () => {
  const { token, tokenHash } = newGroupRequestToken();
  const pending = {
    id: 9, reference: "gr_0123456789abcdef0123", salesPartnerId: 77, clientId: null, clientPhoneKey: "755123456", status: "AWAITING_CLIENT",
    tokenHash, tokenExpiresAt: new Date(Date.now() + DAY), payload: groupPayload, biddingDays: 3,
  };

  beforeEach(() => {
    h.session.user = { id: 900, role: "CUSTOMER" };
    h.db.salesAgencyGroupRequest.findUnique.mockResolvedValue(pending);
  });

  it("answers the same 404 for a wrong phone, the partner, an expired or a malformed link", async () => {
    h.db.user.findUnique.mockResolvedValue({ id: 900, phone: "0799999999" });
    const wrongPhone = await request(app).post("/api/agency-group/confirm").send({ token });
    h.db.user.findUnique.mockResolvedValue({ id: 501, phone: "0755123456" });
    h.session.user = { id: 501, role: "USER" };
    const partnerSelf = await request(app).post("/api/agency-group/confirm").send({ token });
    h.session.user = { id: 900, role: "CUSTOMER" };
    h.db.user.findUnique.mockResolvedValue({ id: 900, phone: "0755123456" });
    h.db.salesAgencyGroupRequest.findUnique.mockResolvedValueOnce({ ...pending, tokenExpiresAt: new Date(Date.now() - 1) });
    const expired = await request(app).post("/api/agency-group/confirm").send({ token });
    const malformed = await request(app).post("/api/agency-group/confirm").send({ token: "abc" });
    for (const res of [wrongPhone, partnerSelf, expired, malformed]) {
      expect(res.status).toBe(404);
      expect(res.body).toEqual(wrongPhone.body);
    }
    expect(h.db.groupBooking.create).not.toHaveBeenCalled();
  });

  it("refuses when the partner has lost the desk", async () => {
    h.db.user.findUnique.mockResolvedValue({ id: 900, phone: "0755123456" });
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partnerRow({ payoutHoldAt: new Date() }));
    expect((await request(app).post("/api/agency-group/confirm").send({ token })).status).toBe(404);
  });

  it("refuses an account whose phone was never verified by a code", async () => {
    // A partner could register the client's number by password without proving it.
    h.db.user.findUnique.mockResolvedValue({ id: 900, phone: "0755123456", phoneVerifiedAt: null });
    const preview = await request(app).post("/api/agency-group/preview").send({ token });
    const confirm = await request(app).post("/api/agency-group/confirm").send({ token });
    for (const res of [preview, confirm]) {
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("PHONE_NOT_VERIFIED");
    }
    expect(h.db.salesAgencyGroupRequest.updateMany).not.toHaveBeenCalled();
    expect(h.db.groupBooking.create).not.toHaveBeenCalled();
  });

  it("creates the client's group stay, prepaid in full and open for bids, exactly once", async () => {
    h.db.user.findUnique.mockResolvedValue({ id: 900, phone: "+255755123456", phoneVerifiedAt: new Date() });
    h.db.salesAgencyGroupRequest.updateMany.mockResolvedValueOnce({ count: 1 });
    h.db.groupBooking.create.mockImplementation(async ({ data }: any) => ({ id: 4400, ...data }));
    const res = await request(app).post("/api/agency-group/confirm").send({ token });
    expect(res.status).toBe(200);
    expect(h.db.salesAgencyGroupRequest.updateMany.mock.calls[0][0].where).toMatchObject({ id: 9, status: "AWAITING_CLIENT", tokenHash });
    expect(h.db.groupBooking.create.mock.calls[0][0].data).toMatchObject({ userId: 900, paymentMode: "FULL", isOpenForClaims: true, status: "PENDING" });
    expect(h.db.groupBookingAudit.create.mock.calls[0][0].data).toMatchObject({ action: "OPENED_FOR_CLAIMS" });

    h.db.salesAgencyGroupRequest.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request(app).post("/api/agency-group/confirm").send({ token })).status).toBe(404);
    expect(h.db.groupBooking.create).toHaveBeenCalledTimes(1);
  });
});

describe("shortlist", () => {
  const confirmed = { id: 9, reference: "gr_0123456789abcdef0123", salesPartnerId: 77, status: "CONFIRMED", groupBookingId: 4400 };
  const group = { id: 4400, userId: 900, status: "PENDING", isOpenForClaims: true, confirmedPropertyId: null, roomsNeeded: 12, depositPaid: false };

  beforeEach(() => {
    h.db.salesAgencyGroupRequest.findFirst.mockResolvedValue(confirmed);
    h.db.groupBooking.findUnique.mockResolvedValue(group);
  });

  it("only takes open bids on this group", async () => {
    h.db.groupBookingClaim.findMany.mockResolvedValue([]);
    const res = await request(app).post("/api/sales/agency/groups/gr_0123456789abcdef0123/shortlist").send({ propertyKeys: ["cm1abc23xyz"] });
    expect(res.status).toBe(400);
  });

  it("refuses the partner's own property", async () => {
    h.db.groupBookingClaim.findMany.mockResolvedValue([{ propertyId: 40, totalAmount: "1000000", property: { publicKey: "cm1abc23xyz", services: null } }]);
    h.db.property.findUnique.mockResolvedValue({ owner: { id: 501, email: "partner@example.com", phone: null } });
    const res = await request(app).post("/api/sales/agency/groups/gr_0123456789abcdef0123/shortlist").send({ propertyKeys: ["cm1abc23xyz"] });
    expect(res.status).toBe(400);
    expect(h.db.groupBooking.update).not.toHaveBeenCalled();
  });

  it("publishes a normal shortlist to the client", async () => {
    h.db.groupBookingClaim.findMany.mockResolvedValue([{ propertyId: 40, totalAmount: "1000000", property: { publicKey: "cm1abc23xyz", services: null } }]);
    const res = await request(app).post("/api/sales/agency/groups/gr_0123456789abcdef0123/shortlist").send({ propertyKeys: ["cm1abc23xyz"] });
    expect(res.body.shortlistStatus).toBe("PUBLISHED");
    expect(h.db.groupBooking.update.mock.calls[0][0].data).toEqual({ recommendedPropertyIds: [40] });
  });

  it("holds a large group's shortlist for admin review, showing the client nothing yet", async () => {
    h.db.groupBookingClaim.findMany.mockResolvedValue([{ propertyId: 40, totalAmount: "20000000", property: { publicKey: "cm1abc23xyz", services: null } }]);
    const res = await request(app).post("/api/sales/agency/groups/gr_0123456789abcdef0123/shortlist").send({ propertyKeys: ["cm1abc23xyz"] });
    expect(res.body.shortlistStatus).toBe("PENDING_REVIEW");
    expect(h.db.groupBooking.update.mock.calls[0][0].data).toEqual({ recommendedPropertyIds: [] });
    expect(h.notifyAdmins).toHaveBeenCalledWith("sales_agency_shortlist_review", expect.anything());
    expect(h.notifyUser).not.toHaveBeenCalled();
  });

  it("refuses shortlist, invites and property flags on a cancelled group", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...group, status: "CANCELED" });
    h.db.groupBookingClaim.findMany.mockResolvedValue([{ propertyId: 40, totalAmount: "1000000", property: { publicKey: "cm1abc23xyz", services: null } }]);
    const base = "/api/sales/agency/groups/gr_0123456789abcdef0123";
    expect((await request(app).post(`${base}/shortlist`).send({ propertyKeys: ["cm1abc23xyz"] })).status).toBe(409);
    expect((await request(app).post(`${base}/invite`).send({ propertyUrls: ["https://www.nolsaf.com/public/properties/cm1abc23xyz"] })).status).toBe(409);
    expect((await request(app).post(`${base}/leads`).send({ leadRef: "sl_0123456789abcdef0123" })).status).toBe(409);
    expect(h.db.groupBooking.update).not.toHaveBeenCalled();
  });

  it("cannot touch another partner's group", async () => {
    h.db.salesAgencyGroupRequest.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/api/sales/agency/groups/gr_0123456789abcdef0123/shortlist").send({ propertyKeys: ["cm1abc23xyz"] })).status).toBe(404);
    expect(h.db.salesAgencyGroupRequest.findFirst.mock.calls[0][0].where).toMatchObject({ salesPartnerId: 77 });
  });
});

describe("review threshold", () => {
  it("flags big groups by rooms or by value", () => {
    expect(shortlistNeedsReview({ roomsNeeded: 30, customerTotals: [100] })).toBe(true);
    expect(shortlistNeedsReview({ roomsNeeded: 5, customerTotals: [10_000_000] })).toBe(true);
    expect(shortlistNeedsReview({ roomsNeeded: 5, customerTotals: [9_999_999] })).toBe(false);
  });
});

describe("accrueAgencyGroupCommission", () => {
  const paidAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const gb = { id: 4400, status: "CONFIRMED", paymentMode: "FULL", depositPaid: true, depositPaidAt: paidAt, totalAmount: "11000000", ownerAmount: "10000000", currency: "TZS", checkOut: new Date(Date.now() + 10 * DAY), confirmedPropertyId: 40, userId: 900, payerPhone: "0755123456", user: { email: "c@example.com", phone: "0755123456" } };

  beforeEach(() => {
    h.db.salesCommission.findUnique.mockResolvedValue(null);
    h.db.salesAgencyGroupRequest.findUnique.mockResolvedValue({ reference: "gr_x", salesPartnerId: 77, status: "CONFIRMED" });
    h.db.groupBooking.findUnique.mockResolvedValue(gb);
    h.db.salesCommission.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
  });

  it("earns the rate on NoLSAF's commission only", async () => {
    await accrueAgencyGroupCommission(h.db, 4400);
    expect(h.db.salesCommission.create.mock.calls[0][0].data).toMatchObject({ type: "AGENCY_GROUP", sourceKey: "AGENCY_GROUP:4400", status: "VALIDATING", commissionAmount: 250000 });
  });

  it("pays nothing on a deposit-mode group or before payment", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...gb, paymentMode: "DEPOSIT" });
    expect((await accrueAgencyGroupCommission(h.db, 4400)).created).toBe(false);
    h.db.groupBooking.findUnique.mockResolvedValue({ ...gb, depositPaid: false });
    expect((await accrueAgencyGroupCommission(h.db, 4400)).created).toBe(false);
    expect(h.db.salesCommission.create).not.toHaveBeenCalled();
  });

  it("records the partner paying for their own group as reversed", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...gb, payerPhone: "0712000111" });
    await accrueAgencyGroupCommission(h.db, 4400);
    expect(h.db.salesCommission.create.mock.calls[0][0].data.status).toBe("REVERSED");
  });
});

describe("partner notices on agency groups", () => {
  it("tells the partner, with the deadline in EAT, when the client chooses", async () => {
    h.db.salesAgencyGroupRequest.findUnique.mockResolvedValue({ reference: "gr_0123456789abcdef0123", clientName: "Moshi Teachers", salesPartner: { userId: 501 } });
    await notifyAgencyPartnerAboutGroup(h.db, 4400, "chosen", { dueAt: new Date("2026-12-01T09:00:00Z") });
    expect(h.notifyUser).toHaveBeenCalledWith(501, "sales_partner_agency_group_chosen", expect.objectContaining({
      reference: "gr_0123456789abcdef0123",
      dueAt: expect.stringMatching(/12:00 EAT$/),
      actionPath: "/sales/agency/groups/gr_0123456789abcdef0123",
    }));
  });

  it("does nothing for an ordinary group and never throws", async () => {
    h.db.salesAgencyGroupRequest.findUnique.mockResolvedValue(null);
    await notifyAgencyPartnerAboutGroup(h.db, 4400, "offer");
    h.db.salesAgencyGroupRequest.findUnique.mockRejectedValue(new Error("db down"));
    await expect(notifyAgencyPartnerAboutGroup(h.db, 4400, "paid")).resolves.toBeUndefined();
    expect(h.notifyUser).not.toHaveBeenCalled();
  });
});
