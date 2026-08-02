import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  userUpdate: vi.fn(),
  sessionUpdateMany: vi.fn(),
  invalidate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
    user: { update: mocks.userUpdate },
    session: { updateMany: mocks.sessionUpdateMany },
  },
}));

vi.mock("./authSessionCache.js", () => ({
  invalidateAuthSessionCacheForUser: mocks.invalidate,
}));

describe("authorization invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userUpdate.mockReturnValue({ operation: "user" });
    mocks.sessionUpdateMany.mockReturnValue({ operation: "sessions" });
    mocks.transaction.mockResolvedValue([]);
    mocks.invalidate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete (global as any).io;
  });

  it("revokes DB sessions, cache entries, and every live user socket", async () => {
    const sockets = [
      { emit: vi.fn(), disconnect: vi.fn() },
      { emit: vi.fn(), disconnect: vi.fn() },
    ];
    const fetchSockets = vi.fn().mockResolvedValue(sockets);
    const inRoom = vi.fn().mockReturnValue({ fetchSockets });
    (global as any).io = { in: inRoom };

    const { revokeUserAuthorization } = await import("./authorizationInvalidation.js");
    await revokeUserAuthorization(73);

    expect(mocks.userUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 73 },
      data: { tokensValidAfter: expect.any(Date) },
    }));
    expect(mocks.sessionUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 73, revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    }));
    expect(mocks.transaction).toHaveBeenCalledWith([
      { operation: "user" },
      { operation: "sessions" },
    ]);
    expect(mocks.invalidate).toHaveBeenCalledWith(73);
    expect(inRoom).toHaveBeenCalledWith("user:73");
    for (const socket of sockets) {
      expect(socket.emit).toHaveBeenCalledWith("session:expired", expect.objectContaining({ code: "SESSION_REVOKED" }));
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    }
  });
});

