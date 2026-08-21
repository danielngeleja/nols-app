import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = vi.fn();
  const requestFindUnique = vi.fn();
  const propertyFindUnique = vi.fn();
  const accountFindUnique = vi.fn();
  const agentFindUnique = vi.fn();
  const linkCount = vi.fn();
  const requestCount = vi.fn();
  const tx = { ownerPaygAccount: { findUnique: accountFindUnique }, nrmsAgentPropertyLink: { findUnique: vi.fn() } };
  const prisma = {
    $transaction: transaction,
    nrmsAgentBookingRequest: { findUnique: requestFindUnique, count: requestCount },
    nrmsAgentPropertyLink: { count: linkCount },
    property: { findUnique: propertyFindUnique },
    nrmsAgentAccount: { findUnique: agentFindUnique },
  };
  return {
    transaction, requestFindUnique, propertyFindUnique, accountFindUnique, agentFindUnique, linkCount, requestCount, tx, prisma,
    loadOwnedActiveNrmsProperty: vi.fn(), authorizeApproval: vi.fn(), approveHold: vi.fn(), lockSeats: vi.fn(),
    countSeats: vi.fn(), inviteInTransaction: vi.fn(), attach: vi.fn(), auditOrThrow: vi.fn(), notifyUser: vi.fn(), sendMail: vi.fn(),
  };
});

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({ requireAuth: (req: any, _res: unknown, next: () => void) => { req.user = { id: 41, role: "OWNER" }; next(); } }));
vi.mock("../lib/nrms.js", () => ({ loadOwnedActiveNrmsProperty: mocks.loadOwnedActiveNrmsProperty }));
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
  setAgentLinkStatus: vi.fn(),
  setAgentRateAccess: vi.fn(),
  updateAgentLinkTerms: vi.fn(),
}));

import agentsRouter from "./owner.nrms.agents.js";

const app = express();
app.use(express.json());
app.use("/api/owner/nrms/agents", agentsRouter);

describe("NRMS agent route hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (callback: (source: any) => unknown) => callback(mocks.tx));
    mocks.loadOwnedActiveNrmsProperty.mockResolvedValue({ property: { id: 9, title: "Hotel" }, account: { maxAgents: 5 } });
    mocks.accountFindUnique.mockResolvedValue({ maxAgents: 5 });
    mocks.countSeats.mockResolvedValue(1);
    mocks.inviteInTransaction.mockResolvedValue({ ok: true, userId: 55, accountId: 77, token: "invite-token" });
    mocks.attach.mockResolvedValue({ ok: true, linkId: 88 });
    mocks.sendMail.mockResolvedValue(undefined);
    mocks.linkCount.mockResolvedValue(0);
    mocks.requestCount.mockResolvedValue(0);
  });

  it("creates the user, agency and property link inside one seat-locked transaction", async () => {
    const response = await request(app)
      .post("/api/owner/nrms/agents/property/9/invite")
      .send({ email: "agent@example.com", legalName: "Kili Travel", nationality: "Tanzanian" });

    expect(response.status).toBe(201);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
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
