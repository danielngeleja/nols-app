import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  propertyFindUnique: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsStaffMembership: {
      findMany: mocks.membershipFindMany,
      findFirst: mocks.membershipFindFirst,
    },
    property: {
      findUnique: mocks.propertyFindUnique,
    },
  },
}));

vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: () => void) => {
    req.user = { id: 23, role: "USER" };
    next();
  },
}));

import nrmsOperationsRouter from "./nrms.operations.js";

const app = express();
app.use(express.json());
app.use("/api/nrms/operations", nrmsOperationsRouter);

describe("NRMS assigned staff workspace access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the assigned property's approval status with the active staff role", async () => {
    mocks.membershipFindMany.mockResolvedValue([
      {
        propertyId: 91,
        role: "BAR",
        outletId: 7,
        property: {
          id: 91,
          title: "Namibia Bar",
          status: "APPROVED",
          currency: "TZS",
          nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
          nrmsPaygAccount: { status: "ACTIVE" },
        },
      },
    ]);

    const response = await request(app).get("/api/nrms/operations/me");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      entitled: true,
      workspaceMode: "MARKETPLACE_NRMS",
      properties: [
        {
          id: 91,
          title: "Namibia Bar",
          status: "APPROVED",
          nrmsAccessRole: "BAR",
          nrmsOutletId: 7,
        },
      ],
    });
    expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 23, status: "ACTIVE" },
      include: {
        property: {
          select: expect.objectContaining({ status: true }),
        },
      },
    }));
  });

  it("rejects a staff assignment when the granting property is no longer approved", async () => {
    mocks.propertyFindUnique.mockResolvedValue({
      id: 91,
      ownerId: 12,
      title: "Namibia Bar",
      status: "SUSPENDED",
      currency: "TZS",
      nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: "09:00",
    });
    mocks.membershipFindFirst.mockResolvedValue({
      id: 3,
      role: "BAR",
      outletId: 7,
    });

    const response = await request(app).get("/api/nrms/operations/property/91/context");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "NRMS_PROPERTY_NOT_APPROVED",
      propertyStatus: "SUSPENDED",
    });
  });
});
