import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  control: { findUnique: vi.fn(), findMany: vi.fn(), upsert: vi.fn() } as any,
  auditCreate: vi.fn(),
  userFindFirst: vi.fn(),
  financeGrant: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => {
  const db: any = {
    ownerPayoutControl: m.control,
    auditLog: { create: m.auditCreate },
    user: { findFirst: m.userFindFirst },
  };
  db.$transaction = (fn: any) => fn(db);
  return { prisma: db };
});
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/financeGrantStore.js", () => ({ hasFinanceGrant: m.financeGrant }));

import { prisma } from "@nolsaf/prisma";
import {
  applyOwnerPayoutControl, controlActionLoosens, heldOwnerIds, loadOwnerPayoutControl, OwnerPayoutControlError,
} from "../services/payouts/ownerPayoutControl.js";
import { router } from "../routes/admin.owners.js";
import { ownerActivityEvent, ownerActivityActions } from "../lib/ownerAccountActivity.js";

// The service reads prisma.ownerPayoutControl; point it at the mock model.
function tableExists(yes: boolean) {
  (prisma as any).ownerPayoutControl = yes ? m.control : undefined;
}

const app = express();
app.use(express.json());
app.use("/owners", router);
const NOW = new Date("2026-11-25T09:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  tableExists(true);
  m.control.findUnique.mockResolvedValue(null);
  m.control.findMany.mockResolvedValue([]);
  m.control.upsert.mockResolvedValue({});
  m.auditCreate.mockResolvedValue({});
  m.userFindFirst.mockResolvedValue({ id: 44 });
  m.financeGrant.mockResolvedValue(false);
});

describe("owner payout control service", () => {
  it("reads as 'no controls' before the table exists", async () => {
    tableExists(false);
    expect(await loadOwnerPayoutControl(44)).toEqual({ available: false, hold: null, alwaysReview: null });
    expect(await heldOwnerIds([44])).toEqual(new Set());
  });

  it("treats a missing-table error as no controls, but throws any other read error (fail closed)", async () => {
    m.control.findUnique.mockRejectedValueOnce(Object.assign(new Error("table does not exist"), { code: "P2021" }));
    expect((await loadOwnerPayoutControl(44)).available).toBe(false);
    m.control.findUnique.mockRejectedValueOnce(new Error("connection reset"));
    await expect(loadOwnerPayoutControl(44)).rejects.toThrow("connection reset");
  });

  it("places a pause with its audit record in one transaction", async () => {
    m.control.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ holdAt: NOW, holdReason: "Disputed bookings under review", holdById: 7, alwaysReview: false });
    const state = await applyOwnerPayoutControl({ ownerId: 44, action: "HOLD", reason: "Disputed bookings under review", adminId: 7, now: NOW });
    expect(m.control.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: 44 },
      create: expect.objectContaining({ holdAt: NOW, holdReason: "Disputed bookings under review", holdById: 7 }),
    }));
    expect(m.auditCreate).toHaveBeenCalledWith({ data: expect.objectContaining({
      action: "OWNER_PAYOUT_HOLD_PLACED", entity: "user:44", entityId: 44, actorId: 7, afterJson: { reason: "Disputed bookings under review" },
    }) });
    expect(state.hold?.reason).toBe("Disputed bookings under review");
  });

  it("refuses a change that changes nothing", async () => {
    m.control.findUnique.mockResolvedValue({ holdAt: NOW, holdReason: "x", holdById: 7, alwaysReview: false });
    await expect(applyOwnerPayoutControl({ ownerId: 44, action: "HOLD", reason: "Second pause attempt", adminId: 7 }))
      .rejects.toBeInstanceOf(OwnerPayoutControlError);
    m.control.findUnique.mockResolvedValue(null);
    await expect(applyOwnerPayoutControl({ ownerId: 44, action: "ALWAYS_REVIEW_OFF", reason: "Nothing to switch off", adminId: 7 }))
      .rejects.toMatchObject({ code: "NO_CHANGE" });
  });

  it("only lifting a control counts as loosening", () => {
    expect(controlActionLoosens("HOLD")).toBe(false);
    expect(controlActionLoosens("ALWAYS_REVIEW_ON")).toBe(false);
    expect(controlActionLoosens("RELEASE")).toBe(true);
    expect(controlActionLoosens("ALWAYS_REVIEW_OFF")).toBe(true);
  });
});

describe("POST /owners/:id/payout-controls", () => {
  it("pauses at once, without the finance code", async () => {
    m.control.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ holdAt: NOW, holdReason: "Chargeback investigation", alwaysReview: false });
    const res = await request(app).post("/owners/44/payout-controls").send({ action: "HOLD", reason: "Chargeback investigation" });
    expect(res.status).toBe(200);
    expect(res.body.controls.hold.reason).toBe("Chargeback investigation");
  });

  it("needs the finance code to lift a pause", async () => {
    const res = await request(app).post("/owners/44/payout-controls").send({ action: "RELEASE", reason: "Investigation closed, all clear" });
    expect(res.status).toBe(403);
    expect(res.body.require2fa).toBe(true);
    expect(m.control.upsert).not.toHaveBeenCalled();
  });

  it("lifts a pause with the finance code", async () => {
    m.financeGrant.mockResolvedValue(true);
    m.control.findUnique.mockResolvedValueOnce({ holdAt: NOW, holdReason: "x", alwaysReview: false }).mockResolvedValueOnce({ holdAt: null, alwaysReview: false });
    const res = await request(app).post("/owners/44/payout-controls").send({ action: "RELEASE", reason: "Investigation closed, all clear" });
    expect(res.status).toBe(200);
    expect(res.body.controls.hold).toBeNull();
  });

  it("requires a real reason and a known action", async () => {
    expect((await request(app).post("/owners/44/payout-controls").send({ action: "HOLD", reason: "short" })).status).toBe(400);
    expect((await request(app).post("/owners/44/payout-controls").send({ action: "DELETE", reason: "a long enough reason" })).status).toBe(400);
  });

  it("refuses an id that is not an owner", async () => {
    m.userFindFirst.mockResolvedValue(null);
    expect((await request(app).post("/owners/45/payout-controls").send({ action: "HOLD", reason: "Chargeback investigation" })).status).toBe(404);
  });

  it("says the database update is needed before the table exists", async () => {
    tableExists(false);
    const res = await request(app).post("/owners/44/payout-controls").send({ action: "HOLD", reason: "Chargeback investigation" });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("NOT_AVAILABLE");
  });
});

describe("withdrawals in the owner timeline", () => {
  it("has its own filter covering code and control events", () => {
    expect(ownerActivityActions("withdrawals")).toEqual(expect.arrayContaining([
      "OWNER_WITHDRAWAL_OTP_FAILED", "OWNER_WITHDRAWAL_OTP_LOCKED", "OWNER_WITHDRAWAL_OTP_UNLOCKED",
      "OWNER_PAYOUT_HOLD_PLACED", "OWNER_PAYOUT_HOLD_RELEASED", "OWNER_PAYOUT_ALWAYS_REVIEW_ON", "OWNER_PAYOUT_ALWAYS_REVIEW_OFF",
    ]));
  });

  it("shows the reason for a pause and the count for a wrong code", () => {
    const base = { id: 1n, ip: null, ua: null, createdAt: NOW };
    const hold = ownerActivityEvent({ ...base, actorId: 7, actorRole: "ADMIN", action: "OWNER_PAYOUT_HOLD_PLACED", afterJson: { reason: "Chargeback investigation" } }, 44);
    expect(hold).toMatchObject({ category: "withdrawals", label: "Payouts paused by an admin", detail: "Reason: Chargeback investigation", actor: "Admin", tone: "change" });
    const wrong = ownerActivityEvent({ ...base, actorId: 44, actorRole: "OWNER", action: "OWNER_WITHDRAWAL_OTP_FAILED", afterJson: { failedAttempts: 2 } }, 44);
    expect(wrong).toMatchObject({ category: "withdrawals", detail: "2 of 3 wrong codes", actor: "Owner", tone: "failed" });
  });
});
