// Admin photo review for sales partner ID cards: approve makes the card live
// (replacing an older one), reject ends the request and leaves the old card.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    salesPartnerCard: { findFirst: fn(), updateMany: fn(), count: fn(), create: fn(), update: fn() },
    salesPartnerProfile: { findUnique: fn(), updateMany: fn() },
    userWorkspaceAccess: { updateMany: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return { db, audit: vi.fn(async () => undefined), notifyUser: vi.fn(async () => undefined) };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db, typedPrisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: vi.fn() }));
vi.mock("../lib/mailer.js", () => ({ sendMail: vi.fn() }));
vi.mock("../lib/salesPartnerEmails.js", () => ({ salesAgreementInvitationEmail: vi.fn() }));
vi.mock("../lib/salesContractInvitation.js", () => ({ createSalesContractInvitation: vi.fn() }));
vi.mock("../lib/salesContractStorage.js", () => ({ storeSalesContractPdf: vi.fn() }));
vi.mock("../lib/salesTeamInvites.js", () => ({ approveInviteInPromotion: vi.fn(), joinTeamOnActivation: vi.fn() }));
vi.mock("../lib/salesLeaderboard.js", () => ({ clearBoardCache: vi.fn() }));
vi.mock("../lib/salesPartnerContract.js", () => ({
  finalizeAcceptedSalesContractFields: vi.fn(), generateSalesContractPdf: vi.fn(), renderSalesContract: vi.fn(), sha256: vi.fn(),
}));
vi.mock("../lib/publicLinkSecrets.js", () => ({ publicLinkSigningSecret: () => "test-secret" }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));

import router from "../routes/admin.sales.partners.js";

const app = express();
app.use(express.json());
app.use("/admin/sales", router);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error?.message || "error" }));

const pending = { id: 21, cardNumber: "NSA-DAR-0001-C2", salesPartner: { userId: 101 } };

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
});

describe("approve", () => {
  it("makes the waiting card active and replaces the older active card", async () => {
    h.db.salesPartnerCard.findFirst.mockResolvedValue(pending);
    h.db.salesPartnerCard.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post("/admin/sales/partners/11/card/approve").send({});
    expect(res.status).toBe(200);
    const [replace, approve] = h.db.salesPartnerCard.updateMany.mock.calls.map((call: any[]) => call[0]);
    expect(replace).toMatchObject({ where: { salesPartnerId: 11, status: "ACTIVE" }, data: { status: "REPLACED", activeKey: null } });
    expect(approve).toMatchObject({ where: { id: 21, status: "PENDING_REVIEW" }, data: { status: "ACTIVE", activeKey: 11 } });
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_card_approved", expect.objectContaining({ cardNumber: "NSA-DAR-0001-C2" }));
  });

  it("refuses when nothing is waiting, or another admin got there first", async () => {
    h.db.salesPartnerCard.findFirst.mockResolvedValue(null);
    expect((await request(app).post("/admin/sales/partners/11/card/approve").send({})).status).toBe(404);

    h.db.salesPartnerCard.findFirst.mockResolvedValue(pending);
    h.db.salesPartnerCard.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 0 });
    expect((await request(app).post("/admin/sales/partners/11/card/approve").send({})).status).toBe(409);
    expect(h.notifyUser).not.toHaveBeenCalled();
  });
});

describe("reject", () => {
  it("needs a reason and leaves any active card alone", async () => {
    h.db.salesPartnerCard.findFirst.mockResolvedValue(pending);
    expect((await request(app).post("/admin/sales/partners/11/card/reject").send({})).status).toBe(400);

    h.db.salesPartnerCard.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post("/admin/sales/partners/11/card/reject").send({ reason: "The photo shows a logo, not a face" });
    expect(res.status).toBe(200);
    expect(h.db.salesPartnerCard.updateMany).toHaveBeenCalledTimes(1);
    expect(h.db.salesPartnerCard.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: 21, status: "PENDING_REVIEW" },
      data: { status: "PHOTO_REJECTED", revokedById: 7, revokeReason: "The photo shows a logo, not a face" },
    });
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_card_photo_rejected", expect.objectContaining({ reason: "The photo shows a logo, not a face" }));
  });
});

describe("issue after a cancellation", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const partner = (over: Record<string, unknown> = {}) => ({
    id: 11, agentCode: "NSA-DAR-0001", status: "ACTIVE", userId: 101,
    user: { avatarUrl: "https://res.cloudinary.com/x/face.jpg", suspendedAt: null, isDisabled: false },
    contracts: [{ status: "ACTIVE", startsAt: new Date(Date.now() - DAY), expiresAt: new Date(Date.now() + 200 * DAY) }],
    ...over,
  });

  it("needs the admin to confirm the photo, then issues a live card", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner());
    expect((await request(app).post("/admin/sales/partners/11/card/issue").send({})).status).toBe(400);

    h.db.salesPartnerCard.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    h.db.salesPartnerCard.create.mockImplementation(async ({ data }: any) => ({ id: 30, ...data }));
    h.db.salesPartnerCard.update.mockImplementation(async ({ data }: any) => ({ id: 30, cardNumber: "NSA-DAR-0001-C2", ...data }));
    const res = await request(app).post("/admin/sales/partners/11/card/issue").send({ photoChecked: true });
    expect(res.status).toBe(201);
    expect(h.db.salesPartnerCard.create.mock.calls[0][0].data).toMatchObject({ cardNumber: "NSA-DAR-0001-C2", status: "ACTIVE", activeKey: 11 });
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_card_reissued", expect.objectContaining({ cardNumber: "NSA-DAR-0001-C2" }));
  });

  it("refuses for a suspended account or when a card is already open", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner({ user: { avatarUrl: "x", suspendedAt: new Date(), isDisabled: false } }));
    expect((await request(app).post("/admin/sales/partners/11/card/issue").send({ photoChecked: true })).status).toBe(409);

    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner());
    h.db.salesPartnerCard.count.mockResolvedValue(1);
    expect((await request(app).post("/admin/sales/partners/11/card/issue").send({ photoChecked: true })).status).toBe(409);
    expect(h.db.salesPartnerCard.create).not.toHaveBeenCalled();
  });
});

describe("suspend and reinstate", () => {
  const partner = (status: string) => ({ id: 11, userId: 101, status, agentCode: "NSA-DAR-0001" });

  it("suspending closes the portal, withdraws a waiting card and keeps the reason private", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
    h.db.salesPartnerProfile.updateMany.mockResolvedValue({ count: 1 });
    h.db.userWorkspaceAccess.updateMany.mockResolvedValue({ count: 1 });
    h.db.salesPartnerCard.updateMany.mockResolvedValue({ count: 1 });
    expect((await request(app).post("/admin/sales/partners/11/suspend").send({})).status).toBe(400);

    const res = await request(app).post("/admin/sales/partners/11/suspend").send({ reason: "Owner complaint under review" });
    expect(res.status).toBe(200);
    expect(h.db.salesPartnerProfile.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 11, status: "ACTIVE" }, data: { status: "SUSPENDED" } });
    expect(h.db.userWorkspaceAccess.updateMany.mock.calls[0][0]).toMatchObject({ where: { userId: 101, workspace: "SALES", status: "ACTIVE" }, data: { status: "SUSPENDED" } });
    expect(h.db.salesPartnerCard.updateMany.mock.calls[0][0]).toMatchObject({ where: { salesPartnerId: 11, status: "PENDING_REVIEW" }, data: { status: "REPLACED" } });
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), "SALES_PARTNER_SUSPEND", "SALES_PARTNER", expect.anything(), expect.objectContaining({ reason: "Owner complaint under review" }), 11);
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_workspace_suspended", expect.not.objectContaining({ reason: expect.anything() }));
  });

  it("only suspends an active partner and only reinstates a suspended one", async () => {
    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("SUSPENDED"));
    expect((await request(app).post("/admin/sales/partners/11/suspend").send({ reason: "Second click" })).status).toBe(409);

    h.db.salesPartnerProfile.updateMany.mockResolvedValue({ count: 1 });
    h.db.userWorkspaceAccess.updateMany.mockResolvedValue({ count: 1 });
    const back = await request(app).post("/admin/sales/partners/11/reinstate").send({ reason: "Complaint cleared" });
    expect(back.status).toBe(200);
    expect(h.db.salesPartnerProfile.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 11, status: "SUSPENDED" }, data: { status: "ACTIVE", suspendedAt: null } });
    expect(h.db.userWorkspaceAccess.updateMany.mock.calls[0][0]).toMatchObject({ where: { userId: 101, workspace: "SALES", status: "SUSPENDED" }, data: { status: "ACTIVE" } });
    expect(h.notifyUser).toHaveBeenCalledWith(101, "sales_partner_workspace_reinstated", expect.anything());

    h.db.salesPartnerProfile.findUnique.mockResolvedValue(partner("ACTIVE"));
    expect((await request(app).post("/admin/sales/partners/11/reinstate").send({ reason: "Not suspended" })).status).toBe(409);
  });
});
