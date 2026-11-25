import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  granted: true,
  overview: vi.fn(),
  pdf: vi.fn(),
  auditCreate: vi.fn(),
  userFindUnique: vi.fn(),
  groupBy: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: m.userFindUnique, findFirst: vi.fn() },
    auditLog: { create: m.auditCreate, groupBy: m.groupBy, findFirst: m.findFirst, findMany: m.findMany },
  },
}));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/financeGrant.js", () => ({
  requireAdminFinanceGrant: (_req: any, res: any, next: any) => m.granted ? next() : res.status(403).json({ error: "OTP required", require2fa: true }),
}));
vi.mock("../lib/redisRateLimitStore.js", () => ({ rateLimitWithRedis: () => (_req: any, _res: any, next: any) => next() }));
vi.mock("../services/payouts/ownerPayoutOverview.js", () => ({ buildOwnerPayoutOverview: m.overview }));
vi.mock("../lib/ownerPayoutRecordPdf.js", async (original) => ({
  ...(await original<any>()),
  generateOwnerPayoutRecordPdf: m.pdf,
}));

import { router } from "../routes/admin.owners.js";
import { ownerActivityEvent } from "../lib/ownerAccountActivity.js";

const app = express();
app.use(express.json());
app.use("/owners", router);

const OVERVIEW = {
  owner: { name: "Asha Mtumwa" },
  money: { firstPayoutDone: true, paidCount: 3, paidLast30Days: 900_000, readyToWithdraw: 300_000, unlockingCount: 0, onHoldCount: 0, readyCount: 1,
    waitingApproval: { count: 0, total: 0, oldestAt: null }, recoveryDue: 0 },
  nextRoute: { lane: "AUTO", reason: null, amount: 300_000 },
  safety: { wallet: { provider: "vodacom", ending: "2370", holderName: "TALIA HARBER", nameMatchesOwner: false },
    walletWaitUntil: null, contactWaitUntil: null, codeLocked: false, wrongCodes: 0, failedLast14Days: 0 },
  controls: { available: true, hold: null, alwaysReview: null },
  recent: [],
};
const VALID = { purpose: "DISPUTE", note: "Owner disputes the 14 Nov payout, case SC-1042" };

beforeEach(() => {
  vi.clearAllMocks();
  m.granted = true;
  m.overview.mockResolvedValue(OVERVIEW);
  m.pdf.mockResolvedValue(Buffer.from("%PDF-1.3 test"));
  m.auditCreate.mockResolvedValue({});
  m.userFindUnique.mockResolvedValue({ name: "Daniel", fullName: "Admin Daniel", twoFactorEnabled: true, twoFactorMethod: "SMS", _count: { passkeys: 0 } });
  m.groupBy.mockResolvedValue([]);
  m.findFirst.mockResolvedValue({ id: 1n });
  m.findMany.mockResolvedValue([
    { id: 5n, actorId: 44, actorRole: "OWNER", action: "OWNER_WITHDRAWAL_OTP_FAILED", afterJson: { failedAttempts: 1 }, ip: "192.0.2.9", ua: "Mozilla/5.0", createdAt: new Date("2026-11-20T08:00:00Z") },
  ]);
});

describe("POST /owners/:id/payout-record.pdf", () => {
  it("refuses without the finance code, before anything is built", async () => {
    m.granted = false;
    const res = await request(app).post("/owners/44/payout-record.pdf").send(VALID);
    expect(res.status).toBe(403);
    expect(res.body.require2fa).toBe(true);
    expect(m.pdf).not.toHaveBeenCalled();
    expect(m.auditCreate).not.toHaveBeenCalled();
  });

  it("requires one of the four purposes and a real note", async () => {
    expect((await request(app).post("/owners/44/payout-record.pdf").send({ ...VALID, purpose: "CURIOUS" })).status).toBe(400);
    expect((await request(app).post("/owners/44/payout-record.pdf").send({ ...VALID, note: "case" })).status).toBe(400);
    expect(m.pdf).not.toHaveBeenCalled();
  });

  it("releases the PDF only after recording who, why and the reference", async () => {
    const res = await request(app).post("/owners/44/payout-record.pdf").send(VALID);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["cache-control"]).toContain("no-store");
    const reference = res.headers["x-export-reference"];
    expect(reference).toMatch(/^EXP-[A-Z0-9]{8}$/);
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      actorId: 7, action: "OWNER_PAYOUT_RECORD_EXPORTED", entity: "user:44", entityId: 44,
      afterJson: { reference, purpose: "DISPUTE", note: VALID.note },
    }) });
    expect(m.pdf).toHaveBeenCalledWith(expect.objectContaining({ reference, exportedBy: "Admin Daniel", purpose: "DISPUTE" }));
  });

  it("fails closed: no audit record, no PDF", async () => {
    m.auditCreate.mockRejectedValue(new Error("audit store down"));
    const res = await request(app).post("/owners/44/payout-record.pdf").send(VALID);
    expect(res.status).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body.error).toMatch(/Nothing was released/);
  });

  it("never passes the wallet holder name, IPs or devices into the document", async () => {
    await request(app).post("/owners/44/payout-record.pdf").send(VALID);
    const input = m.pdf.mock.calls[0][0];
    expect(input.wallet).toEqual({ provider: "vodacom", ending: "2370", nameMatchesOwner: false });
    expect(JSON.stringify(input)).not.toContain("TALIA HARBER");
    expect(JSON.stringify(input)).not.toContain("192.0.2.9");
    expect(JSON.stringify(input)).not.toContain("Mozilla");
    expect(input.events[0]).toEqual({ createdAt: "2026-11-20T08:00:00.000Z", label: "Wrong withdrawal code entered", actor: "Owner", detail: "1 of 3 wrong codes" });
  });

  it("refuses an id that is not an owner", async () => {
    m.overview.mockResolvedValue(null);
    expect((await request(app).post("/owners/45/payout-record.pdf").send(VALID)).status).toBe(404);
    expect(m.auditCreate).not.toHaveBeenCalled();
  });
});

describe("the export in the owner's timeline", () => {
  it("shows the purpose, note and reference under Withdrawals", () => {
    const event = ownerActivityEvent({
      id: 9n, actorId: 7, actorRole: "ADMIN", action: "OWNER_PAYOUT_RECORD_EXPORTED",
      afterJson: { reference: "EXP-7K2Q9M4D", purpose: "LEGAL", note: "Police request CR/123/2026" },
      ip: null, ua: null, createdAt: new Date("2026-11-25T09:00:00Z"),
    }, 44);
    expect(event).toMatchObject({
      category: "withdrawals", label: "Payout record exported as PDF", actor: "Admin",
      detail: "Police or legal request · Police request CR/123/2026 · EXP-7K2Q9M4D",
    });
  });
});
