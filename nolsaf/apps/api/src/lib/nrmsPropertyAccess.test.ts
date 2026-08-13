import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  propertyFindUnique: vi.fn(),
  membershipFindFirst: vi.fn(),
  accountFindUnique: vi.fn(),
  accountUpdate: vi.fn(),
  getNrmsEnrollment: vi.fn(),
  isNrmsEntitled: vi.fn(),
  findOpenRestrictionCase: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  typedPrisma: {
    property: { findUnique: mocks.propertyFindUnique },
    nrmsStaffMembership: { findFirst: mocks.membershipFindFirst },
    ownerPaygAccount: {
      findUnique: mocks.accountFindUnique,
      update: mocks.accountUpdate,
    },
  },
}));

vi.mock("./nrms.js", () => ({
  getNrmsEnrollment: mocks.getNrmsEnrollment,
  isNrmsEntitled: mocks.isNrmsEntitled,
}));

vi.mock("./restrictionCases.js", () => ({
  RESTRICTION_SCOPE: { NRMS_PROPERTY: "NRMS_PROPERTY" },
  findOpenRestrictionCase: mocks.findOpenRestrictionCase,
}));

import { loadNrmsPropertyAccess } from "./nrmsPropertyAccess.js";

function responseDouble() {
  const res: any = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const property = {
  id: 91,
  ownerId: 12,
  title: "Sheraton Hotel",
  status: "APPROVED",
  currency: "TZS",
  nrmsActivatedAt: new Date("2026-07-01T00:00:00.000Z"),
};

describe("loadNrmsPropertyAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.propertyFindUnique.mockResolvedValue(property);
    mocks.accountFindUnique.mockResolvedValue({ id: 44, status: "ACTIVE", trialEndsAt: new Date("2026-12-01T00:00:00.000Z") });
    mocks.getNrmsEnrollment.mockResolvedValue({ status: "ACTIVE" });
    mocks.isNrmsEntitled.mockReturnValue(true);
  });

  it("lets an active front-desk member use the property owner's NRMS entitlement", async () => {
    mocks.membershipFindFirst.mockResolvedValue({ role: "FRONT_DESK" });
    const res = responseDouble();

    const access = await loadNrmsPropertyAccess(
      { user: { id: 23, role: "USER" } } as any,
      res,
      91,
      ["OWNER", "MANAGER", "FRONT_DESK"],
    );

    expect(access).toMatchObject({ role: "FRONT_DESK", actorId: 23, ownerId: 12, property: { id: 91 } });
    expect(mocks.membershipFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { propertyId: 91, userId: 23, status: "ACTIVE" },
    }));
    expect(mocks.getNrmsEnrollment).toHaveBeenCalledWith(12);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("recognises the property's owner without requiring a staff membership", async () => {
    const res = responseDouble();

    const access = await loadNrmsPropertyAccess(
      { user: { id: 12, role: "OWNER" } } as any,
      res,
      91,
      ["OWNER", "MANAGER", "FRONT_DESK"],
    );

    expect(access).toMatchObject({ role: "OWNER", actorId: 12, ownerId: 12 });
    expect(mocks.membershipFindFirst).not.toHaveBeenCalled();
  });

  it("rejects an assigned role that is not allowed for the operation", async () => {
    mocks.membershipFindFirst.mockResolvedValue({ role: "HOUSEKEEPER" });
    const res = responseDouble();

    const access = await loadNrmsPropertyAccess(
      { user: { id: 23, role: "USER" } } as any,
      res,
      91,
      ["OWNER", "MANAGER", "FRONT_DESK"],
    );

    expect(access).toBeNull();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "NRMS_PROPERTY_FORBIDDEN" }));
    expect(mocks.getNrmsEnrollment).not.toHaveBeenCalled();
  });

  it("blocks operations when the property account is frozen", async () => {
    mocks.membershipFindFirst.mockResolvedValue({ role: "MANAGER" });
    mocks.accountFindUnique.mockResolvedValue({ id: 44, status: "FROZEN", frozenReason: "Billing review", trialEndsAt: new Date("2026-12-01T00:00:00.000Z") });
    mocks.findOpenRestrictionCase.mockResolvedValue({ referenceCode: "RST-004" });
    const res = responseDouble();

    const access = await loadNrmsPropertyAccess(
      { user: { id: 23, role: "USER" } } as any,
      res,
      91,
      ["OWNER", "MANAGER", "FRONT_DESK"],
    );

    expect(access).toBeNull();
    expect(res.status).toHaveBeenCalledWith(423);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: "NRMS_PROPERTY_FROZEN",
      referenceCode: "RST-004",
    }));
  });
});
