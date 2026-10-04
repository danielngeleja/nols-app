import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Voiding a settled outlet sale reverses money that was already taken from a
// guest. These tests pin the two things that make that reversible after the
// fact: it is attributed to the person who did it, and an admin support session
// cannot do it at all.
const mocks = vi.hoisted(() => ({
  membershipFindFirst: vi.fn(),
  propertyFindUnique: vi.fn(),
  accountFindUnique: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  getNrmsEnrollment: vi.fn(),
  isNrmsEntitled: vi.fn(),
  impersonated: false,
}));

vi.mock("@nolsaf/prisma", () => {
  const tx = { nrmsOutletOrder: { findUnique: mocks.orderFindUnique, update: mocks.orderUpdate } };
  const client = {
    nrmsStaffMembership: { findFirst: mocks.membershipFindFirst },
    property: { findUnique: mocks.propertyFindUnique },
    ownerPaygAccount: { findUnique: mocks.accountFindUnique, update: vi.fn() },
    user: { findUnique: vi.fn() },
    nrmsOutletOrder: { findUnique: mocks.orderFindUnique },
    $transaction: (fn: (client: unknown) => unknown) => fn(tx),
  };
  return { prisma: client, typedPrisma: client };
});

vi.mock("../lib/nrms.js", () => ({
  getNrmsEnrollment: mocks.getNrmsEnrollment,
  isNrmsEntitled: mocks.isNrmsEntitled,
}));

vi.mock("../lib/nrmsAvailability.js", async () => ({
  ...(await vi.importActual<any>("../lib/nrmsAvailability.js")),
  lockPropertyInventory: vi.fn(),
}));

vi.mock("../lib/nrmsShifts.js", async () => ({
  ...(await vi.importActual<any>("../lib/nrmsShifts.js")),
  assertNrmsBusinessDayWritable: vi.fn(),
}));

vi.mock("../middleware/auth.js", async () => {
  const actual = await vi.importActual<any>("../middleware/auth.js");
  return {
    ...actual,
    requireAuth: (req: any, _res: any, next: () => void) => {
      req.user = { id: 23, role: "USER", ...(mocks.impersonated ? { imp: true } : {}) };
      next();
    },
  };
});

import nrmsOperationsRouter from "./nrms.operations.js";

const app = express();
app.use(express.json());
app.use("/api/nrms/operations", nrmsOperationsRouter);

const settledOutletSale = {
  id: 5,
  propertyId: 91,
  outletId: 7,
  status: "SETTLED",
  settlementMode: "OUTLET_PAYMENT",
  folioChargeId: null,
  createdById: 23,
  outlet: { id: 7, type: "BAR" },
};

describe("NRMS settled sale void", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.impersonated = false;
    mocks.propertyFindUnique.mockResolvedValue({
      id: 91,
      ownerId: 12,
      title: "Namibia Bar",
      status: "APPROVED",
      currency: "TZS",
      nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      nrmsMenuPublic: true,
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: "09:00",
    });
    mocks.membershipFindFirst.mockResolvedValue({
      id: 3,
      role: "MANAGER",
      outletId: null,
      inviteVersion: 4,
      status: "ACTIVE",
      confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    mocks.accountFindUnique.mockResolvedValue({ id: 44, status: "ACTIVE" });
    mocks.getNrmsEnrollment.mockResolvedValue({ status: "ACTIVE" });
    mocks.isNrmsEntitled.mockReturnValue(true);
    mocks.orderFindUnique.mockResolvedValue(settledOutletSale);
  });

  it("records who voided the sale", async () => {
    const response = await request(app)
      .post("/api/nrms/operations/orders/5/void")
      .send({ reason: "Guest was charged twice" });

    expect(response.status).toBe(200);
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: 5 },
      data: expect.objectContaining({
        status: "VOIDED",
        voidedById: 23,
        voidReason: "Guest was charged twice",
      }),
    });
  });

  it("never voids during an admin support session", async () => {
    mocks.impersonated = true;

    const response = await request(app)
      .post("/api/nrms/operations/orders/5/void")
      .send({ reason: "Guest was charged twice" });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("IMPERSONATION_FORBIDDEN");
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });

  it("still requires a reason", async () => {
    const response = await request(app).post("/api/nrms/operations/orders/5/void").send({});

    expect(response.status).toBe(400);
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
  });
});
