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

  it("records the verified method in an administrator JWT", async () => {
    const { signUserJwt } = await import("./sessionManager.js");
    const token = await signUserJwt(
      { id: 7, role: "ADMIN", email: "admin@example.com" },
      { adminMfa: "passkey" },
    );
    const payload = jwt.verify(token, "session-test-secret") as jwt.JwtPayload;

    expect(payload.role).toBe("ADMIN");
    expect(payload.amr).toBe("passkey");
  });

  it("marks owner support tokens and binds them to the issuing administrator", async () => {
    const { signUserJwt } = await import("./sessionManager.js");
    const token = await signUserJwt(
      { id: 42, role: "OWNER" },
      { impersonated: true, impersonatorId: 7, expiresInSeconds: 600 },
    );
    const payload = jwt.verify(token, "session-test-secret") as jwt.JwtPayload;
    expect(payload).toMatchObject({ sub: "42", role: "OWNER", imp: true, act: 7 });
    expect(Number(payload.exp) - Number(payload.iat)).toBe(600);
  });

  it("stores only an opaque support handle in a scoped httpOnly cookie and clears legacy backup", async () => {
    const { setImpersonationHandoffCookie, getImpersonationHandoffHandle, clearAuthCookie } = await import("./sessionManager.js");
    const res: any = { cookie: vi.fn(), clearCookie: vi.fn() };
    const handle = "a".repeat(43);
    setImpersonationHandoffCookie(res, handle);
    expect(res.cookie).toHaveBeenCalledWith("nolsaf_support_handoff", handle, expect.objectContaining({ httpOnly: true, path: "/api/auth/impersonation", maxAge: 600_000 }));
    expect(getImpersonationHandoffHandle(`token=owner; nolsaf_support_handoff=${handle}`)).toBe(handle);
    clearAuthCookie(res);
    expect(res.clearCookie).toHaveBeenCalledWith("nolsaf_support_admin", expect.objectContaining({ path: "/" }));
    expect(res.clearCookie).toHaveBeenCalledWith("nolsaf_support_handoff", expect.objectContaining({ path: "/api/auth/impersonation" }));
  });
});
