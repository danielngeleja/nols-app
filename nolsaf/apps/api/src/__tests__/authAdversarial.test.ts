import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { authenticator } from "otplib";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Local attack simulation: real Express routes, password hashing, JWT signing
// and verification, cookies, and role gates. Persistence and delivery are fakes;
// no real users, database credentials, email or SMS are used.
const state = vi.hoisted(() => ({
  users: [] as any[], sessions: [] as any[],
  mail: vi.fn(async (..._args: any[]) => ({ success: true, provider: "test" })),
  sms: vi.fn(async (..._args: any[]) => ({ success: true, provider: "test" })),
  passkeyOwner: 0,
  nextUserId: 1000,
}));
vi.mock("@nolsaf/prisma", () => {
  function matches(record: any, where: any): boolean {
    return Object.entries(where ?? {}).every(([key, value]: any) => {
      if (key === "OR") return value.some((part: any) => matches(record, part));
      if (key === "AND") return value.every((part: any) => matches(record, part));
      if (value && typeof value === "object" && !(value instanceof Date)) {
        if ("not" in value) return record[key] !== value.not;
        if ("in" in value) return value.in.includes(record[key]);
        if ("equals" in value) return JSON.stringify(record[key]) === JSON.stringify(value.equals);
      }
      return record[key] === value;
    });
  }
  return { prisma: {
    user: {
      updateMany: vi.fn(async ({ where, data }) => {
        const users = state.users.filter((u) => matches(u, where));
        users.forEach((u) => Object.assign(u, data)); return { count: users.length };
      }),
      findFirst: vi.fn(async ({ where }) => state.users.find((u) => matches(u, where)) ?? null),
      findUnique: vi.fn(async ({ where }) => state.users.find((u) => matches(u, where)) ?? null),
      create: vi.fn(async ({ data }) => {
        const user = { id: state.nextUserId++, suspendedAt: null, isDisabled: false,
          tokensValidAfter: null, nrmsFinanceRole: "NONE", emailVerifiedAt: null,
          phoneVerifiedAt: null, ...data };
        state.users.push(user); return user;
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        const existing = state.users.find((u) => matches(u, where));
        if (existing) { Object.assign(existing, update); return existing; }
        const user = { id: state.nextUserId++, suspendedAt: null, isDisabled: false,
          tokensValidAfter: null, nrmsFinanceRole: "NONE", ...create };
        state.users.push(user); return user;
      }),
      update: vi.fn(async ({ where, data }) => {
        const user = state.users.find((u) => matches(u, where));
        if (!user) throw new Error("Unknown test user");
        Object.assign(user, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined))); return user;
      }),
    },
    session: {
      create: vi.fn(async ({ data }) => {
        const session = { id: randomUUID(), revokedAt: null, ...data };
        state.sessions.push(session); return session;
      }),
      findFirst: vi.fn(async ({ where }) => {
        const session = state.sessions.find((s) => matches(s, where));
        return session ? { ...session, user: state.users.find((u) => u.id === session.userId) } : null;
      }),
      updateMany: vi.fn(async ({ where, data }) => {
        const sessions = state.sessions.filter((s) => matches(s, where));
        sessions.forEach((s) => Object.assign(s, data)); return { count: sessions.length };
      }),
    },
    systemSetting: { findUnique: vi.fn(async () => null) },
    passkey: { count: vi.fn(async () => 1),
      findFirst: vi.fn(async () => state.passkeyOwner ? { userId: state.passkeyOwner, credentialId: "dGVzdA", publicKey: "dGVzdA", signCount: 0 } : null),
      update: vi.fn(async () => ({})),
    },
    notification: { create: vi.fn(async () => ({})) },
  } };
});
vi.mock("../lib/mailer.js", () => ({ SECURITY_EMAIL_FROM: "security@example.test", sendMail: state.mail }));
vi.mock("../lib/sms.js", () => ({ sendSms: state.sms }));
vi.mock("../lib/audit.js", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("../lib/redis.js", () => ({ getRedis: () => null }));
vi.mock("../lib/activePresence.js", () => ({ touchActiveUser: vi.fn() }));
// Only the passkey policy test substitutes a successful WebAuthn ceremony.
// Password, TOTP, backup-code and JWT cryptography remain real.
vi.mock("@simplewebauthn/server", async (original) => ({
  ...await original<typeof import("@simplewebauthn/server")>(),
  verifyAuthenticationResponse: vi.fn(async () => ({ verified: Boolean(state.passkeyOwner), authenticationInfo: { newCounter: 1 } })),
}));
vi.mock("../lib/authSessionCache.js", () => ({
  invalidateAuthSessionCacheForToken: vi.fn(async () => undefined),
  invalidateAuthSessionCacheForUser: vi.fn(async () => undefined),
}));
vi.mock("../lib/security.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/security.js")>(),
  addPasswordToHistory: vi.fn(async () => undefined),
}));

const SECRET = "isolated-auth-adversarial-test-secret-2026";
const PASSWORD = "Owner@Test2026Safe";
let app: express.Express;
let sequence = 0;
let testIp: string;
beforeAll(async () => {
  process.env.NODE_ENV = "test";
  process.env.JWT_SECRET = SECRET;
  process.env.DEV_JWT_SECRET = SECRET;
  process.env.ENCRYPTION_KEY = "e".repeat(64);
  delete process.env.JWT_EXPIRES_IN;
  const { default: router } = await import("../routes/auth.js");
  const { requireAuth, requireRole } = await import("../middleware/auth.js");
  const { csrfProtection } = await import("../middleware/csrf.js");
  app = express();
  // Test clients get distinct IPs so independent cases don't consume one
  // another's limiter budget. Production proxy trust is not simulated here.
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(csrfProtection);
  app.use("/api/auth", router);
  app.get("/probe/session", requireAuth, (req: any, res) => res.json(req.user));
  for (const role of ["OWNER", "ADMIN", "DRIVER", "USER"] as const) {
    app.get(`/probe/${role}`, requireAuth, requireRole(role), (req: any, res) => res.json({ id: req.user.id, role: req.user.role }));
  }
});
beforeEach(() => {
  state.users.length = 0; state.sessions.length = 0;
  state.passkeyOwner = 0;
  state.mail.mockClear(); state.sms.mockClear();
  testIp = `192.0.2.${++sequence}`;
});
const post = (path: string, body: any) => request(app).post(`/api/auth/${path}`).set("X-Forwarded-For", testIp).send(body);
const get = (path: string, token: string) => request(app).get(`/probe/${path}`).set("Authorization", `Bearer ${token}`);
async function register(role = "OWNER") {
  const identity = { email: `owner-${sequence}-${state.users.length}@example.test`,
    name: `Owner ${sequence} ${state.users.length}`, phone: `+25571${String(sequence * 10 + state.users.length).padStart(7, "0")}` };
  const response = await post("register", { ...identity, role, password: PASSWORD });
  expect(response.status).toBe(201);
  return { ...identity, id: response.body.id };
}
async function ownerLogin() {
  const owner = await register();
  const response = await post("login-password", { email: owner.email, password: PASSWORD });
  expect(response.status).toBe(200);
  return { owner, token: response.body.token, response };
}
function deliveredOtp(channel: "email" | "phone"): string {
  const calls = channel === "email" ? state.mail.mock.calls : state.sms.mock.calls;
  const text = (calls.at(-1)?.map(String).join(" ") ?? "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]*>/g, " ");
  const code = text.match(/\b\d{6}\b/)?.[0];
  expect(code, "a six-digit OTP must be captured by the fake delivery provider").toBeTruthy();
  return code!;
}

describe("authentication attack simulations", () => {
  it("preserves OWNER through registration, password login, signed JWT, cookies and protected API access", async () => {
    const { owner, token, response } = await ownerLogin();
    expect(response.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
    expect(jwt.verify(token, SECRET)).toMatchObject({ sub: String(owner.id), role: "OWNER" });
    const cookies = response.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("nolsaf_token=") && c.includes("HttpOnly"))).toBe(true);
    await request(app).get("/probe/OWNER").set("Cookie", cookies.map((c) => c.split(";")[0]).join("; ")).expect(200);
    await get("USER", token).expect(403);
    await get("ADMIN", token).expect(403);
  });

  it("does not let role, user ID, MFA or app hints replace the account selected by credentials", async () => {
    const { owner } = await ownerLogin();
    const response = await post("login-password", { email: owner.email, password: PASSWORD,
      role: "ADMIN", userId: 999, amr: "passkey", loginApp: "WEB" });
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
    expect(jwt.verify(response.body.token, SECRET)).not.toHaveProperty("amr");
    await post("login-password", { email: owner.email, password: PASSWORD, loginApp: "CUSTOMER" }).expect(403);
    expect(state.users[0].role).toBe("OWNER");
  });

  it("uses the owner primary cookie even when a legacy traveller cookie appears first", async () => {
    const { token } = await ownerLogin();
    const traveller = await register("CUSTOMER");
    const login = await post("login-password", { email: traveller.email, password: PASSWORD });
    await request(app).get("/probe/OWNER")
      .set("Cookie", `token=${login.body.token}; nolsaf_token=${token}`).expect(200);
  });

  it("rejects signature tampering, unsigned JWTs, expired JWTs and foreign signing keys", async () => {
    const { token } = await ownerLogin();
    const payload = jwt.decode(token) as jwt.JwtPayload;
    const parts = token.split(".");
    parts[1] = Buffer.from(JSON.stringify({ ...payload, role: "ADMIN" })).toString("base64url");
    const { exp: _exp, iat: _iat, ...claims } = payload;
    const attacks = [parts.join("."), jwt.sign(claims, "", { algorithm: "none" }),
      jwt.sign(claims, SECRET, { expiresIn: -1 }), jwt.sign(claims, "attacker-key")];
    for (const attack of attacks) await get("session", attack).expect(401);
  });

  it("rejects session IDs bound to another user, missing sessions, and revoked sessions", async () => {
    const { token } = await ownerLogin();
    const payload = jwt.decode(token) as jwt.JwtPayload;
    for (const claims of [{ ...payload, sub: "999" }, { ...payload, sid: "missing" }, { ...payload, sid: undefined }]) {
      await get("session", jwt.sign(claims, SECRET)).expect(401);
    }
    state.sessions[0].revokedAt = new Date();
    await get("session", token).expect(401);
  });

  it("uses the live database role after demotion and requires MFA after promotion to ADMIN", async () => {
    const { token } = await ownerLogin();
    state.users[0].role = "CUSTOMER";
    await get("OWNER", token).expect(403);
    await get("USER", token).expect(200);
    state.users[0].role = "ADMIN";
    await get("ADMIN", token).expect(401);
  });

  it.each(["suspended", "disabled", "password-reset", "idle"])("invalidates an existing owner session when %s", async (reason) => {
    const { token } = await ownerLogin();
    if (reason === "suspended") state.users[0].suspendedAt = new Date();
    if (reason === "disabled") state.users[0].isDisabled = true;
    if (reason === "password-reset") state.users[0].tokensValidAfter = new Date(Date.now() + 2000);
    if (reason === "idle") state.sessions[0].lastSeenAt = new Date(0);
    await get("OWNER", token).expect(reason === "suspended" || reason === "disabled" ? 403 : 401);
  });

  it("rejects header and writable-cookie impersonation without a signed session", async () => {
    await request(app).get("/probe/ADMIN").set("x-role", "ADMIN").set("x-user-id", "1").set("Cookie", "role=ADMIN").expect(401);
  });

  it("requires an administrator challenge after a correct password and rejects SMS/email OTP as admin MFA", async () => {
    const owner = await register();
    Object.assign(state.users[0], { role: "ADMIN", phoneVerifiedAt: new Date() });
    const login = await post("login-password", { email: owner.email, password: PASSWORD }).expect(202);
    expect(login.body.adminMfaRequired).toBe(true);
    expect(login.body.token).toBeUndefined();
    expect(state.sessions).toHaveLength(0);
    await post("send-otp", { email: owner.email }).expect(200);
    await post("verify-otp", { email: owner.email, otp: deliveredOtp("email") }).expect(403);
    expect(state.sessions).toHaveLength(0);
  });

  it("does not resolve an owner email to another account whose display name matches that email", async () => {
    await register("CUSTOMER");
    const owner = await register();
    state.users[0].name = owner.email;
    const login = await post("login-password", { email: owner.email, password: PASSWORD }).expect(200);
    expect(login.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
  });

  it("normalizes email case and local phone notation without allowing display-name login", async () => {
    const owner = await register();
    for (const identifier of [` ${owner.email.toUpperCase()} `, owner.phone, `0${owner.phone.slice(4)}`]) {
      const login = await post("login-password", { email: identifier, password: PASSWORD }).expect(200);
      expect(login.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
    }
    const rejected = await post("login-password", { email: owner.name, password: PASSWORD });
    expect([400, 401]).toContain(rejected.status);
  });

  it("rejects expired and cross-destination OTPs without creating a session", async () => {
    const owner = await register();
    await post("send-otp", { email: owner.email }).expect(200);
    const otp = deliveredOtp("email");
    await post("verify-otp", { email: "different@example.test", otp }).expect(400);
    const now = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 181_000);
    try { await post("verify-otp", { email: owner.email, otp }).expect(400); }
    finally { clock.mockRestore(); }
    expect(state.sessions).toHaveLength(0);
  });

  it("returns lockout after repeated incorrect passwords and refuses the correct password during lockout", async () => {
    const owner = await register();
    let lastStatus = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      lastStatus = (await post("login-password", { email: owner.email, password: "incorrect" })).status;
    }
    expect(lastStatus).toBe(423);
    await post("login-password", { email: owner.email, password: PASSWORD }).expect(423);
    expect(state.sessions).toHaveLength(0);
  });

  it("owner TOTP enrollment prevents password-only session issuance", async () => {
    const owner = await register();
    Object.assign(state.users[0], { twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecretEnc: "configured-fixture" });
    const login = await post("login-password", { email: owner.email, password: PASSWORD });
    expect(login.status).toBe(202);
    expect(login.body.mfaRequired).toBe(true);
    expect(login.body.token).toBeUndefined();
    expect(state.sessions).toHaveLength(0);
  });

  it.each(["email", "phone"] as const)("retains the stored owner role through %s OTP login and rejects replay", async (channel) => {
    const owner = await register();
    const destination = { [channel]: owner[channel] };
    await post("send-otp", destination).expect(200);
    const otp = deliveredOtp(channel);
    const login = await post("verify-otp", { ...destination, otp });
    expect(login.status).toBe(200);
    expect(login.body.user.role).toBe("OWNER");
    await get("OWNER", login.body.token).expect(200);
    await post("verify-otp", { ...destination, otp }).expect(400);
  });

  it("rejects changing an owner signup OTP to a traveller signup", async () => {
    const email = `otp-owner-${sequence}@example.test`;
    await post("send-otp", { email, role: "OWNER" }).expect(200);
    const otp = deliveredOtp("email");
    await post("verify-otp", { email, role: "CUSTOMER", otp }).expect(400);
    expect(state.users).toHaveLength(0);
    const owner = await post("verify-otp", { email, role: "OWNER", otp }).expect(200);
    expect(owner.body.user.role).toBe("OWNER");
    await get("OWNER", owner.body.token).expect(200);
  });

  it.each(["ADMIN", "AGENT", "NRMS_AGENT", "OWENR", "PARTNERS", { role: "OWNER" }])(
    "rejects unsupported registration role %j instead of silently creating a traveller", async (role) => {
      const response = await post("register", { email: `invalid-${sequence}@example.test`, name: "Invalid role",
        phone: "+255719000001", password: PASSWORD, role });
      expect(response.status).toBe(400);
      expect(state.users).toHaveLength(0);
      expect(state.sessions).toHaveLength(0);
    },
  );

  it("rejects unsupported OTP roles before delivery or session issuance", async () => {
    const email = `invalid-otp-${sequence}@example.test`;
    await post("send-otp", { email, role: "OWENR" }).expect(400);
    await post("verify-otp", { email, role: "OWENR", otp: "123456" }).expect(400);
    expect(state.mail).not.toHaveBeenCalled();
    expect(state.users).toHaveLength(0);
    expect(state.sessions).toHaveLength(0);
  });

  it.each(["revoked", "suspended", "disabled", "impersonated"])("blocks onboarding profile writes from a %s session", async (reason) => {
    const { owner, token } = await ownerLogin();
    let credential = token;
    if (reason === "revoked") state.sessions[0].revokedAt = new Date();
    if (reason === "suspended") state.users[0].suspendedAt = new Date();
    if (reason === "disabled") state.users[0].isDisabled = true;
    if (reason === "impersonated") credential = jwt.sign({ ...(jwt.decode(token) as jwt.JwtPayload), imp: true }, SECRET);
    const response = await post("profile", { role: "OWNER", name: "Unauthorized change" })
      .set("Authorization", `Bearer ${credential}`);
    expect(response.status).toBe(reason === "revoked" ? 401 : 403);
    expect(state.users[0].name).toBe(owner.name);
  });

  it("finishes owner OTP onboarding, then signs in with password without changing role", async () => {
    const email = `onboard-owner-${sequence}@example.test`;
    await post("send-otp", { email, role: "OWNER" }).expect(200);
    const signup = await post("verify-otp", { email, role: "OWNER", otp: deliveredOtp("email") }).expect(200);
    await post("profile", { role: "CUSTOMER", name: "Wrong role" })
      .set("Authorization", `Bearer ${signup.body.token}`).expect(400);
    await post("profile", { role: "OWNER", email, name: "Onboarded Owner", phone: "+255718000001", password: PASSWORD })
      .set("Authorization", `Bearer ${signup.body.token}`).expect(200);
    const login = await post("login-password", { email, password: PASSWORD }).expect(200);
    expect(login.body.user.role).toBe("OWNER");
    await get("OWNER", login.body.token).expect(200);
  });

  it.each([{ email: { $ne: null }, password: PASSWORD }, { email: "x@example.test", password: [PASSWORD] }])(
    "rejects structured credential injection %j", async (body) => {
      await post("login-password", body).expect(400);
      expect(state.sessions).toHaveLength(0);
    },
  );
});

async function enrolledOwner() {
  const owner = await register();
  const secret = authenticator.generateSecret();
  const { encrypt, hashCode } = await import("../lib/crypto.js");
  const backup = "recovery-" + randomUUID();
  Object.assign(state.users[0], { twoFactorEnabled: true, twoFactorMethod: "TOTP",
    totpSecretEnc: encrypt(secret), backupCodesHash: [await hashCode(backup)] });
  return { owner, secret, backup };
}
async function challenge(owner: { email: string }) {
  const result = await post("login-password", { email: owner.email, password: PASSWORD }).expect(202);
  expect(result.body.token).toBeUndefined();
  return result.body.challengeId as string;
}

describe("enrolled account MFA enforcement", () => {
  it("requires real authenticator verification, preserves OWNER, and rejects challenge/code replay", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    await get("OWNER", id).expect(401);
    const code = authenticator.generate(secret);
    const login = await post("mfa/verify", { challengeId: id, code }).expect(200);
    expect(login.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
    expect(jwt.verify(login.body.token, SECRET)).toMatchObject({ mfa: "totp" });
    await get("OWNER", login.body.token).expect(200);
    const { verifyToken } = await import("../middleware/socketAuth.js");
    expect(await verifyToken(login.body.token)).toMatchObject({ role: "OWNER" });
    await post("mfa/verify", { challengeId: id, code }).expect(401);
    const nextId = await challenge(owner);
    await post("mfa/verify", { challengeId: nextId, code }).expect(400);
    expect(state.sessions).toHaveLength(1);
  });

  it.each(["email", "phone"] as const)("%s login OTP cannot bypass enrolled TOTP", async (channel) => {
    const { owner } = await enrolledOwner();
    const destination = { [channel]: owner[channel] };
    await post("send-otp", destination).expect(200);
    const response = await post("verify-otp", { ...destination, otp: deliveredOtp(channel) }).expect(202);
    expect(response.body.mfaRequired).toBe(true);
    expect(response.body.token).toBeUndefined();
    expect(state.sessions).toHaveLength(0);
  });

  it("a verified passkey still requests the enrolled TOTP before issuing a session", async () => {
    const { owner } = await enrolledOwner();
    state.passkeyOwner = owner.id;
    const options = await post("passkeys/options", {}).expect(200);
    const login = await post("passkeys/verify", { sessionId: options.body.sessionId, response: { id: "dGVzdA" } }).expect(202);
    expect(login.body.mfaRequired).toBe(true);
    expect(state.sessions).toHaveLength(0);
  });

  it("accepts a backup code once, including across concurrent challenges", async () => {
    const { owner, backup } = await enrolledOwner();
    const ids = [await challenge(owner), await challenge(owner)];
    const results = await Promise.all(ids.map((challengeId) => post("mfa/verify", { challengeId, code: backup, useBackupCode: true })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
    const token = results.find((r) => r.status === 200)!.body.token;
    await get("OWNER", token).expect(200);
    expect(state.users[0].backupCodesHash).toEqual([]);
    expect(state.sessions).toHaveLength(1);
  });

  it("allows only one concurrent verification to consume a challenge", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    const code = authenticator.generate(secret);
    const results = await Promise.all([1, 2].map(() => post("mfa/verify", { challengeId: id, code })));
    expect(results.map((r) => r.status).sort()).toEqual([200, 401]);
    expect(state.sessions).toHaveLength(1);
  });

  it("stops verification after five bad attempts, including malformed codes", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    for (let i = 0; i < 5; i++) await post("mfa/verify", { challengeId: id, code: "bad" }).expect(400);
    await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret) }).expect(401);
    expect(state.sessions).toHaveLength(0);
  });

  it("does not reset the account attempt budget by starting another challenge or changing IP", async () => {
    const { owner, secret } = await enrolledOwner();
    for (let round = 0; round < 2; round++) {
      const id = await challenge(owner);
      for (let attempt = 0; attempt < 5; attempt++) await post("mfa/verify", { challengeId: id, code: "bad" }).expect(400);
    }
    const id = await challenge(owner);
    const result = await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret), email: "spoofed-bucket@example.test" })
      .set("X-Forwarded-For", "198.51.100.44").expect(429);
    expect(result.body.code).toBe("MFA_RATE_LIMITED");
    expect(state.sessions).toHaveLength(0);
  });

  it("rejects HTTP and connected sockets when the enrolled authenticator changes", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    const login = await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret) }).expect(200);
    const { verifyToken, enforceSocketSessionPolicy } = await import("../middleware/socketAuth.js");
    const socket: any = { data: { user: await verifyToken(login.body.token) }, emit: vi.fn(), disconnect: vi.fn() };
    state.users[0].totpSecretEnc = "replacement-enrollment";
    await get("OWNER", login.body.token).expect(401);
    expect(await enforceSocketSessionPolicy({ fetchSockets: async () => [socket] } as any)).toBe(1);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it("does not silently bypass an enabled authenticator whose secret is missing", async () => {
    const { owner } = await enrolledOwner();
    state.users[0].totpSecretEnc = null;
    await post("login-password", { email: owner.email, password: PASSWORD }).expect(403);
    expect(state.sessions).toHaveLength(0);
  });

  it("rejects an untrusted browser origin while allowing verification with stale auth cookies", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    const original = process.env.WEB_ORIGIN;
    process.env.WEB_ORIGIN = "https://app.nolsaf.test";
    try {
      const body = { challengeId: id, code: authenticator.generate(secret) };
      await post("mfa/verify", body).set("Cookie", "nolsaf_token=stale")
        .set("Origin", "https://attacker.example").expect(403);
      expect(state.sessions).toHaveLength(0);
      await post("mfa/verify", body).set("Cookie", "nolsaf_token=stale")
        .set("Origin", "https://app.nolsaf.test").expect(200);
    } finally {
      if (original === undefined) delete process.env.WEB_ORIGIN;
      else process.env.WEB_ORIGIN = original;
    }
  });

  it.each(["password", "role", "enrollment", "suspension", "revocation", "disabled"])("rejects a pending challenge after a %s change", async (change) => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    if (change === "password") state.users[0].passwordHash = "changed";
    if (change === "role") state.users[0].role = "ADMIN";
    if (change === "enrollment") state.users[0].totpSecretEnc = "changed";
    if (change === "suspension") state.users[0].suspendedAt = new Date();
    if (change === "revocation") state.users[0].tokensValidAfter = new Date();
    if (change === "disabled") state.users[0].isDisabled = true;
    await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret) }).expect(403);
    expect(state.sessions).toHaveLength(0);
  });

  it("expires a pending challenge without accepting a valid code", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 301_000);
    try { await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret) }).expect(401); }
    finally { clock.mockRestore(); }
    expect(state.sessions).toHaveLength(0);
  });

  it("rejects legacy password-only sessions over HTTP and sockets after TOTP enrollment", async () => {
    const { token } = await ownerLogin();
    Object.assign(state.users[0], { twoFactorEnabled: true, twoFactorMethod: "TOTP", totpSecretEnc: "enrolled" });
    await get("OWNER", token).expect(401);
    const { verifyToken } = await import("../middleware/socketAuth.js");
    expect(await verifyToken(token)).toBeNull();
  });

  it("cannot substitute a different user, role or MFA claim in verification input", async () => {
    const { owner, secret } = await enrolledOwner();
    const id = await challenge(owner);
    const login = await post("mfa/verify", { challengeId: id, code: authenticator.generate(secret), userId: 999,
      role: "ADMIN", mfa: "totp", amr: "passkey" }).expect(200);
    expect(login.body.user).toMatchObject({ id: owner.id, role: "OWNER" });
    await get("ADMIN", login.body.token).expect(403);
  });

  it("fails closed if the production MFA store is unavailable", async () => {
    const { owner } = await enrolledOwner();
    process.env.NODE_ENV = "production";
    try {
      const response = await post("login-password", { email: owner.email, password: PASSWORD }).expect(503);
      expect(response.body.token).toBeUndefined();
    } finally { process.env.NODE_ENV = "test"; }
    expect(state.sessions).toHaveLength(0);
  });
});
