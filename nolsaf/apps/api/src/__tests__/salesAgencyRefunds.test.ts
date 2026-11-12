// Refunds for fully prepaid agency groups, and the guest status lock on group stays.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesAgencyGroupRequest: { findUnique: fn() },
    groupBooking: { findUnique: fn(), findFirst: fn(), updateMany: fn() },
    groupBookingClaim: { updateMany: fn() },
    propertyAvailabilityBlock: { deleteMany: fn() },
    groupBookingAudit: { create: fn() },
    tourBooking: { findUnique: fn(), findMany: fn() },
    tourBookingAttribution: { findUnique: fn(), updateMany: fn(), findMany: fn(), groupBy: fn() },
    salesCommission: { findUnique: fn(), findMany: fn() },
  };
  db.$transaction = vi.fn(async (op: any) => op(db));
  return {
    db,
    audit: vi.fn(async () => undefined),
    notifyUser: vi.fn(async () => undefined),
    reverse: vi.fn(async () => ({ status: "created", entry: { id: 1 } })),
    user: { id: 1, role: "ADMIN" } as any,
    financeGrant: { ok: true },
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: vi.fn(async () => undefined) }));
vi.mock("../lib/revenueRecognition.js", () => ({ reverseGroupStayRefund: h.reverse }));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesAdminRead: pass, limitSalesAdminWrite: pass };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/financeGrant.js", () => ({
  requireAdminFinanceGrant: (_req: any, res: any, next: any) => (h.financeGrant.ok ? next() : res.status(403).json({ error: "OTP required", require2fa: true })),
}));

import adminRouter from "../routes/admin.sales.agency.js";
import groupBookingsRouter from "../routes/groupBookings.js";

const app = express();
app.use(express.json());
app.use("/api/admin/sales", adminRouter);
app.use("/api/group-bookings", groupBookingsRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const REF = "gr_0123456789abcdef0123";
const paidGroup = {
  id: 4400, userId: 900, status: "CONFIRMED", paymentMode: "FULL", depositPaid: true, depositAmount: "11000000", totalAmount: "11000000", ownerAmount: "10000000",
  currency: "TZS", checkedInAt: null, ownerPayoutStatus: "NONE", paymentRef: "x", checkoutSessionId: "y", updatedAt: new Date(Date.now() - 3 * 86400000),
  assignedOwnerId: 300, confirmedPropertyId: 40,
};

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: 1, role: "ADMIN" };
  h.financeGrant.ok = true;
  h.db.$transaction.mockImplementation(async (op: any) => op(h.db));
  h.db.salesAgencyGroupRequest.findUnique.mockResolvedValue({ reference: REF, groupBookingId: 4400 });
  h.db.groupBooking.findUnique.mockResolvedValue(paidGroup);
  h.db.groupBooking.updateMany.mockResolvedValue({ count: 1 });
});

describe("cancel a prepaid agency group", () => {
  it("needs the finance code", async () => {
    h.financeGrant.ok = false;
    const res = await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Client called off the event" });
    expect(res.status).toBe(403);
    expect(h.db.groupBooking.updateMany).not.toHaveBeenCalled();
  });

  it("records the full amount as due back by default", async () => {
    const res = await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Client called off the event" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ refundStatus: "DUE", refundAmount: 11000000 });
    expect(h.db.groupBooking.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 4400, checkedInAt: null, refundStatus: "NONE" },
      data: { status: "CANCELED", refundStatus: "DUE", refundAmount: 11000000, refundRetainedAmount: 0 },
    });
    expect(h.db.propertyAvailabilityBlock.deleteMany.mock.calls[0][0].where).toMatchObject({ notes: "Reserved for group stay request #4400" });
  });

  it("lets NoLSAF keep at most its own commission, never the owner's share", async () => {
    const tooMuch = await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Late cancellation", retainAmount: 1_000_001 });
    expect(tooMuch.status).toBe(400);
    const ok = await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Late cancellation", retainAmount: 1_000_000 });
    expect(ok.body).toMatchObject({ refundStatus: "DUE", refundAmount: 10000000 });
  });

  it("refuses after check-in or once the owner was paid", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...paidGroup, checkedInAt: new Date() });
    expect((await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Too late now" })).status).toBe(409);
    h.db.groupBooking.findUnique.mockResolvedValue({ ...paidGroup, ownerPayoutStatus: "PAID" });
    expect((await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Too late now" })).status).toBe(409);
    expect(h.db.groupBooking.updateMany).not.toHaveBeenCalled();
  });

  it("waits while an unpaid group's payment may still be confirming", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...paidGroup, depositPaid: false, updatedAt: new Date() });
    expect((await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Client changed plans" })).status).toBe(409);
  });

  it("only applies to prepaid groups", async () => {
    h.db.groupBooking.findUnique.mockResolvedValue({ ...paidGroup, paymentMode: "DEPOSIT" });
    expect((await request(app).post(`/api/admin/sales/agency/groups/${REF}/cancel`).send({ reason: "Client changed plans" })).status).toBe(404);
  });
});

describe("record the refund", () => {
  it("moves DUE to REFUNDED once and reverses the revenue in the same transaction", async () => {
    const res = await request(app).post(`/api/admin/sales/agency/groups/${REF}/refund`).send({ transferRef: "CRDB-778812", reason: "Refund sent by bank transfer" });
    expect(res.status).toBe(200);
    expect(h.db.groupBooking.updateMany.mock.calls[0][0].where).toMatchObject({ id: 4400, refundStatus: "DUE" });
    expect(h.reverse).toHaveBeenCalledWith(h.db, 4400);

    h.db.groupBooking.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request(app).post(`/api/admin/sales/agency/groups/${REF}/refund`).send({ transferRef: "CRDB-778812", reason: "Refund sent twice" })).status).toBe(409);
  });
});

describe("owner payout on a cancelled group", () => {
  it("is never recorded", async () => {
    await request(app).post(`/api/admin/sales/agency/groups/${REF}/owner-payout`).send({ transferRef: "M-PESA-1", reason: "Owner paid after stay" });
    expect(h.db.groupBooking.updateMany.mock.calls[0][0].where).toMatchObject({ status: { notIn: ["CANCELED", "CANCELLED"] }, refundStatus: "NONE" });
  });
});

describe("agency tour monitoring", () => {
  it("lists every tour credit with blocked attempts first", async () => {
    h.db.tourBookingAttribution.findMany.mockResolvedValue([
      { tourBookingId: 1, status: "ACTIVE", blockedReason: null, voidReason: null, createdAt: new Date("2026-11-10"), salesPartner: { agentCode: "NSA-DAR-0001", user: null }, link: null },
      { tourBookingId: 2, status: "BLOCKED", blockedReason: "The sales partner is the tour operator (same account).", voidReason: null, createdAt: new Date("2026-11-09"), salesPartner: { agentCode: "NSA-DAR-0002", user: null }, link: null },
    ]);
    h.db.tourBooking.findMany.mockResolvedValue([
      { id: 1, bookingCode: "TOUR-1", title: "A", destination: null, startDate: null, travelerCount: 2, status: "PAID", paymentStatus: "PAID", grossAmount: "100", commissionAmount: "15", currency: "TZS", operatorSnapshot: null },
      { id: 2, bookingCode: "TOUR-2", title: "B", destination: null, startDate: null, travelerCount: 2, status: "PAID", paymentStatus: "PAID", grossAmount: "100", commissionAmount: "15", currency: "TZS", operatorSnapshot: null },
    ]);
    h.db.salesCommission.findMany.mockResolvedValue([]);
    h.db.tourBookingAttribution.groupBy.mockResolvedValue([{ status: "ACTIVE", _count: { _all: 1 } }, { status: "BLOCKED", _count: { _all: 1 } }]);
    const res = await request(app).get("/api/admin/sales/agency/tours");
    expect(res.status).toBe(200);
    expect(res.body.items[0]).toMatchObject({ bookingCode: "TOUR-2", credit: "BLOCKED" });
    expect(res.body.counts).toEqual({ active: 1, blocked: 1, void: 0 });
    expect(JSON.stringify(res.body)).not.toMatch(/"tourBookingId"/);
  });

  it("voids a tour credit only with the finance code and a reason, keyed by booking code", async () => {
    h.financeGrant.ok = false;
    expect((await request(app).post("/api/admin/sales/agency/tours/void").send({ bookingCode: "TOUR-20261101-AB12", reason: "Fake traveller found" })).status).toBe(403);
    h.financeGrant.ok = true;
    expect((await request(app).post("/api/admin/sales/agency/tours/void").send({ bookingCode: "TOUR-20261101-AB12" })).status).toBe(400);

    h.db.tourBooking.findUnique.mockResolvedValue({ id: 700 });
    h.db.tourBookingAttribution.findUnique.mockResolvedValue({ id: 3, status: "ACTIVE" });
    h.db.tourBookingAttribution.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesCommission.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/admin/sales/agency/tours/void").send({ bookingCode: "TOUR-20261101-AB12", reason: "Fake traveller found" });
    expect(res.status).toBe(200);
    expect(h.db.tourBookingAttribution.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 3, status: "ACTIVE" }, data: { status: "VOID", voidedById: 1 } });
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), "SALES_AGENCY_TOUR_ATTRIBUTION_VOID", "TOUR_BOOKING", expect.anything(), expect.objectContaining({ status: "VOID" }), 700);

    h.db.tourBookingAttribution.findUnique.mockResolvedValue({ id: 3, status: "VOID" });
    expect((await request(app).post("/api/admin/sales/agency/tours/void").send({ bookingCode: "TOUR-20261101-AB12", reason: "Again please" })).status).toBe(404);
  });
});

describe("guest status changes", () => {
  beforeEach(() => {
    h.user = { id: 900, role: "CUSTOMER" };
  });

  it("cannot confirm or complete their own group stay", async () => {
    h.db.groupBooking.findFirst.mockResolvedValue({ ...paidGroup, depositPaid: false, status: "PENDING" });
    for (const status of ["CONFIRMED", "COMPLETED", "PROCESSING", "PENDING"]) {
      expect((await request(app).patch("/api/group-bookings/4400/status").send({ status })).status).toBe(403);
    }
    expect(h.db.groupBooking.updateMany).not.toHaveBeenCalled();
  });

  it("cannot cancel a paid group stay themselves", async () => {
    h.db.groupBooking.findFirst.mockResolvedValue(paidGroup);
    expect((await request(app).patch("/api/group-bookings/4400/status").send({ status: "CANCELED" })).status).toBe(409);
    expect((await request(app).delete("/api/group-bookings/4400")).status).toBe(400);
    expect(h.db.groupBooking.updateMany).not.toHaveBeenCalled();
  });

  it("can still withdraw an unpaid request, guarded against a payment landing", async () => {
    h.db.groupBooking.findFirst.mockResolvedValue({ ...paidGroup, depositPaid: false, status: "AWAITING_DEPOSIT" });
    h.db.groupBooking.findUnique.mockResolvedValue({ id: 4400, status: "CANCELED" });
    const res = await request(app).patch("/api/group-bookings/4400/status").send({ status: "CANCELED", cancelReason: "Plans changed" });
    expect(res.status).toBe(200);
    expect(h.db.groupBooking.updateMany.mock.calls[0][0].where).toMatchObject({ id: 4400, userId: 900, depositPaid: false, status: "AWAITING_DEPOSIT" });
  });
});
