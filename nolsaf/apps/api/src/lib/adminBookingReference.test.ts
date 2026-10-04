import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.fn();
vi.mock("@nolsaf/prisma", () => ({ prisma: { booking: { findMany: (...args: unknown[]) => findMany(...args) } } }));

// vi.mock is hoisted above imports, so these see the mocked prisma.
import { adminBookingReference, resolveAdminBookingReference } from "./adminBookingReference.js";

describe("admin booking references", () => {
  beforeEach(() => findMany.mockReset());

  it("never contains the row id", () => {
    const ref = adminBookingReference(55);
    expect(ref).toMatch(/^bk_[A-Za-z0-9_-]{22}$/);
    expect(ref).not.toContain("55");
  });

  it("resolves a reference back to its booking, paging newest first", async () => {
    const target = 1234;
    findMany
      .mockResolvedValueOnce(Array.from({ length: 2000 }, (_, i) => ({ id: 9000 - i })))
      .mockResolvedValueOnce([{ id: 2000 }, { id: target }, { id: 7 }]);
    await expect(resolveAdminBookingReference(adminBookingReference(target))).resolves.toBe(target);
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it("returns null for ids that do not match and for non-references", async () => {
    findMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    await expect(resolveAdminBookingReference(adminBookingReference(999))).resolves.toBeNull();
    await expect(resolveAdminBookingReference("55")).resolves.toBeNull();
    await expect(resolveAdminBookingReference("bk_short")).resolves.toBeNull();
  });
});
