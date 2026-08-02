import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jwtVerify,
  sessionFindFirst,
  getRoleSessionMaxMinutes,
} = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  sessionFindFirst: vi.fn(),
  getRoleSessionMaxMinutes: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({ default: { verify: jwtVerify } }));
vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    session: { findFirst: sessionFindFirst },
  },
}));
vi.mock("../lib/securitySettings.js", () => ({ getRoleSessionMaxMinutes }));
vi.mock("../lib/activePresence.js", () => ({ touchActiveUser: vi.fn() }));

describe("Socket.IO role TTL enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "socket-test-secret";
    const nowSec = Math.floor(Date.now() / 1000);
    jwtVerify.mockReturnValue({ sub: "42", sid: "session-42", iat: nowSec - 60, exp: nowSec + 3600 });
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      user: {
        id: 42,
        role: "CUSTOMER",
        email: "traveller@example.com",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
    });
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
      sessionId: "session-42",
    });
    expect(sessionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "session-42", userId: 42, revokedAt: null },
    }));
  });

  it("rejects a socket when its exact device session is revoked even if another session exists", async () => {
    sessionFindFirst.mockResolvedValue(null);
    const { verifyToken } = await import("./socketAuth.js");
    await expect(verifyToken("revoked-device-token")).resolves.toBeNull();
  });

  it("disconnects already-connected sockets that exceed a reduced policy", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    getRoleSessionMaxMinutes.mockResolvedValue(30);
    sessionFindFirst.mockImplementation(async ({ where }: any) => ({
      user: {
        role: where.userId === 42 ? "CUSTOMER" : "OWNER",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
    }));
    const expiredSocket = {
      data: { user: { id: 42, role: "USER", sessionRole: "CUSTOMER", sessionIssuedAtSec: nowSec - 31 * 60, sessionId: "session-42" } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const currentSocket = {
      data: { user: { id: 7, role: "OWNER", sessionRole: "OWNER", sessionIssuedAtSec: nowSec - 5 * 60, sessionId: "session-7" } },
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

  it("disconnects a connected socket as soon as current database role differs", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    sessionFindFirst.mockResolvedValue({
      user: { role: "CUSTOMER", suspendedAt: null, isDisabled: false, tokensValidAfter: null },
    });
    const socket = {
      data: { user: { id: 42, role: "ADMIN", sessionRole: "ADMIN", sessionIssuedAtSec: nowSec, sessionId: "session-42" } },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };
    const io = { fetchSockets: vi.fn().mockResolvedValue([socket]) };

    const { enforceSocketSessionPolicy } = await import("./socketAuth.js");
    await expect(enforceSocketSessionPolicy(io as any)).resolves.toBe(1);
    expect(socket.emit).toHaveBeenCalledWith("session:expired", {
      code: "SESSION_REVOKED",
      message: "Session revoked",
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
