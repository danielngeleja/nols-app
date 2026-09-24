import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  membershipFindMany: vi.fn(),
  membershipFindFirst: vi.fn(),
  membershipFindUnique: vi.fn(),
  membershipUpdateMany: vi.fn(),
  impersonated: false,
  propertyFindUnique: vi.fn(),
  accountFindUnique: vi.fn(),
  accountUpdate: vi.fn(),
  userFindUnique: vi.fn(),
  getNrmsEnrollment: vi.fn(),
  isNrmsEntitled: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    nrmsStaffMembership: {
      findMany: mocks.membershipFindMany,
      findFirst: mocks.membershipFindFirst,
      findUnique: mocks.membershipFindUnique,
      updateMany: mocks.membershipUpdateMany,
    },
    property: {
      findUnique: mocks.propertyFindUnique,
    },
    ownerPaygAccount: {
      findUnique: mocks.accountFindUnique,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
  typedPrisma: {
    nrmsStaffMembership: {
      findMany: mocks.membershipFindMany,
      findFirst: mocks.membershipFindFirst,
    },
    property: {
      findUnique: mocks.propertyFindUnique,
    },
    ownerPaygAccount: {
      findUnique: mocks.accountFindUnique,
      update: mocks.accountUpdate,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock("../lib/nrms.js", () => ({
  getNrmsEnrollment: mocks.getNrmsEnrollment,
  isNrmsEntitled: mocks.isNrmsEntitled,
}));

// The real blockImpersonated is kept so the guard under test is the shipped one;
// only the token check is stubbed, with mocks.impersonated standing in for the
// `imp: true` claim an admin support token carries.
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

const approvedProperty = {
  id: 91,
  ownerId: 12,
  title: "Namibia Bar",
  status: "APPROVED",
  currency: "TZS",
  nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
  nrmsMenuPublic: true,
  housekeepingDailyServiceEnabled: true,
  housekeepingDailyServiceTime: "09:00",
};

describe("NRMS assigned staff workspace access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.impersonated = false;
    mocks.userFindUnique.mockResolvedValue({ fullName: "Domiano Salamba", name: null });
    mocks.accountFindUnique.mockResolvedValue({ id: 44, status: "ACTIVE" });
    mocks.getNrmsEnrollment.mockResolvedValue({ status: "ACTIVE" });
    mocks.isNrmsEntitled.mockReturnValue(true);
  });

  it("returns the assigned property's approval status with the active staff role", async () => {
    mocks.membershipFindMany.mockResolvedValue([
      {
        propertyId: 91,
        role: "BAR",
        outletId: 7,
        inviteVersion: 4,
        confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
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
          effectiveAccess: {
            primaryRole: "BAR",
            workspace: "BAR",
            membershipVersion: 4,
            scopes: { outletIds: [7] },
          },
        },
      ],
    });
    expect(mocks.membershipFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 23, status: "ACTIVE", confirmedAt: { not: null } },
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
      inviteVersion: 4,
      status: "ACTIVE",
      confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    });

    const response = await request(app).get("/api/nrms/operations/property/91/context");

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      code: "NRMS_PROPERTY_NOT_APPROVED",
      propertyStatus: "SUSPENDED",
    });
  });

  it("does not let staff access another tenant's property by changing the property id", async () => {
    mocks.propertyFindUnique.mockResolvedValue({
      id: 92,
      ownerId: 55,
      title: "Another Owner Hotel",
      status: "APPROVED",
      currency: "TZS",
      nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
      housekeepingDailyServiceEnabled: true,
      housekeepingDailyServiceTime: "09:00",
    });
    mocks.membershipFindFirst.mockResolvedValue(null);

    const response = await request(app).get("/api/nrms/operations/property/92/context");

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("NRMS_PROPERTY_FORBIDDEN");
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { propertyId: 92, userId: 23, status: "ACTIVE", confirmedAt: { not: null } },
    }));
  });

  it("does not let a Manager appoint another Manager through a direct API call", async () => {
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

    const response = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "manager@example.com", role: "MANAGER", outletId: null });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "NRMS_CAPABILITY_DENIED" });
    expect(mocks.userFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { email: "manager@example.com" } }));
  });

  it("rejects new Housekeeper assignments before account lookup", async () => {
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

    const response = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "housekeeper@example.com", role: "HOUSEKEEPER", outletId: null });

    expect(response.status).toBe(400);
    expect(response.body.error).toBe("Invalid staff assignment");
  });

  it("requires an explicit outlet scope for outlet roles", async () => {
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

    const response = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "bar@example.com", role: "BAR", outletId: null });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("NRMS_OUTLET_SCOPE_REQUIRED");
  });

  it("does not let a Manager demote a peer Manager by re-assigning a lower role", async () => {
    mocks.propertyFindUnique.mockResolvedValue(approvedProperty);
    mocks.membershipFindFirst.mockResolvedValue({
      id: 3,
      role: "MANAGER",
      outletId: null,
      inviteVersion: 4,
      status: "ACTIVE",
      confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    mocks.userFindUnique.mockResolvedValue({ id: 55, email: "peer@example.com", fullName: "Peer Manager", name: null, suspendedAt: null, isDisabled: false });
    mocks.membershipFindUnique.mockResolvedValue({
      id: 9,
      propertyId: 91,
      userId: 55,
      role: "MANAGER",
      outletId: null,
      status: "ACTIVE",
      inviteVersion: 2,
    });

    const response = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "peer@example.com", role: "FRONT_DESK", outletId: null });

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: "NRMS_CAPABILITY_DENIED" });
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("refuses the assignment when the membership changed between authorization and write", async () => {
    mocks.propertyFindUnique.mockResolvedValue(approvedProperty);
    mocks.membershipFindFirst.mockResolvedValue({
      id: 3,
      role: "MANAGER",
      outletId: null,
      inviteVersion: 4,
      status: "ACTIVE",
      confirmedAt: new Date("2026-07-01T00:00:00.000Z"),
    });
    mocks.userFindUnique.mockResolvedValue({ id: 55, email: "desk@example.com", fullName: "Front Desk", name: null, suspendedAt: null, isDisabled: false });
    mocks.membershipFindUnique.mockResolvedValue({
      id: 9,
      propertyId: 91,
      userId: 55,
      role: "FRONT_DESK",
      outletId: null,
      status: "ACTIVE",
      inviteVersion: 2,
    });
    // A concurrent write moved the row on, so the guarded update matches nothing.
    mocks.membershipUpdateMany.mockResolvedValue({ count: 0 });

    const response = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "desk@example.com", role: "SALES_EXECUTIVE", outletId: null });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("NRMS_STAFF_ASSIGNMENT_CONFLICT");
    expect(mocks.membershipUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 9, role: "FRONT_DESK", inviteVersion: 2 }),
    }));
  });

  it("refuses NRMS writes during an admin support session", async () => {
    mocks.impersonated = true;
    mocks.propertyFindUnique.mockResolvedValue(approvedProperty);

    const assignment = await request(app)
      .post("/api/nrms/operations/property/91/staff")
      .send({ email: "desk@example.com", role: "FRONT_DESK", outletId: null });
    const orderVoid = await request(app)
      .post("/api/nrms/operations/orders/5/void")
      .send({ reason: "Wrong table" });

    for (const response of [assignment, orderVoid]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("IMPERSONATION_FORBIDDEN");
    }
    // The guard runs ahead of the handler, so nothing is even read.
    expect(mocks.propertyFindUnique).not.toHaveBeenCalled();
    expect(mocks.membershipUpdateMany).not.toHaveBeenCalled();
  });

  it("still lets an admin support session read the workspace", async () => {
    mocks.impersonated = true;
    mocks.membershipFindMany.mockResolvedValue([]);

    const response = await request(app).get("/api/nrms/operations/me");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ entitled: false, properties: [] });
  });
});
