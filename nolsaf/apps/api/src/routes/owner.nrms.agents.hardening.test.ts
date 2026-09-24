import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const requestFindUnique = vi.fn();
  const propertyFindUnique = vi.fn();
  const accountFindUnique = vi.fn();
  const agentFindUnique = vi.fn();
  const agentFindMany = vi.fn();
  const agentLinkFindMany = vi.fn();
  const agentLinkFindUnique = vi.fn();
  const linkCount = vi.fn();
  const requestCount = vi.fn();
  const tx = { ownerPaygAccount: { findUnique: accountFindUnique }, nrmsAgentPropertyLink: { findUnique: vi.fn() } };
  const prisma = {
    $transaction: transaction,
    nrmsAgentBookingRequest: { findUnique: requestFindUnique, count: requestCount },
    nrmsAgentPropertyLink: { count: linkCount, findMany: agentLinkFindMany, findUnique: agentLinkFindUnique },
    property: { findUnique: propertyFindUnique },
    nrmsAgentAccount: { findUnique: agentFindUnique, findMany: agentFindMany },
  };
  return {
    transaction, requestFindUnique, propertyFindUnique, accountFindUnique, agentFindUnique, agentFindMany, agentLinkFindMany, agentLinkFindUnique, linkCount, requestCount, tx, prisma,
    loadOwnedActiveNrmsProperty: vi.fn(), loadNrmsPropertyAccess: vi.fn(), requireNrmsPropertyCapability: vi.fn(), authorizeApproval: vi.fn(), approveHold: vi.fn(), lockSeats: vi.fn(),
    countSeats: vi.fn(), inviteInTransaction: vi.fn(), attach: vi.fn(), setAgentLinkStatus: vi.fn(), nrmsBillingBlockPayload: vi.fn(), auditOrThrow: vi.fn(), notifyUser: vi.fn(), sendMail: vi.fn(),
  };
});

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({ requireAuth: (req: any, _res: unknown, next: () => void) => { req.user = { id: 41, role: "OWNER" }; next(); } }));
vi.mock("../lib/nrms.js", () => ({ loadOwnedActiveNrmsProperty: mocks.loadOwnedActiveNrmsProperty, nrmsBillingBlockPayload: mocks.nrmsBillingBlockPayload }));
vi.mock("../lib/nrmsPropertyAccess.js", () => ({
  loadNrmsPropertyAccess: mocks.loadNrmsPropertyAccess,
  requireNrmsPropertyCapability: mocks.requireNrmsPropertyCapability,
}));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(), auditOrThrow: mocks.auditOrThrow }));
vi.mock("../lib/nrmsAgentIdentity.js", () => ({ findAgencyMatches: vi.fn() }));
vi.mock("../lib/nrmsRateMath.js", () => ({ adjustRate: vi.fn(), money: (value: number) => value }));
vi.mock("../lib/nrmsAgentInvite.js", () => ({ inviteAgentUserInTransaction: mocks.inviteInTransaction, signAgentInviteToken: vi.fn() }));
vi.mock("../lib/nrmsAgentInventory.js", () => ({ approveAgentHold: mocks.approveHold, releaseAgentHold: vi.fn() }));
vi.mock("../lib/nrmsAgentPayment.js", () => ({ AGENT_PREPAY_TTL_MS: 900_000, ensureAgentPrepayRequest: vi.fn() }));
vi.mock("../lib/nrmsAgentRates.js", () => ({ getPropertyAgentCurrencies: vi.fn(async () => ["TZS"]) }));
vi.mock("../lib/mailer.js", () => ({ sendMail: mocks.sendMail }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: mocks.notifyUser }));
vi.mock("../lib/authEmailTemplates.js", () => ({
  getNrmsAgentInviteEmail: vi.fn(() => ({ subject: "Invite", html: "<p>Invite</p>" })),
  getNrmsAgentRequestDeclinedEmail: vi.fn(),
}));
vi.mock("../lib/nrmsAgentLinks.js", () => ({
  attachAgentToProperty: mocks.attach,
  authorizeHeldAgentBookingApproval: mocks.authorizeApproval,
  countAgentSeats: mocks.countSeats,
  lockAgentSeatAllocation: mocks.lockSeats,
  setAgentLinkStatus: mocks.setAgentLinkStatus,
  setAgentRateAccess: vi.fn(),
  updateAgentLinkTerms: vi.fn(),
}));

import agentsRouter, { AGENT_LINK_TX_OPTIONS } from "./owner.nrms.agents.js";

const app = express();
app.use(express.json());
app.use("/api/owner/nrms/agents", agentsRouter);

describe("NRMS agent route hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (source: any) => unknown) => callback(mocks.tx));
    mocks.loadOwnedActiveNrmsProperty.mockResolvedValue({ property: { id: 9, title: "Hotel" }, account: { maxAgents: 5 } });
    mocks.loadNrmsPropertyAccess.mockResolvedValue({ property: { id: 9, title: "Hotel" }, account: { maxAgents: 5, status: "ACTIVE" } });
    mocks.requireNrmsPropertyCapability.mockResolvedValue({ property: { id: 9, title: "Hotel" }, ownerId: 41 });
    mocks.accountFindUnique.mockResolvedValue({ maxAgents: 5 });
    mocks.countSeats.mockResolvedValue(1);
    mocks.inviteInTransaction.mockResolvedValue({ ok: true, userId: 55, accountId: 77, token: "invite-token" });
    mocks.attach.mockResolvedValue({ ok: true, linkId: 88 });
    mocks.sendMail.mockResolvedValue(undefined);
    mocks.linkCount.mockResolvedValue(0);
    mocks.requestCount.mockResolvedValue(0);
    mocks.agentFindMany.mockResolvedValue([]);
    mocks.agentLinkFindMany.mockResolvedValue([]);
    mocks.agentLinkFindUnique.mockResolvedValue(null);
  });

  it("reports that activation requires the unpaid NRMS balance to be settled", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({ property: { id: 9, title: "Hotel" }, account: { maxAgents: 5, status: "PAYMENT_REQUIRED" } });

    const response = await request(app).get("/api/owner/nrms/agents/property/9");

    expect(response.status).toBe(200);
    expect(response.body.activationEligibility).toEqual({
      eligible: false,
      status: "PAYMENT_REQUIRED",
      code: "PROPERTY_BILLING_BLOCKED",
      message: "Settle the NRMS balance before activating a new agent partnership.",
      action: "PAY",
    });
  });

  it("returns the NRMS payment card payload when Activate finds unpaid billing", async () => {
    const account = { status: "PAYMENT_REQUIRED", unpaidBalance: 129_000, unpaidLimit: 50_000, policyId: 3 };
    const payload = {
      error: "Settle the NRMS balance before activating this agent",
      code: "NRMS_PAYMENT_REQUIRED",
      billing: { status: "PAYMENT_REQUIRED", title: "Settle the NRMS balance to activate this agent", detail: "Balance due", action: "PAY", outstanding: 129_000, limit: 50_000, currency: "TZS" },
    };
    mocks.agentLinkFindUnique.mockResolvedValue({
      id: 88,
      propertyId: 9,
      status: "AGENT_ACCEPTED",
      property: { title: "Hotel", ownerId: 41 },
      agentAccount: { legalName: "Kili Travel", primaryUserId: 55 },
    });
    mocks.setAgentLinkStatus.mockResolvedValue({ ok: false, reason: "PROPERTY_BILLING_BLOCKED", message: "Billing blocked", billingAccount: account });
    mocks.nrmsBillingBlockPayload.mockResolvedValue(payload);

    const response = await request(app).post("/api/owner/nrms/agents/88/approve").send({});

    expect(response.status).toBe(402);
    expect(response.body).toEqual(payload);
    expect(mocks.nrmsBillingBlockPayload).toHaveBeenCalledWith(account, "AGENT_ACTIVATION");
    expect(mocks.notifyUser).not.toHaveBeenCalled();
  });

  it("creates the user, agency and property link inside one seat-locked transaction", async () => {
    const response = await request(app)
      .post("/api/owner/nrms/agents/property/9/invite")
      .send({ email: "agent@example.com", legalName: "Kili Travel", nationality: "Tanzanian" });

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), AGENT_LINK_TX_OPTIONS);
    expect(AGENT_LINK_TX_OPTIONS).toEqual({ maxWait: 5_000, timeout: 15_000 });
    expect(mocks.lockSeats).toHaveBeenCalledWith(mocks.tx, 9);
    expect(mocks.inviteInTransaction).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ email: "agent@example.com" }));
    expect(mocks.attach).toHaveBeenCalledWith(mocks.tx, expect.objectContaining({ agentAccountId: 77, propertyId: 9, maxAgents: 5 }));
    expect(mocks.lockSeats.mock.invocationCallOrder[0]).toBeLessThan(mocks.inviteInTransaction.mock.invocationCallOrder[0]);
    expect(mocks.inviteInTransaction.mock.invocationCallOrder[0]).toBeLessThan(mocks.attach.mock.invocationCallOrder[0]);
    expect(mocks.auditOrThrow).toHaveBeenCalledTimes(2);
  });

  it("does not create an orphan agent when the locked seat cap is full", async () => {
    mocks.countSeats.mockResolvedValue(5);
    const response = await request(app)
      .post("/api/owner/nrms/agents/property/9/invite")
      .send({ email: "agent@example.com", legalName: "Kili Travel", nationality: "Tanzanian" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("CAP_REACHED");
    expect(mocks.inviteInTransaction).not.toHaveBeenCalled();
    expect(mocks.attach).not.toHaveBeenCalled();
  });

  it("lists active verified agencies that are not already linked to the property", async () => {
    mocks.agentFindMany.mockResolvedValue([{
      id: 77,
      legalName: "Kili Travel Ltd",
      tradingName: "Kili Travel",
      registrationNo: "REG-123456",
      tin: "TIN-987654",
      licenseNo: "LIC-456789",
      nationality: "Tanzanian",
      countryCode: "TZ",
      documents: [{ type: "BUSINESS_LICENSE", uploadedAt: "2026-08-01T00:00:00.000Z" }],
      verificationStatus: "VERIFIED",
      status: "ACTIVE",
      verifiedAt: new Date("2026-08-20T00:00:00.000Z"),
      createdAt: new Date("2026-08-01T00:00:00.000Z"),
      primaryUser: { passwordHash: "hash" },
    }]);

    const response = await request(app).post("/api/owner/nrms/agents/property/9/lookup").send({});

    expect(response.status).toBe(200);
    expect(response.body.matches[0]).toMatchObject({
      id: 77,
      legalName: "Kili Travel Ltd",
      verificationStatus: "VERIFIED",
      documentCount: 1,
    });
    expect(response.body.matches[0]).not.toHaveProperty("registrationNo");
    expect(response.body.matches[0]).not.toHaveProperty("tin");
    expect(response.body.matches[0]).not.toHaveProperty("licenseNo");
    expect(response.body.matches[0]).not.toHaveProperty("contactEmail");
    expect(mocks.agentFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "ACTIVE", verificationStatus: "VERIFIED" }),
      take: 30,
    }));
  });

  it("re-authorizes a held request and refuses confirmation after suspension", async () => {
    mocks.requestFindUnique.mockResolvedValue({
      id: 44, status: "PENDING", propertyId: 9, checkIn: new Date("2026-09-01"), checkOut: new Date("2026-09-02"),
      currency: "TZS", quotedTotal: 100, reservationId: 66,
      link: { id: 88, agentAccount: { primaryUserId: 55, legalName: "Kili Travel", primaryUser: { email: "agent@example.com" } } },
    });
    mocks.propertyFindUnique.mockResolvedValue({ nrmsGuestPayInstructions: null });
    mocks.authorizeApproval.mockResolvedValue({ ok: false, reason: "RELATIONSHIP_NOT_ACTIVE", message: "This hotel partnership is not active." });

    const response = await request(app).post("/api/owner/nrms/agents/requests/44/approve").send({});

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("RELATIONSHIP_NOT_ACTIVE");
    expect(mocks.authorizeApproval).toHaveBeenCalledWith(mocks.tx, { linkId: 88, propertyId: 9 });
    expect(mocks.approveHold).not.toHaveBeenCalled();
  });

  it("returns only actionable travel-agent workload for the sidebar marker", async () => {
    mocks.linkCount.mockResolvedValueOnce(2).mockResolvedValueOnce(1);
    mocks.requestCount.mockResolvedValueOnce(3).mockResolvedValueOnce(2);

    const response = await request(app).get("/api/owner/nrms/agents/property/9/live-count");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ partnershipRequests: 2, acceptedInvites: 1, bookingRequests: 3, guestManifests: 2, total: 8 });
    expect(mocks.linkCount).toHaveBeenNthCalledWith(1, {
      where: {
        propertyId: 9,
        initiatedBy: "AGENT",
        status: "REQUESTED",
      },
    });
    expect(mocks.linkCount).toHaveBeenNthCalledWith(2, {
      where: { propertyId: 9, status: "AGENT_ACCEPTED" },
    });
    expect(mocks.requestCount).toHaveBeenNthCalledWith(1, {
      where: {
        propertyId: 9,
        status: "PENDING",
        OR: [{ holdExpiresAt: null }, { holdExpiresAt: { gt: expect.any(Date) } }],
      },
    });
    expect(mocks.requestCount).toHaveBeenNthCalledWith(2, {
      where: { propertyId: 9, status: "CONFIRMED", guestManifestStatus: "SUBMITTED" },
    });
  });
});
