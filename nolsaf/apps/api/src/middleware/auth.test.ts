import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jwtVerify,
  sessionFindFirst,
} = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  sessionFindFirst: vi.fn(),
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
  getRoleSessionMaxMinutes: vi.fn().mockResolvedValue(60),
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
  getCachedAuthSession: vi.fn().mockResolvedValue(null),
}));

describe("requireAuth schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
