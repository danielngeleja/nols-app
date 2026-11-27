import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const db: any = {
    salesAssistedListing: { findFirst: vi.fn(), updateMany: vi.fn(async () => ({ count: 1 })) },
    user: { findFirst: vi.fn(async () => null), updateMany: vi.fn(async () => ({ count: 1 })) },
  };
  db.$transaction = vi.fn(async (fn: any) => fn(db));
  return { db };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
// No Redis in tests: the code store falls back to memory outside production.
vi.mock("./redis.js", () => ({ getRedis: () => null }));

import { maskEmail, pendingOwnerEmailFor, preparePendingEmailCode, rejectPendingEmail, verifyPendingEmailCode } from "./ownerPendingEmail.js";

const owner = { id: 900, email: null as string | null };

beforeEach(() => {
  vi.clearAllMocks();
  h.db.salesAssistedListing.findFirst.mockResolvedValue({ id: 40, ownerEmail: "asha@example.com" });
  h.db.user.findFirst.mockResolvedValue(null);
  h.db.user.updateMany.mockResolvedValue({ count: 1 });
});

describe("owner pending email", () => {
  it("masks the address", () => {
    expect(maskEmail("asha.mussa@gmail.com")).toBe("as••••••@gmail.com");
  });

  it("offers nothing to an owner who already has an email", async () => {
    expect(await pendingOwnerEmailFor({ id: 900, email: "own@example.com" })).toBeNull();
    expect(h.db.salesAssistedListing.findFirst).not.toHaveBeenCalled();
  });

  it("puts the email on the account only after the right code", async () => {
    const prepared = await preparePendingEmailCode(owner);
    expect(prepared.ok).toBe(true);
    const code = prepared.ok ? prepared.code : "";
    const wrong = code === "000000" ? "111111" : "000000";

    expect(await verifyPendingEmailCode(owner, wrong)).toBe("INVALID");
    expect(h.db.user.updateMany).not.toHaveBeenCalled();

    expect(await verifyPendingEmailCode(owner, code)).toBe("VERIFIED");
    expect(h.db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 900, email: null },
      data: expect.objectContaining({ email: "asha@example.com", emailVerifiedAt: expect.any(Date) }),
    });
    expect(h.db.salesAssistedListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerEmailStatus: "VERIFIED" }) }));
  });

  it("a code works once", async () => {
    const prepared = await preparePendingEmailCode(owner);
    const code = prepared.ok ? prepared.code : "";
    expect(await verifyPendingEmailCode(owner, code)).toBe("VERIFIED");
    expect(await verifyPendingEmailCode(owner, code)).toBe("EXPIRED");
  });

  it("refuses an address another account now uses", async () => {
    h.db.user.findFirst.mockResolvedValue({ id: 5 });
    expect(await preparePendingEmailCode(owner)).toEqual({ ok: false, reason: "TAKEN" });
  });

  it("never replaces an email the owner set meanwhile", async () => {
    const prepared = await preparePendingEmailCode(owner);
    h.db.user.updateMany.mockResolvedValue({ count: 0 });
    expect(await verifyPendingEmailCode(owner, prepared.ok ? prepared.code : "")).toBe("NONE");
  });

  it("'Not my email' drops it", async () => {
    expect(await rejectPendingEmail(owner)).toBe(true);
    expect(h.db.salesAssistedListing.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ownerEmailStatus: "REJECTED" }) }));
  });
});
