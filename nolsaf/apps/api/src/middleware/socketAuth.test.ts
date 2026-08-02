import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jwtVerify,
  userFindUnique,
  sessionCount,
  getRoleSessionMaxMinutes,
} = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  userFindUnique: vi.fn(),
  sessionCount: vi.fn(),
  getRoleSessionMaxMinutes: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({ default: { verify: jwtVerify } }));
vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    session: { count: sessionCount },
  },
}));
vi.mock("../lib/securitySettings.js", () => ({ getRoleSessionMaxMinutes }));
vi.mock("../lib/activePresence.js", () => ({ touchActiveUser: vi.fn() }));

describe("Socket.IO role TTL enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "socket-test-secret";
    const nowSec = Math.floor(Date.now() / 1000);
    jwtVerify.mockReturnValue({ sub: "42", iat: nowSec - 60, exp: nowSec + 3600 });
    userFindUnique.mockResolvedValue({
      id: 42,
      role: "CUSTOMER",
      email: "traveller@example.com",
      suspendedAt: null,
      tokensValidAfter: null,
    });
    sessionCount.mockResolvedValue(1);
    getRoleSessionMaxMinutes.mockResolvedValue(180);
  });

  it("uses the CUSTOMER/Traveller override before exposing the mapped USER role", async () => {
    const { verifyToken } = await import("./socketAuth.js");
    const user = await verifyToken("traveller-token");

    expect(getRoleSessionMaxMinutes).toHaveBeenCalledWith("CUSTOMER");
    expect(user).toMatchObject({
      id: 42,
      role: "USER",
      sessionRole: "CUSTOMER",
      sessionIssuedAtSec: expect.any(Number),
    });
  });

  it("disconnects already-connected sockets that exceed a reduced policy", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getRoleSessionMaxMinutes.mockResolvedValue(30);
    const expiredSocket = {
      data: { user: { id: 42, role: "USER", sessionRole: "CUSTOMER", sessionIssuedAtSec: nowSec - 31 * 60 } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const currentSocket = {
      data: { user: { id: 7, role: "OWNER", sessionRole: "OWNER", sessionIssuedAtSec: nowSec - 5 * 60 } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const io = { fetchSockets: vi.fn().mockResolvedValue([expiredSocket, currentSocket]) };

    const { enforceSocketSessionPolicy } = await import("./socketAuth.js");
    await expect(enforceSocketSessionPolicy(io as any)).resolves.toBe(1);

    expect(expiredSocket.emit).toHaveBeenCalledWith("session:expired", {
      code: "SESSION_EXPIRED",
      message: "Session expired",
    });
    expect(expiredSocket.disconnect).toHaveBeenCalledWith(true);
    expect(currentSocket.disconnect).not.toHaveBeenCalled();
  });
});
