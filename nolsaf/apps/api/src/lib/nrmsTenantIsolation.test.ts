import { beforeEach, describe, expect, it, vi } from "vitest";

const propertyFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    property: { findFirst: propertyFindFirst },
  },
}));

describe("owner/property tenant boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires ownerId and propertyId in the same authoritative query", async () => {
    propertyFindFirst.mockResolvedValue(null);
    const { loadOwnedProperty } = await import("./nrms.js");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };

    await expect(loadOwnedProperty(res, 81, 902)).resolves.toBeNull();

    expect(propertyFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 902, ownerId: 81 },
    }));
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

