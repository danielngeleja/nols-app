import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  user: vi.fn(),
  count: vi.fn(),
  aggregate: vi.fn(),
  findMany: vi.fn(),
  groupBy: vi.fn(),
  otp: vi.fn(),
  accounts: vi.fn(),
  ready: vi.fn(),
  lane: vi.fn(),
  recovery: vi.fn(),
  control: vi.fn(),
  anchor: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findFirst: m.user },
    disbursement: { count: m.count, aggregate: m.aggregate, findMany: m.findMany },
    payoutRelease: { groupBy: m.groupBy },
    payoutWithdrawalOtpGuard: { findUnique: m.otp },
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/payouts/release.js", () => ({ verifiedPayoutAccounts: m.accounts }));
vi.mock("../services/payouts/partialWithdrawal.js", () => ({ readyBalances: m.ready }));
vi.mock("../services/payouts/recovery.js", () => ({ openRecoveryTotal: m.recovery }));
vi.mock("../services/payouts/riskScoring.js", () => ({
  destinationChangeAnchor: m.anchor,
  loadPayoutSafeguards: vi.fn().mockResolvedValue({ reviewThresholdTzs: null, dailyCapPerPayeeTzs: null, recentChangeHours: 72 }),
}));
vi.mock("../services/payouts/autoLane.js", async (original) => ({
  ...(await original<any>()),
  decideOwnerPayoutLane: m.lane,
}));
vi.mock("../services/payouts/ownerPayoutControl.js", async (original) => ({
  ...(await original<any>()),
  loadOwnerPayoutControl: m.control,
}));

import { router } from "../routes/admin.owners.js";

const app = express();
app.use(express.json());
app.use("/owners", router);
const ACCOUNT = { id: 7, userId: 44, provider: "vodacom", accountNumber: "255700002370", accountName: "ASHA MTUMWA", destinationChangedAt: null, createdAt: new Date("2026-08-21") };

beforeEach(() => {
  vi.clearAllMocks();
  m.user.mockResolvedValue({ id: 44, name: "Asha", fullName: "Asha Mtumwa", phoneChangedAt: null, emailChangedAt: null });
  m.count.mockImplementation(async ({ where }: any) => where.status === "PAID" ? 0 : 0);
  m.aggregate.mockResolvedValue({ _sum: { amount: null } });
  m.findMany.mockImplementation(async ({ where }: any) => where.status === "REQUESTED"
    ? [{ amount: new Prisma.Decimal(1_700_000), createdAt: new Date("2026-11-25T03:00:00Z") }]
    : [{ externalReferenceId: "OWN-AAA", amount: new Prisma.Decimal(1_700_000), status: "REQUESTED", releaseLane: null, approvedById: null, createdAt: new Date("2026-11-25T03:00:00Z"), paidAt: null, securityReviewReason: null }]);
  m.groupBy.mockResolvedValue([{ status: "AVAILABLE", _count: { _all: 1 } }]);
  m.otp.mockResolvedValue(null);
  m.accounts.mockResolvedValue([ACCOUNT]);
  m.ready.mockResolvedValue([{ releaseId: 1, invoiceId: 10, remaining: 300_000, alreadyRecovered: 0 }]);
  m.lane.mockResolvedValue({ lane: "MANUAL", reason: "First payout to this owner is checked by our team" });
  m.recovery.mockResolvedValue(0);
  m.control.mockResolvedValue({ available: true, hold: null, alwaysReview: null });
  m.anchor.mockResolvedValue(null);
});

describe("GET /owners/:id/payout-overview", () => {
  it("summarises money, the next route and the safety signals for a new owner", async () => {
    const res = await request(app).get("/owners/44/payout-overview");
    expect(res.status).toBe(200);
    expect(res.body.money).toMatchObject({
      firstPayoutDone: false, readyToWithdraw: 300_000, readyCount: 1,
      waitingApproval: { count: 1, total: 1_700_000 },
    });
    expect(res.body.nextRoute).toEqual({ lane: "MANUAL", reason: "First payout to this owner is checked by our team", amount: 300_000 });
    expect(res.body.safety).toMatchObject({
      wallet: { provider: "vodacom", ending: "2370", holderName: "ASHA MTUMWA", nameMatchesOwner: true },
      walletWaitUntil: null, codeLocked: false,
    });
    expect(res.body.recent[0]).toMatchObject({ reference: "OWN-AAA", status: "REQUESTED", route: "MANUAL" });
  });

  it("routes to a person while a refund recovery is open, even when the lane says automatic", async () => {
    m.lane.mockResolvedValue({ lane: "AUTO", reason: null });
    m.recovery.mockResolvedValue(50_000);
    const res = await request(app).get("/owners/44/payout-overview");
    expect(res.body.nextRoute).toMatchObject({ lane: "MANUAL", reason: "A recovery from an earlier refund is still open" });
  });

  it("shows the wallet wait after a real wallet change, and a locked code", async () => {
    m.anchor.mockResolvedValue(new Date(Date.now() - 3_600_000));
    m.otp.mockResolvedValue({ lockedAt: new Date(), failedAttempts: 3 });
    const res = await request(app).get("/owners/44/payout-overview");
    expect(res.body.safety.walletWaitUntil).toBeTruthy();
    expect(res.body.safety.codeLocked).toBe(true);
  });

  it("flags a wallet in someone else's name", async () => {
    m.accounts.mockResolvedValue([{ ...ACCOUNT, accountName: "PETER JOHN" }]);
    const res = await request(app).get("/owners/44/payout-overview");
    expect(res.body.safety.wallet.nameMatchesOwner).toBe(false);
  });

  it("has no next route when nothing is ready", async () => {
    m.ready.mockResolvedValue([]);
    const res = await request(app).get("/owners/44/payout-overview");
    expect(res.body.nextRoute).toBeNull();
    expect(m.lane).not.toHaveBeenCalled();
  });

  it("refuses an id that is not an owner", async () => {
    m.user.mockResolvedValue(null);
    expect((await request(app).get("/owners/45/payout-overview")).status).toBe(404);
  });
});
