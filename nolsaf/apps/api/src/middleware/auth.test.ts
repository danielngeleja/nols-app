import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  jwtVerify,
  jwtDecode,
  sessionFindFirst,
  getRoleSessionMaxMinutes,
} = vi.hoisted(() => ({
  jwtVerify: vi.fn(),
  jwtDecode: vi.fn(),
  sessionFindFirst: vi.fn(),
  getRoleSessionMaxMinutes: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: jwtVerify, decode: jwtDecode },
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

describe("requireAuth schema compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getRoleSessionMaxMinutes.mockResolvedValue(60);
    process.env.JWT_SECRET = "auth-test-secret";
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "CUSTOMER",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    jwtDecode.mockReturnValue(null);
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

  it("does not let a stale signed ADMIN claim preserve admin authority after demotion", async () => {
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42,
        role: "CUSTOMER",
        email: "traveller@example.com",
        nrmsFinanceRole: "NONE",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
    });
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "ADMIN",
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
    });

    const { requireAuth, requireRole } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=stale-admin-token" } };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn(),
    };
    const authenticated = vi.fn();

    await requireAuth(req, res, authenticated);

    expect(authenticated).toHaveBeenCalledOnce();
    expect(sessionFindFirst).toHaveBeenCalledOnce();
    expect(req.user.role).toBe("USER");

    const authorized = vi.fn();
    await requireRole("ADMIN")(req, res, authorized);
    expect(authorized).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenLastCalledWith(403);
  });

  it("rejects an ADMIN session that was issued without completing MFA", async () => {
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42,
        role: "ADMIN",
        email: "admin@example.com",
        nrmsFinanceRole: "NONE",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
    });
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "ADMIN",
      iat: Math.floor(Date.now() / 1000),
    });

    const { requireAuth } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=password-only-admin" } };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Administrator verification required",
      code: "ADMIN_MFA_REQUIRED",
    });
  });

  it.each(["passkey", "totp"])("accepts an ADMIN session carrying the verified %s method", async (amr) => {
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42,
        role: "ADMIN",
        email: "admin@example.com",
        nrmsFinanceRole: "NONE",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
    });
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "ADMIN",
      amr,
      iat: Math.floor(Date.now() / 1000),
    });

    const { requireAuth } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=mfa-admin" } };
    const res: any = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.user).toMatchObject({ id: 42, role: "ADMIN" });
  });

  it("does not let any identity shortcut bypass a reduced role TTL", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    jwtVerify.mockReturnValue({
      sub: "42",
      sid: "session-42",
      role: "CUSTOMER",
      iat: nowSec - 31 * 60,
      exp: nowSec + 60 * 60,
    });
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42,
        role: "CUSTOMER",
        email: "traveller@example.com",
        nrmsFinanceRole: "NONE",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
      },
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
    expect(sessionFindFirst).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Session expired", code: "SESSION_EXPIRED" });
  });

  it.each([
    { field: "suspendedAt", value: new Date(), status: 403, code: "ACCOUNT_SUSPENDED" },
    { field: "isDisabled", value: true, status: 403, code: "ACCOUNT_DISABLED" },
  ])("rejects current account state: $field", async ({ field, value, status, code }) => {
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42,
        role: "ADMIN",
        email: "admin@example.com",
        nrmsFinanceRole: "NONE",
        suspendedAt: null,
        isDisabled: false,
        tokensValidAfter: null,
        [field]: value,
      },
    });

    const { requireAuth } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=current-state-token" } };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(status);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code }));
  });

  it("rejects the token immediately when its exact session has been revoked", async () => {
    sessionFindFirst.mockResolvedValue(null);

    const { requireAuth } = await import("./auth.js");
    const req: any = { headers: { cookie: "nolsaf_token=revoked-token" } };
    const res: any = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      clearCookie: vi.fn(),
    };
    const next = vi.fn();

    await requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Session revoked", code: "SESSION_REVOKED" });
  });

  it("lets owner support read while rejecting writes and preserving the admin actor", async () => {
    sessionFindFirst.mockResolvedValue({
      id: "session-42",
      lastSeenAt: new Date(),
      user: {
        id: 42, role: "OWNER", email: "owner@example.com",
        nrmsFinanceRole: "NONE", suspendedAt: null, isDisabled: false,
        tokensValidAfter: null, twoFactorEnabled: false,
      },
    });
    jwtVerify.mockReturnValue({
      sub: "42", sid: "session-42", role: "OWNER", imp: true, act: 7,
      iat: Math.floor(Date.now() / 1000),
    });
    const { requireAuth } = await import("./auth.js");
    const res: any = { set: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const read: any = { method: "GET", headers: { cookie: "nolsaf_token=support" } };
    const readNext = vi.fn();
    await requireAuth(read, res, readNext);
    expect(readNext).toHaveBeenCalledOnce();
    expect(read.user).toMatchObject({ imp: true, impersonatorId: 7 });

    const write: any = { method: "POST", headers: { cookie: "nolsaf_token=support" } };
    const writeNext = vi.fn();
    await requireAuth(write, res, writeNext);
    expect(writeNext).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "IMPERSONATION_FORBIDDEN" }));
  });

  it("blocks owner support mutations before custom routes while allowing the return endpoint", async () => {
    jwtDecode.mockReturnValue({ imp: true });
    sessionFindFirst.mockResolvedValue({
      id: "session-42", lastSeenAt: new Date(),
      user: { id: 42, role: "OWNER", email: "owner@example.com", nrmsFinanceRole: "NONE", suspendedAt: null, isDisabled: false, tokensValidAfter: null, twoFactorEnabled: false },
    });
    jwtVerify.mockReturnValue({ sub: "42", sid: "session-42", role: "OWNER", imp: true, act: 7, iat: Math.floor(Date.now() / 1000) });
    const { ownerSupportReadOnly } = await import("./auth.js");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await ownerSupportReadOnly({ method: "POST", path: "/api/owner/bookings", headers: { cookie: "nolsaf_token=support" } } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    await ownerSupportReadOnly({ method: "POST", path: "/api/auth/impersonation/end", headers: { cookie: "nolsaf_token=support" } } as any, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks sensitive downloads and agent writes during support", async () => {
    jwtDecode.mockReturnValue({ imp: true });
    jwtVerify.mockReturnValue({ sub: "42", sid: "session-42", role: "OWNER", imp: true, act: 7, iat: Math.floor(Date.now() / 1000) });
    sessionFindFirst.mockResolvedValue({
      id: "session-42", lastSeenAt: new Date(),
      user: { id: 42, role: "OWNER", email: "owner@example.com", nrmsFinanceRole: "NONE", suspendedAt: null, isDisabled: false, tokensValidAfter: null, twoFactorEnabled: false },
    });
    const { ownerSupportReadOnly } = await import("./auth.js");
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    await ownerSupportReadOnly({ method: "GET", path: "/api/owner/nrms/requests/1/guests/2/document", headers: { cookie: "nolsaf_token=support" } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();

    jwtVerify.mockReturnValue({ sub: "42", sid: "session-42", role: "AGENT", imp: true, act: 7, iat: Math.floor(Date.now() / 1000) });
    sessionFindFirst.mockResolvedValue({
      id: "session-42", lastSeenAt: new Date(),
      user: { id: 42, role: "AGENT", email: "agent@example.com", nrmsFinanceRole: "NONE", suspendedAt: null, isDisabled: false, tokensValidAfter: null, twoFactorEnabled: false, agentProfile: { status: "ACTIVE" } },
    });
    await ownerSupportReadOnly({ method: "POST", path: "/api/agent-portal/bookings", headers: { cookie: "nolsaf_token=support" } } as any, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
