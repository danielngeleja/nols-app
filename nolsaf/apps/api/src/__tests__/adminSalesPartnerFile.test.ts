// The admin partner file: the whole record opened for review, with opaque
// references instead of row ids and payout accounts masked.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesPartnerProfile: { findUnique: fn() },
    salesLead: { findMany: fn() },
    propertySalesAttribution: { findMany: fn() },
    salesCommission: { groupBy: fn(), findMany: fn() },
    salesPayoutRequest: { findMany: fn() },
    salesLeadVisit: { findMany: fn() },
    auditLog: { findMany: fn() },
    user: { findMany: fn() },
  };
  return { db, user: { id: 7, role: "ADMIN" } as any };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn() }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: vi.fn(), notifyAdmins: vi.fn() }));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn() }));
vi.mock("../lib/salesPartnerEmails.js", () => ({ salesAgreementInvitationEmail: vi.fn() }));
vi.mock("../lib/salesContractInvitation.js", () => ({ createSalesContractInvitation: vi.fn() }));
vi.mock("../lib/salesContractStorage.js", () => ({ storeSalesContractPdf: vi.fn() }));
vi.mock("../lib/salesTeamInvites.js", () => ({ approveInviteInPromotion: vi.fn(), joinTeamOnActivation: vi.fn() }));
vi.mock("../lib/salesLeaderboard.js", () => ({ clearBoardCache: vi.fn() }));
vi.mock("../lib/salesPartnerContract.js", () => ({
  finalizeAcceptedSalesContractFields: vi.fn(), generateSalesContractPdf: vi.fn(), renderSalesContract: vi.fn(), sha256: vi.fn(),
}));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret", publicLinkSecrets: () => ["test-secret"] }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = h.user; next(); },
  requireRole: (role: string) => (req: any, res: any, next: any) => (req.user?.role === role ? next() : res.status(403).json({ error: "Forbidden" })),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));

import router from "../routes/admin.sales.partners.js";

const app = express();
app.use(express.json());
app.use("/api/admin/sales", router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: 7, role: "ADMIN" };
  h.db.salesPartnerProfile.findUnique.mockResolvedValue({
    id: 11, taxIdNumber: "123-456-789", levelUpdatedAt: null, payoutName: "Amon Mushi",
    user: { id: 101, createdAt: new Date("2026-01-01"), emailVerifiedAt: new Date(), phoneVerifiedAt: null, avatarUrl: "x" },
  });
  h.db.salesLead.findMany.mockResolvedValue([
    { id: 501, propertyName: "Lake Lodge", status: "CONTACTED", proposedProduct: "NRMS", region: "Mwanza", district: null, contactPerson: "Asha", contactPhone: "0755",
      createdAt: new Date(), updatedAt: new Date(), nextFollowUpAt: null, protectionExpiresAt: null, duplicateReviewStatus: "CLEAR", conversionRequestedAt: null,
      convertedAt: null, lostReason: null, _count: { activities: 2, visits: 1 } },
  ]);
  h.db.propertySalesAttribution.findMany.mockResolvedValue([
    { propertyId: 40, productType: "NRMS", status: "ACTIVE", attributedAt: new Date(), verifiedAt: null, commissionStartsAt: null, commissionEndsAt: null,
      disputeReason: null, revokedAt: null, property: { title: "Lake Lodge", regionName: "Mwanza", district: null, status: "APPROVED" } },
  ]);
  h.db.salesCommission.groupBy.mockImplementation(async ({ by }: any) =>
    by[0] === "propertyId" ? [{ propertyId: 40, _sum: { commissionAmount: "12000" } }] : [{ type: "NRMS_USAGE", status: "AVAILABLE", _sum: { commissionAmount: "12000" }, _count: { _all: 1 } }],
  );
  h.db.salesCommission.findMany.mockResolvedValue([
    { id: 900, type: "NRMS_USAGE", status: "AVAILABLE", propertyId: 40, commissionAmount: "12000", eligibleNetRevenue: "85000", commissionRate: "14", currency: "TZS",
      earnedAt: new Date(), eligibleAt: null, paidAt: null, reversalReason: null, description: null, property: { title: "Lake Lodge" } },
  ]);
  h.db.salesPayoutRequest.findMany.mockResolvedValue([
    { referenceNumber: "SPO-0001", status: "PAID", lane: "AUTO", requestedAmount: "60000", approvedAmount: "60000", deductionAmount: "0", withholdingTaxAmount: "0",
      netPaidAmount: "60000", currency: "TZS", payoutMethod: "MOBILE_MONEY", payoutAccount: "0755123456", requestedAt: new Date(), approvedAt: null, paidAt: new Date(),
      rejectedAt: null, rejectionReason: null, paymentReference: "MP-1" },
  ]);
  h.db.salesLeadVisit.findMany.mockResolvedValue([]);
  h.db.auditLog.findMany.mockResolvedValue([{ action: "SALES_PARTNER_SUSPEND", actorId: 7, actorRole: "ADMIN", afterJson: { reason: "Owner complaint" }, createdAt: new Date() }]);
  h.db.user.findMany.mockResolvedValue([{ id: 7, name: "Admin Mary", fullName: null }]);
});

describe("GET /partners/:id/file", () => {
  it("is admin only", async () => {
    h.user = { id: 101, role: "USER" };
    expect((await request(app).get("/api/admin/sales/partners/11/file")).status).toBe(403);
  });

  it("opens the whole file with references, never row ids, and a masked payout account", async () => {
    const res = await request(app).get("/api/admin/sales/partners/11/file");
    expect(res.status).toBe(200);
    expect(res.body.leads[0].ref).toMatch(/^sl_/);
    expect(res.body.properties[0]).toMatchObject({ title: "Lake Lodge", earned: 12000 });
    expect(res.body.properties[0].ref).toMatch(/^pp_/);
    expect(res.body.earnings.rows[0].ref).toMatch(/^se_/);
    expect(res.body.withdrawals[0].destination).toBe("MOBILE_MONEY ending 3456");
    expect(res.body.history[0]).toMatchObject({ by: "Admin Mary", reason: "Owner complaint" });
    expect(res.body.account).toMatchObject({ taxIdNumber: "123-456-789", phoneVerified: false, emailVerified: true });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain("0755123456");
    expect(text).not.toMatch(/"(id|propertyId|leadId)":/);
  });

  it("404s for an unknown partner", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(null);
    expect((await request(app).get("/api/admin/sales/partners/999/file")).status).toBe(404);
  });
});
