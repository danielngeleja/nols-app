import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionCreate } = vi.hoisted(() => ({ sessionCreate: vi.fn() }));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    session: {
      create: sessionCreate,
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("./securitySettings.js", () => ({
  getSessionIdleMinutes: vi.fn().mockResolvedValue(30),
  getMaxSessionDurationHours: vi.fn().mockResolvedValue(24),
  getRoleSessionMaxMinutes: vi.fn().mockResolvedValue(60),
  shouldForceLogoutOnPasswordChange: vi.fn().mockResolvedValue(true),
}));

describe("signUserJwt", () => {
  beforeEach(() => {
    sessionCreate.mockReset();
    sessionCreate.mockResolvedValue({ id: "session-uuid-1" });
    process.env.DEV_JWT_SECRET = "session-test-secret";
  });

  it("binds every user JWT to the newly created server session", async () => {
    const { signUserJwt } = await import("./sessionManager.js");
    const token = await signUserJwt({ id: 42, role: "OWNER", email: "owner@example.com" });
    const payload = jwt.verify(token, "session-test-secret") as jwt.JwtPayload;

    expect(sessionCreate).toHaveBeenCalledWith({
      data: { userId: 42, lastSeenAt: expect.any(Date) },
      select: { id: true },
    });
    expect(payload.sub).toBe("42");
    expect(payload.sid).toBe("session-uuid-1");
    expect(payload.role).toBe("OWNER");
  });
});
