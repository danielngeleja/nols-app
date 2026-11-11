// NRMS claims: activation needs NRMS switched on after the partner's claim, and
// a lapsed NRMS claim frees the property for a new conversion. The real admin
// router runs over HTTP; the database and side services are stood in for.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    propertySalesAttribution: { findUnique: fn(), findMany: fn(), updateMany: fn(), create: fn() },
    salesLead: { findUnique: fn(), updateMany: fn() },
    salesLeadActivity: { create: fn() },
    property: { findUnique: fn() },
    auditLog: { create: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, notifyUser: vi.fn(async () => undefined), latestOwnerConfirmation: vi.fn() };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 1, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/financeGrant.js", () => ({ requireAdminFinanceGrant: (_req: any, _res: any, next: any) => next() }));
vi.mock("../middleware/rateLimit.js", () => ({
  limitSalesAdminRead: (_req: any, _res: any, next: any) => next(),
  limitSalesAdminWrite: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/salesSelfDealing.js", () => ({ loadPartnerIdentity: vi.fn(async () => null), partnerOwnsPropertyReason: vi.fn(async () => null) }));
vi.mock("../lib/salesVisitView.js", () => ({ serializeVisit: (v: any) => v, visitSelect: {} }));
vi.mock("../lib/salesOwnerConfirmation.js", () => ({
  latestOwnerConfirmation: h.latestOwnerConfirmation,
  requestOwnerConfirmations: vi.fn(async () => []),
  deliverOwnerConfirmationNotices: vi.fn(async () => undefined),
}));

import router from "../routes/admin.sales.attributions.js";

const app = express();
app.use(express.json());
app.use("/api/admin/sales", router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const DAY = 86_400_000;
const claimedAt = new Date(Date.now() - 40 * DAY);
const contract = { id: 5, status: "ACTIVE", startsAt: new Date(Date.now() - 100 * DAY), expiresAt: new Date(Date.now() + 200 * DAY) };

function nrmsClaim(nrmsActivatedAt: Date | null) {
  return {
    id: 21, status: "VERIFIED", propertyId: 30, productType: "NRMS", salesPartnerId: 4,
    attributedAt: claimedAt, verifiedAt: new Date(claimedAt.getTime() + DAY), lead: { createdAt: claimedAt },
    property: { title: "Minza Executive Lodge", nrmsActivatedAt },
    salesPartner: { userId: 77, agentCode: "NSA-DAR-0001", status: "ACTIVE", contracts: [contract] },
  };
}
const activate = (body: object = {}) => request(app).post("/api/admin/sales/attributions/21/activate").send({ reason: "Owner confirmed by phone", ...body });

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  h.latestOwnerConfirmation.mockResolvedValue({ status: "CONFIRMED" });
  h.db.propertySalesAttribution.updateMany.mockResolvedValue({ count: 1 });
  h.db.auditLog.create.mockResolvedValue({});
});

describe("activating an NRMS claim", () => {
  it("is refused while NRMS is not switched on, and says when it lapses", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue(nrmsClaim(null));
    const res = await activate();
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/not switched on/);
    expect(res.body.error).toMatch(/lapses/);
    expect(h.db.propertySalesAttribution.updateMany).not.toHaveBeenCalled();
  });

  it("is refused when NRMS was on before the partner's claim, unless an admin overrides with a reason", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue(nrmsClaim(new Date(claimedAt.getTime() - 10 * DAY)));
    expect((await activate()).status).toBe(409);
    expect(h.db.propertySalesAttribution.updateMany).not.toHaveBeenCalled();
    const res = await activate({ nrmsOverride: true });
    expect(res.status).toBe(200);
    expect(h.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ afterJson: expect.objectContaining({ nrmsCheck: "ON_BEFORE_CLAIM", nrmsOverride: true }) }) });
  });

  it("goes through when NRMS was switched on after the claim", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue(nrmsClaim(new Date(claimedAt.getTime() + 5 * DAY)));
    const res = await activate();
    expect(res.status).toBe(200);
    expect(h.db.propertySalesAttribution.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "ACTIVE" }) }));
  });

  it("leaves marketplace claims as they were", async () => {
    h.db.propertySalesAttribution.findUnique.mockResolvedValue({ ...nrmsClaim(null), productType: "MARKETPLACE" });
    expect((await activate()).status).toBe(200);
  });
});

describe("a lapsed NRMS claim frees the property", () => {
  const lead = {
    id: 60, salesPartnerId: 8, propertyName: "Minza Executive Lodge", proposedProduct: "NRMS_AND_MARKETPLACE", status: "CONVERSION_REQUESTED", duplicateReviewStatus: "CLEAR",
    salesPartner: { id: 8, userId: 88, agentCode: "NSA-DAR-0007", status: "ACTIVE", contracts: [contract] },
  };
  beforeEach(() => {
    h.db.salesLead.findUnique.mockResolvedValue(lead);
    h.db.salesLead.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesLeadActivity.create.mockResolvedValue({});
    h.db.property.findUnique.mockResolvedValue({ id: 30, title: "Minza Executive Lodge", status: "APPROVED" });
    h.db.propertySalesAttribution.create.mockImplementation(async ({ data }: any) => ({ id: 99, ...data }));
    h.db.propertySalesAttribution.findUnique.mockImplementation(async ({ where }: any) => ({ id: where.id, propertyId: 30, salesPartnerId: 8, productType: "NRMS", status: "VERIFIED" }));
  });
  const approve = () => request(app).post("/api/admin/sales/leads/60/approve-conversion").send({ propertyId: 30, reason: "Owner signed up with this partner" });

  it("a new conversion takes the lapsed NRMS row over in place and creates the marketplace row", async () => {
    h.db.propertySalesAttribution.findMany.mockResolvedValue([{ id: 21, productType: "NRMS", status: "LAPSED", salesPartnerId: 4, salesPartner: { agentCode: "NSA-DAR-0001" } }]);
    const res = await approve();
    expect(res.status).toBe(201);
    expect(h.db.propertySalesAttribution.updateMany).toHaveBeenCalledWith({
      where: { id: 21, status: "LAPSED" },
      data: expect.objectContaining({ salesPartnerId: 8, leadId: 60, status: "VERIFIED", commissionStartsAt: null, commissionEndsAt: null, reassignedToPartnerId: 8 }),
    });
    expect(h.db.propertySalesAttribution.create).toHaveBeenCalledTimes(1);
    expect(h.db.propertySalesAttribution.create.mock.calls[0][0].data.productType).toBe("MARKETPLACE");
    expect(h.db.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ afterJson: expect.objectContaining({ takenOverLapsedClaims: [{ id: 21, productType: "NRMS", fromPartnerId: 4 }] }) }) });
  });

  it("a claim that has not lapsed still blocks the conversion", async () => {
    h.db.propertySalesAttribution.findMany.mockResolvedValue([{ id: 21, productType: "NRMS", status: "VERIFIED", salesPartnerId: 4, salesPartner: { agentCode: "NSA-DAR-0001" } }]);
    const res = await approve();
    expect(res.status).toBe(409);
    expect(h.db.propertySalesAttribution.create).not.toHaveBeenCalled();
  });
});
