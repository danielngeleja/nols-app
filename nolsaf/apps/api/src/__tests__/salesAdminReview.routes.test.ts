// Route-level coverage for the sales admin review actions: conversion approval
// and return, attribution activation, and payout approval and rejection. The
// real routers and business rules run over HTTP; only the database, auth, rate
// limits, the finance OTP gate and notifications are stood in for.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesLead: { findUnique: fn(), updateMany: fn() },
    salesLeadActivity: { create: fn() },
    property: { findUnique: fn() },
    propertySalesAttribution: { findMany: fn(), create: fn(), findUnique: fn(), updateMany: fn() },
    salesPayoutRequest: { findUnique: fn(), updateMany: fn() },
    salesPayoutItem: { deleteMany: fn() },
    auditLog: { create: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, notifyUser: vi.fn(async () => undefined) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const id = Number(req.get("x-test-user-id"));
    if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ error: "Unauthorized" });
    req.user = { id, role: req.get("x-test-role") || "ADMIN", imp: req.get("x-test-impersonated") === "true" };
    return next();
  },
  requireRole: (role: string) => (req: any, res: any, next: any) =>
    req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" }),
  blockImpersonated: (req: any, res: any, next: any) =>
    req.user?.imp ? res.status(403).json({ error: "Not during support session" }) : next(),
}));
vi.mock("../middleware/rateLimit.js", () => {
  const pass = (_req: any, _res: any, next: any) => next();
  return { limitSalesAdminRead: pass, limitSalesAdminWrite: pass };
});
vi.mock("../middleware/financeGrant.js", () => ({
  requireAdminFinanceGrant: (req: any, res: any, next: any) =>
    req.get("x-test-finance-grant") === "yes" ? next() : res.status(403).json({ error: "Finance verification required" }),
}));

import attributionsRouter from "../routes/admin.sales.attributions.js";
import financeRouter from "../routes/admin.sales.finance.js";

const app = express();
app.use(express.json());
app.use("/api/admin/sales", attributionsRouter);
app.use("/api/admin/sales", financeRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 24 * 60 * 60 * 1000;
const activeContract = () => ({
  id: 31,
  status: "ACTIVE",
  startsAt: new Date(Date.now() - 30 * DAY),
  expiresAt: new Date(Date.now() + 300 * DAY),
});
const admin = { "x-test-user-id": "1", "x-test-role": "ADMIN" };
const withGrant = { ...admin, "x-test-finance-grant": "yes" };
const REASON = "Verified on site with the owner";

function pendingLead(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    salesPartnerId: 11,
    propertyName: "Jamirex Hotel",
    proposedProduct: "NRMS",
    status: "CONVERSION_REQUESTED",
    duplicateReviewStatus: "CLEAR",
    salesPartner: { id: 11, userId: 101, agentCode: "NSA-DAR-0001", status: "ACTIVE", contracts: [activeContract()] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
});

describe("POST /leads/:id/approve-conversion", () => {
  beforeEach(() => {
    h.db.salesLead.findUnique.mockResolvedValue(pendingLead());
    h.db.property.findUnique.mockResolvedValue({ id: 4, title: "JAMIREX HOTEL", status: "APPROVED" });
    h.db.propertySalesAttribution.findMany.mockResolvedValue([]);
    h.db.propertySalesAttribution.create.mockImplementation(async ({ data }: any) => ({ id: 90, ...data }));
    h.db.salesLead.updateMany.mockResolvedValue({ count: 1 });
  });

  it("binds the lead to the property, records activity and audit, and notifies the partner", async () => {
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ok: true, lead: { id: 2, status: "CONVERTED", convertedPropertyId: 4 }, nextAction: "ACTIVATE_ATTRIBUTIONS" });
    expect(h.db.propertySalesAttribution.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ propertyId: 4, salesPartnerId: 11, contractId: 31, productType: "NRMS", status: "VERIFIED" }),
    }));
    expect(h.db.salesLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 2, status: "CONVERSION_REQUESTED" },
      data: expect.objectContaining({ status: "CONVERTED", convertedPropertyId: 4 }),
    }));
    expect(h.db.salesLeadActivity.create).toHaveBeenCalledTimes(1);
    expect(h.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "SALES_LEAD_CONVERSION_APPROVE", entityId: 2 }),
    }));
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_attribution_verified", expect.any(Object));
  });

  it("runs inside a transaction with the extended timeout", async () => {
    await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(h.db.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ timeout: 15000 }));
  });

  it("refuses a lead that is not awaiting conversion", async () => {
    h.db.salesLead.findUnique.mockResolvedValue(pendingLead({ status: "CONTACTED" }));
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
    expect(h.db.propertySalesAttribution.create).not.toHaveBeenCalled();
    expect(h.db.auditLog.create).not.toHaveBeenCalled();
  });

  it("requires a duplicate decision when the lead is flagged", async () => {
    h.db.salesLead.findUnique.mockResolvedValue(pendingLead({ duplicateReviewStatus: "POSSIBLE_DUPLICATE" }));
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/duplicate/i);
  });

  it("refuses when another partner already holds the product on this property", async () => {
    h.db.propertySalesAttribution.findMany.mockResolvedValue([
      { id: 5, productType: "NRMS", status: "ACTIVE", salesPartnerId: 12, salesPartner: { agentCode: "NSA-ARU-0002" } },
    ]);
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/reassignment/i);
    expect(h.db.propertySalesAttribution.create).not.toHaveBeenCalled();
  });

  it("refuses a partner without an active earning contract", async () => {
    h.db.salesLead.findUnique.mockResolvedValue(pendingLead({
      salesPartner: { id: 11, userId: 101, agentCode: "NSA-DAR-0001", status: "ACTIVE", contracts: [] },
    }));
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/contract/i);
  });

  it("reports a conflict when another administrator changed the lead first", async () => {
    h.db.salesLead.updateMany.mockResolvedValue({ count: 0 });
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
    expect(h.notifyUser).not.toHaveBeenCalled();
  });

  it("maps a unique-index collision to 409 instead of a server error", async () => {
    h.db.propertySalesAttribution.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: REASON });
    expect(res.status).toBe(409);
  });

  it("is closed to non-admins, support sessions, and short reasons", async () => {
    const body = { propertyId: 4, reason: REASON };
    expect((await request(app).post("/api/admin/sales/leads/2/approve-conversion").set({ ...admin, "x-test-role": "USER" }).send(body)).status).toBe(403);
    expect((await request(app).post("/api/admin/sales/leads/2/approve-conversion").set({ ...admin, "x-test-impersonated": "true" }).send(body)).status).toBe(403);
    expect((await request(app).post("/api/admin/sales/leads/2/approve-conversion").set(admin).send({ propertyId: 4, reason: "ok" })).status).toBe(400);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });
});

describe("POST /leads/:id/reject-conversion", () => {
  it("returns the lead to the chosen stage and tells the partner why", async () => {
    h.db.salesLead.findUnique.mockResolvedValue({ id: 2, status: "CONVERSION_REQUESTED", duplicateReviewStatus: "CLEAR", salesPartner: { userId: 101 } });
    h.db.salesLead.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post("/api/admin/sales/leads/2/reject-conversion").set(admin).send({ reason: REASON, returnStatus: "PROPOSAL_SENT" });

    expect(res.status).toBe(200);
    expect(res.body.lead).toEqual({ id: 2, status: "PROPOSAL_SENT" });
    expect(h.db.salesLead.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PROPOSAL_SENT", conversionRequestedAt: null }),
    }));
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_conversion_returned", expect.objectContaining({ reason: REASON }));
  });

  it("refuses a lead that is not awaiting conversion", async () => {
    h.db.salesLead.findUnique.mockResolvedValue({ id: 2, status: "CONVERTED", duplicateReviewStatus: "CLEAR", salesPartner: { userId: 101 } });
    const res = await request(app).post("/api/admin/sales/leads/2/reject-conversion").set(admin).send({ reason: REASON });
    expect(res.status).toBe(409);
    expect(h.db.salesLead.updateMany).not.toHaveBeenCalled();
  });
});

describe("POST /attributions/:id/activate", () => {
  const verified = () => ({
    id: 90,
    status: "VERIFIED",
    propertyId: 4,
    productType: "NRMS",
    salesPartnerId: 11,
    property: { title: "JAMIREX HOTEL" },
    salesPartner: { userId: 101, agentCode: "NSA-DAR-0001", status: "ACTIVE", contracts: [activeContract()] },
  });

  it("needs the finance verification grant", async () => {
    const res = await request(app).post("/api/admin/sales/attributions/90/activate").set(admin).send({ reason: REASON });
    expect(res.status).toBe(403);
    expect(h.db.$transaction).not.toHaveBeenCalled();
  });

  it("starts earning under the partner's current contract", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue(verified());
    h.db.propertySalesAttribution.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post("/api/admin/sales/attributions/90/activate").set(withGrant).send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.attribution).toMatchObject({ id: 90, status: "ACTIVE", contractId: 31 });
    expect(h.db.propertySalesAttribution.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 90, status: "VERIFIED", salesPartnerId: 11 },
      data: expect.objectContaining({ status: "ACTIVE", contractId: 31 }),
    }));
    expect(h.db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: "SALES_ATTRIBUTION_ACTIVATE" }),
    }));
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_attribution_approved", expect.any(Object));
  });

  it("refuses an attribution that is not VERIFIED", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue({ ...verified(), status: "ACTIVE" });
    const res = await request(app).post("/api/admin/sales/attributions/90/activate").set(withGrant).send({ reason: REASON });
    expect(res.status).toBe(409);
    expect(h.db.propertySalesAttribution.updateMany).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown attribution", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue(null);
    const res = await request(app).post("/api/admin/sales/attributions/999/activate").set(withGrant).send({ reason: REASON });
    expect(res.status).toBe(404);
  });
});

describe("payout review", () => {
  const requested = (overrides: Record<string, unknown> = {}) => ({
    id: 70,
    status: "REQUESTED",
    requestedAmount: "100000",
    currency: "TZS",
    referenceNumber: "SPR-2026-0007",
    items: [{ id: 1, commissionId: 501 }],
    salesPartner: { userId: 101 },
    ...overrides,
  });

  it("approval needs the finance verification grant", async () => {
    const res = await request(app).post("/api/admin/sales/payouts/70/approve").set(admin).send({ reason: REASON });
    expect(res.status).toBe(403);
  });

  it("approves with a deduction and pays out the net amount", async () => {
    h.db.salesPayoutRequest.findUnique.mockResolvedValue(requested());
    h.db.salesPayoutRequest.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post("/api/admin/sales/payouts/70/approve").set(withGrant).send({ reason: REASON, deductionAmount: 2500 });

    expect(res.status).toBe(200);
    expect(res.body.payout).toMatchObject({ id: 70, status: "APPROVED", netPaidAmount: 97500 });
    expect(h.db.salesPayoutRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 70, status: { in: ["REQUESTED", "UNDER_REVIEW"] } },
      data: expect.objectContaining({ status: "APPROVED", deductionAmount: 2500, netPaidAmount: 97500 }),
    }));
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_payout_approved", expect.objectContaining({ amount: 97500 }));
  });

  it("refuses a deduction that swallows the whole payout", async () => {
    h.db.salesPayoutRequest.findUnique.mockResolvedValue(requested());
    const res = await request(app).post("/api/admin/sales/payouts/70/approve").set(withGrant).send({ reason: REASON, deductionAmount: 100000 });
    expect(res.status).toBe(409);
    expect(h.db.salesPayoutRequest.updateMany).not.toHaveBeenCalled();
  });

  it("refuses a payout with no locked earnings", async () => {
    h.db.salesPayoutRequest.findUnique.mockResolvedValue(requested({ items: [] }));
    const res = await request(app).post("/api/admin/sales/payouts/70/approve").set(withGrant).send({ reason: REASON });
    expect(res.status).toBe(409);
  });

  it("rejection releases the locked earnings back to the partner", async () => {
    h.db.salesPayoutRequest.findUnique.mockResolvedValue(requested());
    h.db.salesPayoutRequest.updateMany.mockResolvedValue({ count: 1 });

    const res = await request(app).post("/api/admin/sales/payouts/70/reject").set(withGrant).send({ reason: REASON });

    expect(res.status).toBe(200);
    expect(res.body.payout).toEqual({ id: 70, status: "REJECTED" });
    expect(h.db.salesPayoutItem.deleteMany).toHaveBeenCalledWith({ where: { payoutId: 70 } });
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_payout_rejected", expect.any(Object));
  });

  it("will not approve a payout that was already rejected", async () => {
    h.db.salesPayoutRequest.findUnique.mockResolvedValue(requested({ status: "REJECTED" }));
    const res = await request(app).post("/api/admin/sales/payouts/70/approve").set(withGrant).send({ reason: REASON });
    expect(res.status).toBe(409);
  });
});
