import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jwtVerify,
  sessionFindFirst,
  getRoleSessionMaxMinutes,
  getCachedAuthSession,
} = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  sessionFindFirst: vi.fn(),
  getRoleSessionMaxMinutes: vi.fn(),
  getCachedAuthSession: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: jwtVerify },
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    session: {
      findFirst: sessionFindFirst,
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../lib/securitySettings.js", () => ({
  getRoleSessionMaxMinutes,
  getSessionIdleMinutes: vi.fn().mockResolvedValue(30),
}));

vi.mock("../lib/sessionManager.js", () => ({
  clearAuthCookie: vi.fn(),
}));

vi.mock("../lib/activePresence.js", () => ({
  touchActiveUser: vi.fn(),
}));

vi.mock("../lib/authSessionCache.js", () => ({
  cacheAuthSession: vi.fn().mockResolvedValue(undefined),
  getCachedAuthSession,
}));

describe("requireAuth schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRoleSessionMaxMinutes.mockResolvedValue(60);
    getCachedAuthSession.mockResolvedValue(null);
    process.env.JWT_SECRET = "auth-test-secret";
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "CUSTOMER",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
  });

  it("keeps ordinary login available while the finance-role migration is pending", async () => {
    const missingColumn = Object.assign(
      new Error("Unknown column `user.nrmsFinanceRole`"),
      { code: "P2022" },
    );
    sessionFindFirst
      .mockRejectedValueOnce(missingColumn)
      .mockResolvedValueOnce({
        id: "session-42",
        lastSeenAt: new Date(),
        user: {
          id: 42,
          role: "CUSTOMER",
          email: "traveller@example.com",
          suspendedAt: null,
          tokensValidAfter: null,
        },
      });

    const { requireAuth } = await import("./auth.js");
    const req: any = {
      headers: { cookie: "nolsaf_token=test-token" },
    };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({
      id: 42,
      role: "USER",
      nrmsFinanceRole: "NONE",
      sessionId: "session-42",
    });
    expect(sessionFindFirst).toHaveBeenCalledTimes(2);
    expect(
      sessionFindFirst.mock.calls[1][0].select.user.select,
    ).not.toHaveProperty("nrmsFinanceRole");
  });

  it("does not let the identity cache bypass a reduced role TTL", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "CUSTOMER",
      iat: nowSec - 31 * 60,
      exp: nowSec + 60 * 60,
    });
    getCachedAuthSession.mockResolvedValue({
      id: 42,
      role: "USER",
      email: "traveller@example.com",
      sessionId: "session-42",
    });
    getRoleSessionMaxMinutes.mockResolvedValue(30);

    const { requireAuth } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=cached-token" } };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(getRoleSessionMaxMinutes).toHaveBeenCalledWith("CUSTOMER");
    expect(sessionFindFirst).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Session expired", code: "SESSION_EXPIRED" });
  });
});
