import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  users: [] as Array<Record<string, any>>,
  nextUserId: 1,
  sentMail: vi.fn(async (_to: string, _subject: string, _html: string) => ({
    success: true,
    provider: "test",
    messageId: "test-message",
  })),
  passwordHistory: vi.fn(async () => undefined),
  invalidateSession: vi.fn(async () => undefined),
}));

vi.mock("@nolsaf/prisma", () => {
  const findMatchingUser = (where: Record<string, any> | undefined) => {
    if (!where) return null;

    const matches = (user: Record<string, any>, condition: Record<string, any>) => {
      if (typeof condition.email === "string" && user.email === condition.email) return true;
      if (typeof condition.phone === "string" && user.phone === condition.phone) return true;
      if (typeof condition.name === "string" && user.name === condition.name) return true;
      return false;
    };

    if (Array.isArray(where.OR)) {
      return authState.users.find((user) => where.OR.some((condition: Record<string, any>) => matches(user, condition))) ?? null;
    }

    return authState.users.find((user) => matches(user, where)) ?? null;
  };

  return {
    prisma: {
      user: {
        findFirst: vi.fn(async ({ where }: { where?: Record<string, any> }) => findMatchingUser(where)),
        findUnique: vi.fn(async ({ where }: { where: { id: number | string } }) => (
          authState.users.find((user) => String(user.id) === String(where.id)) ?? null
        )),
        create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
          const user = {
            id: authState.nextUserId++,
            role: "CUSTOMER",
            emailVerifiedAt: null,
            phoneVerifiedAt: null,
            suspendedAt: null,
            isDisabled: false,
            twoFactorEnabled: false,
            twoFactorMethod: null,
            totpSecretEnc: null,
            kycStatus: null,
            kycNote: null,
            resetPasswordToken: null,
            resetPasswordExpires: null,
            tokensValidAfter: null,
            ...data,
          };
          authState.users.push(user);
          return user;
        }),
        update: vi.fn(async ({ where, data }: { where: { id: number | string }; data: Record<string, any> }) => {
          const user = authState.users.find((candidate) => String(candidate.id) === String(where.id));
          if (!user) throw new Error("Test user not found");
          Object.assign(user, data);
          return user;
        }),
      },
      systemSetting: {
        findUnique: vi.fn(async () => ({
          minPasswordLength: 8,
          requirePasswordUppercase: true,
          requirePasswordLowercase: true,
          requirePasswordNumber: true,
          requirePasswordSpecial: true,
          sessionIdleMinutes: 30,
          maxSessionDurationHours: 24,
        })),
      },
      notification: { create: vi.fn(async () => ({})) },
    },
  };
});

vi.mock("../lib/mailer.js", () => ({
  SECURITY_EMAIL_FROM: "security@example.test",
  sendMail: authState.sentMail,
}));

vi.mock("../lib/sms.js", () => ({
  sendSms: vi.fn(async () => ({ success: true, provider: "test", messageId: "test-sms" })),
}));

vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../lib/redis.js", () => ({ getRedis: vi.fn(() => null) }));
vi.mock("../lib/authSessionCache.js", () => ({
  invalidateAuthSessionCacheForToken: vi.fn(async () => undefined),
  invalidateAuthSessionCacheForUser: authState.invalidateSession,
}));
vi.mock("../lib/loginAttemptTracker.js", () => ({
  isEmailLocked: vi.fn(async () => ({ locked: false, lockedUntil: null })),
  recordFailedAttempt: vi.fn(async () => undefined),
  clearFailedAttempts: vi.fn(async () => undefined),
}));
vi.mock("../lib/sessionManager.js", () => ({
  signUserJwt: vi.fn(async ({ id }: { id: number }) => `test-token-${id}-${Date.now()}`),
  setAuthCookie: vi.fn(async () => undefined),
  clearAuthCookie: vi.fn(() => undefined),
}));
vi.mock("../routes/auth.adminMfa.js", () => ({
  beginAdminMfaChallenge: vi.fn(async (_req: unknown, res: express.Response) => res.status(500).json({ error: "unexpected_admin_flow" })),
}));
vi.mock("../lib/security.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/security.js")>();
  return {
    ...actual,
    addPasswordToHistory: authState.passwordHistory,
    getPasswordChangeCooldownRemaining: vi.fn(() => 0),
    isPasswordReused: vi.fn(async () => false),
    recordPasswordChangeSuccess: vi.fn(() => undefined),
  };
});

let app: express.Express;

beforeAll(async () => {
  process.env.NODE_ENV = "test";
  const { default: authRouter } = await import("../routes/auth.js");
  app = express();
  app.use(express.json());
  app.use("/api/auth", authRouter);
});

beforeEach(() => {
  authState.users.length = 0;
  authState.nextUserId = 1;
  authState.sentMail.mockClear();
  authState.passwordHistory.mockClear();
  authState.invalidateSession.mockClear();
});

describe("account authentication lifecycle", () => {
  it("creates an account, logs in, resets its password, and rejects the old password", async () => {
    const email = "auth.lifecycle@example.test";
    const originalPassword = "Start@2026Safe";
    const replacementPassword = "Changed@2026Safe";

    const created = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        name: "Auth Lifecycle Test",
        phone: "+255700000001",
        password: originalPassword,
        role: "traveller",
        registrationSource: "WEB",
      })
      .expect(201);

    expect(created.body).toMatchObject({
      ok: true,
      id: 1,
      email,
      role: "CUSTOMER",
      registrationStatus: "COMPLETE",
      registrationSource: "WEB",
    });
    expect(authState.passwordHistory).toHaveBeenCalledTimes(1);

    const duplicate = await request(app)
      .post("/api/auth/register")
      .send({
        email,
        name: "Duplicate Auth Lifecycle Test",
        phone: "+255700000002",
        password: originalPassword,
        role: "traveller",
      })
      .expect(409);

    expect(duplicate.body.error).toBe("email_already_in_use");

    await request(app)
      .post("/api/auth/login-password")
      .send({ email, password: "Wrong@2026Password" })
      .expect(401)
      .expect(({ body }) => expect(body.error).toBe("invalid_credentials"));

    await request(app)
      .post("/api/auth/login-password")
      .send({ email, password: originalPassword })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ ok: true, user: { id: 1, email, role: "CUSTOMER" } }));

    await request(app)
      .post("/api/auth/forgot-password")
      .send({ email })
      .expect(200)
      .expect(({ body }) => expect(body.ok).toBe(true));

    const resetMailCall = [...authState.sentMail.mock.calls]
      .reverse()
      .find((call) => String(call[2]).includes("/account/reset-password?token="));
    expect(resetMailCall, "forgot-password should send a reset link").toBeDefined();

    const resetHtml = String(resetMailCall?.[2] ?? "");
    const resetLinkMatch = resetHtml.match(/\/account\/reset-password\?token=([a-f0-9]+)(?:&|&amp;)id=(\d+)/i);
    expect(resetLinkMatch, "reset email should contain a token and user id").not.toBeNull();
    const [, resetToken, userId] = resetLinkMatch!;

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, userId, password: originalPassword })
      .expect(400)
      .expect(({ body }) => expect(body.message).toBe("password_reused"));

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, userId, password: replacementPassword })
      .expect(200)
      .expect(({ body }) => expect(body).toMatchObject({ ok: true, message: "password reset" }));

    expect(authState.invalidateSession).toHaveBeenCalledWith(1);
    expect(authState.users[0].resetPasswordToken).toBeNull();
    expect(authState.users[0].resetPasswordExpires).toBeNull();
    expect(authState.users[0].tokensValidAfter).toBeInstanceOf(Date);

    await request(app)
      .post("/api/auth/login-password")
      .send({ email, password: originalPassword })
      .expect(401);

    await request(app)
      .post("/api/auth/login-password")
      .send({ email, password: replacementPassword })
      .expect(200)
      .expect(({ body }) => expect(body.ok).toBe(true));

    await request(app)
      .post("/api/auth/reset-password")
      .send({ token: resetToken, userId, password: "Another@2026Safe" })
      .expect(400)
      .expect(({ body }) => expect(body.message).toBe("password_already_set"));
  }, 30_000);
});
