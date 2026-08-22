import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadNrmsPropertyAccess: vi.fn(),
  shiftFindFirst: vi.fn(),
  shiftUpdate: vi.fn(),
  transaction: vi.fn(),
  lockPropertyInventory: vi.fn(),
  ensureBusinessDay: vi.fn(),
  expectedCashForShift: vi.fn(),
  shiftHandoverSummary: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    nrmsCashierShift: { findFirst: mocks.shiftFindFirst, update: mocks.shiftUpdate },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: unknown, next: () => void) => {
    req.user = { id: 23, role: "USER" };
    next();
  },
}));

vi.mock("../lib/nrmsPropertyAccess.js", () => ({ loadNrmsPropertyAccess: mocks.loadNrmsPropertyAccess }));
vi.mock("../lib/nrmsAvailability.js", () => ({ lockPropertyInventory: mocks.lockPropertyInventory }));
vi.mock("../lib/nrmsNightAuditLedger.js", () => ({ createNightAuditLedgerTransaction: vi.fn() }));
vi.mock("../lib/nrmsReporting.js", () => ({ allocateStayValue: vi.fn() }));
vi.mock("../lib/nrmsShifts.js", () => ({
  assertNrmsBusinessDayWritable: vi.fn(),
  ensureBusinessDay: mocks.ensureBusinessDay,
  expectedCashForShift: mocks.expectedCashForShift,
  nextShiftDayKey: (key: string) => {
    const date = new Date(`${key}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    return date.toISOString().slice(0, 10);
  },
  NRMS_BUSINESS_DAY_LOCKED: "NRMS_BUSINESS_DAY_LOCKED",
  shiftHandoverSummary: mocks.shiftHandoverSummary,
}));

import financeRouter from "./owner.nrms.finance.js";

const app = express();
app.use(express.json());
app.use("/api/owner/nrms/finance", financeRouter);

describe("NRMS finance access boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates finance access to the full property approval, entitlement and account gate", async () => {
    mocks.loadNrmsPropertyAccess.mockImplementation(async (_req: unknown, res: any) => {
      res.status(423).json({ code: "NRMS_PROPERTY_FROZEN" });
      return null;
    });

    const response = await request(app).get("/api/owner/nrms/finance/property/91");

    expect(response.status).toBe(423);
    expect(response.body.code).toBe("NRMS_PROPERTY_FROZEN");
    expect(mocks.loadNrmsPropertyAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 91, ["OWNER", "MANAGER", "FRONT_DESK"]);
  });

  it("does not let one front-desk user close another cashier's shift", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({
      role: "FRONT_DESK",
      actorId: 23,
      ownerId: 12,
      property: { id: 91, ownerId: 12, title: "Hotel", status: "APPROVED", currency: "TZS", nrmsActivatedAt: new Date() },
    });
    mocks.shiftFindFirst.mockResolvedValue({ id: 8, propertyId: 91, userId: 44, status: "OPEN" });

    const response = await request(app)
      .post("/api/owner/nrms/finance/property/91/shifts/8/close")
      .send({ declaredCash: 10_000 });

    expect(response.status).toBe(403);
    expect(mocks.expectedCashForShift).not.toHaveBeenCalled();
    expect(mocks.shiftUpdate).not.toHaveBeenCalled();
  });

  it("takes the property lock before reading the Night Audit control snapshot", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({
      role: "MANAGER",
      actorId: 23,
      ownerId: 12,
      property: { id: 91, ownerId: 12, title: "Hotel", status: "APPROVED", currency: "TZS", nrmsActivatedAt: new Date() },
    });
    const firstControlRead = vi.fn().mockResolvedValue(1);
    const tx = {
      nrmsBusinessDay: { update: vi.fn().mockResolvedValue({}) },
      nrmsCashierShift: { count: firstControlRead },
      nrmsOutletOrder: { count: vi.fn().mockResolvedValue(0) },
      reservation: { count: vi.fn().mockResolvedValue(0) },
      externalPaymentRecord: { count: vi.fn().mockResolvedValue(0) },
      reservationCharge: { count: vi.fn().mockResolvedValue(0) },
      nrmsNightAuditRun: { create: vi.fn().mockResolvedValue({ id: 4, status: "BLOCKED" }) },
    };
    mocks.ensureBusinessDay.mockResolvedValue({ id: 7, status: "OPEN" });
    mocks.transaction.mockImplementation(async (callback: (source: any) => unknown) => callback(tx));

    const response = await request(app)
      .post("/api/owner/nrms/finance/property/91/night-audit/close")
      .send({ businessDate: "2026-08-13" });

    expect(response.status).toBe(409);
    expect(mocks.lockPropertyInventory).toHaveBeenCalledWith(tx, 91);
    expect(mocks.lockPropertyInventory.mock.invocationCallOrder[0]).toBeLessThan(firstControlRead.mock.invocationCallOrder[0]);
    expect(tx.nrmsBusinessDay.update).toHaveBeenLastCalledWith({ where: { id: 7 }, data: { status: "OPEN" } });
  });

  it("refuses to close the current or a future operating date before taking the audit lock", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({
      role: "MANAGER",
      actorId: 23,
      ownerId: 12,
      property: { id: 91, ownerId: 12, title: "Hotel", status: "APPROVED", currency: "TZS", nrmsActivatedAt: new Date() },
    });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const tomorrow = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 86_400_000));

    for (const businessDate of [today, tomorrow]) {
      const response = await request(app)
        .post("/api/owner/nrms/finance/property/91/night-audit/close")
        .send({ businessDate });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("BUSINESS_DAY_NOT_COMPLETED");
      expect(response.body.latestClosableDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.lockPropertyInventory).not.toHaveBeenCalled();
  });

  it("closes one completed date and opens the next date in the same transaction", async () => {
    mocks.loadNrmsPropertyAccess.mockResolvedValue({
      role: "MANAGER",
      actorId: 23,
      ownerId: 12,
      property: { id: 91, ownerId: 12, title: "Hotel", status: "APPROVED", currency: "TZS", nrmsActivatedAt: new Date() },
    });
    const empty = vi.fn().mockResolvedValue([]);
    const zero = vi.fn().mockResolvedValue(0);
    const businessDayUpdate = vi.fn()
      .mockResolvedValueOnce({ id: 7, status: "CLOSING" })
      .mockResolvedValueOnce({ id: 7, status: "CLOSED" });
    const tx = {
      nrmsBusinessDay: { update: businessDayUpdate },
      nrmsCashierShift: { count: zero },
      nrmsOutletOrder: { count: zero, findMany: empty },
      reservation: { count: zero, findMany: empty },
      externalPaymentRecord: { count: zero, findMany: empty },
      reservationCharge: { count: zero, findMany: empty },
      nrmsMasterFolioItem: { findMany: empty },
      nrmsMasterFolioPayment: { findMany: empty },
      nrmsUsageEvent: { findMany: empty },
      nrmsExpense: { findMany: empty },
      nrmsNightAuditRun: {
        create: vi.fn().mockResolvedValue({ id: 4, status: "DRAFT" }),
        update: vi.fn().mockResolvedValue({ id: 4, status: "CLOSED" }),
      },
    };
    mocks.ensureBusinessDay
      .mockResolvedValueOnce({ id: 7, status: "OPEN", businessDate: new Date("2026-08-13T00:00:00Z") })
      .mockResolvedValueOnce({ id: 8, status: "OPEN", businessDate: new Date("2026-08-14T00:00:00Z") });
    mocks.transaction.mockImplementation(async (callback: (source: any) => unknown) => callback(tx));

    const response = await request(app)
      .post("/api/owner/nrms/finance/property/91/night-audit/close")
      .send({ businessDate: "2026-08-13" });

    expect(response.status).toBe(200);
    expect(mocks.ensureBusinessDay).toHaveBeenNthCalledWith(1, tx, 91, "2026-08-13", 23);
    expect(mocks.ensureBusinessDay).toHaveBeenNthCalledWith(2, tx, 91, "2026-08-14", 23);
    expect(response.body.nextBusinessDay).toMatchObject({ id: 8, status: "OPEN" });
    expect(businessDayUpdate.mock.invocationCallOrder[1]).toBeLessThan(mocks.ensureBusinessDay.mock.invocationCallOrder[1]);
  });
});
