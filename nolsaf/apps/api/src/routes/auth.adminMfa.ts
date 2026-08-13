import crypto from "crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { authenticator } from "otplib";
import { decrypt } from "../lib/crypto.js";
import { audit } from "../lib/audit.js";
import { hashCode } from "../lib/otp.js";
import { getRedis } from "../lib/redis.js";
import { sendSms } from "../lib/sms.js";
import { signUserJwt, setAuthCookie } from "../lib/sessionManager.js";
import { getWebAuthnRp } from "../lib/webauthnRp.js";
import { limitOtpSend, limitOtpVerify } from "../middleware/rateLimit.js";

const CHALLENGE_COOKIE = "nolsaf_admin_mfa";
const CHALLENGE_TTL_SEC = 5 * 60;
const SMS_TTL_MS = 3 * 60 * 1000;
const SMS_RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_VERIFY_FAILURES = 5;
const REDIS_PREFIX = "auth:admin-mfa:";

type AdminMfaMethod = "passkey" | "totp";

type AdminMfaChallenge = {
  userId: number;
  expiresAt: number;
  passkeyCount: number;
  totpConfigured: boolean;
  bootstrapVerified: boolean;
  failures: number;
  authenticationChallenge?: string;
  registrationChallenge?: string;
  smsCodeHash?: string;
  smsExpiresAt?: number;
  smsSentAt?: number;
};

export type AdminMfaStartUser = {
  id: number;
  role: string | null;
  email: string | null;
  phone: string | null;
  phoneVerifiedAt: Date | null;
  twoFactorEnabled: boolean;
  twoFactorMethod: string | null;
  totpSecretEnc: string | null;
};

const fallbackChallenges = new Map<string, AdminMfaChallenge>();

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (!name) continue;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
  }
  return result;
}

function challengeIdFrom(req: Request): string | null {
  const value = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE];
  return value && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function cookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  const domain = (process.env.COOKIE_DOMAIN || "").trim() || undefined;
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ("none" as const) : ("lax" as const),
    path: "/api/auth/admin-mfa",
    maxAge: CHALLENGE_TTL_SEC * 1000,
    ...(domain ? { domain } : {}),
  };
}

function clearChallengeCookie(res: Response): void {
  const domain = (process.env.COOKIE_DOMAIN || "").trim() || undefined;
  res.clearCookie(CHALLENGE_COOKIE, {
    path: "/api/auth/admin-mfa",
    ...(domain ? { domain } : {}),
  });
}

async function putChallenge(id: string, challenge: AdminMfaChallenge): Promise<void> {
  const remainingSeconds = Math.max(1, Math.ceil((challenge.expiresAt - Date.now()) / 1000));
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}${id}`, JSON.stringify(challenge), "EX", remainingSeconds);
      return;
    } catch {
      // A local fallback keeps development usable when Redis is unavailable.
    }
  }
  fallbackChallenges.set(id, challenge);
}

async function readChallenge(id: string): Promise<AdminMfaChallenge | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_PREFIX}${id}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as AdminMfaChallenge;
      if (parsed.expiresAt <= Date.now()) return null;
      return parsed;
    } catch {
      // Fall through to the local store only when Redis itself failed.
    }
  }
  const challenge = fallbackChallenges.get(id) || null;
  if (!challenge) return null;
  if (challenge.expiresAt <= Date.now()) {
    fallbackChallenges.delete(id);
    return null;
  }
  return challenge;
}

async function removeChallenge(id: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(`${REDIS_PREFIX}${id}`);
    } catch {
      // The local copy is still removed below.
    }
  }
  fallbackChallenges.delete(id);
}

function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  const prefix = phone.trim().startsWith("+") ? `+${digits.slice(0, Math.min(3, digits.length - 3))}` : "";
  return `${prefix} ••• ••• ${digits.slice(-3)}`.trim();
}

function base64UrlToBuffer(input: string): Buffer {
  let normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  while (normalized.length % 4) normalized += "=";
  return Buffer.from(normalized, "base64");
}

function bufferToBase64Url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function normalizeCredentialId(input: unknown): string {
  return String(input || "").trim().replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function loadRequestChallenge(req: Request, res: Response): Promise<{ id: string; challenge: AdminMfaChallenge } | null> {
  const id = challengeIdFrom(req);
  if (!id) {
    res.status(401).json({ error: "Admin verification has expired.", code: "ADMIN_MFA_EXPIRED" });
    return null;
  }
  const challenge = await readChallenge(id);
  if (!challenge) {
    clearChallengeCookie(res);
    res.status(401).json({ error: "Admin verification has expired.", code: "ADMIN_MFA_EXPIRED" });
    return null;
  }
  return { id, challenge };
}

async function recordFailure(id: string, challenge: AdminMfaChallenge, res: Response): Promise<boolean> {
  challenge.failures += 1;
  if (challenge.failures >= MAX_VERIFY_FAILURES) {
    await removeChallenge(id);
    clearChallengeCookie(res);
    res.status(429).json({ error: "Too many failed verification attempts. Sign in again.", code: "ADMIN_MFA_LOCKED" });
    return true;
  }
  await putChallenge(id, challenge);
  return false;
}

async function completeAdminLogin(
  req: Request,
  res: Response,
  id: string,
  method: AdminMfaMethod,
): Promise<void> {
  const state = await readChallenge(id);
  if (!state) {
    clearChallengeCookie(res);
    res.status(401).json({ error: "Admin verification has expired.", code: "ADMIN_MFA_EXPIRED" });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: state.userId },
    select: { id: true, role: true, email: true, suspendedAt: true, isDisabled: true },
  });
  if (!user || String(user.role || "").toUpperCase() !== "ADMIN" || user.suspendedAt || user.isDisabled) {
    await removeChallenge(id);
    clearChallengeCookie(res);
    res.status(403).json({ error: "Admin account is not available.", code: "ADMIN_ACCOUNT_UNAVAILABLE" });
    return;
  }

  const token = await signUserJwt(
    { id: user.id, role: user.role, email: user.email },
    { adminMfa: method },
  );
  await setAuthCookie(res, token, user.role);
  await removeChallenge(id);
  clearChallengeCookie(res);

  try {
    (req as any).user = user;
    await audit(req as any, "ADMIN_MFA_VERIFIED", `user:${user.id}`, null, { method });
    await audit(req as any, "USER_LOGIN", `user:${user.id}`, null, {
      role: user.role,
      email: user.email,
      loginMethod: method,
      event: "login",
      success: true,
      mfa: true,
    });
  } catch {
    // Audit delivery never turns a verified login into an outage.
  }

  res.json({ ok: true, token, user: { id: user.id, role: user.role, email: user.email }, adminMfa: method });
}

export async function beginAdminMfaChallenge(
  req: Request,
  res: Response,
  user: AdminMfaStartUser,
): Promise<Response> {
  const passkeyCount = await prisma.passkey.count({ where: { userId: user.id } });
  const totpConfigured = Boolean(
    user.twoFactorEnabled &&
    String(user.twoFactorMethod || "").toUpperCase() === "TOTP" &&
    user.totpSecretEnc,
  );
  const id = crypto.randomBytes(32).toString("hex");
  const challenge: AdminMfaChallenge = {
    userId: user.id,
    expiresAt: Date.now() + CHALLENGE_TTL_SEC * 1000,
    passkeyCount,
    totpConfigured,
    bootstrapVerified: false,
    failures: 0,
  };
  await putChallenge(id, challenge);
  res.cookie(CHALLENGE_COOKIE, id, cookieOptions());

  try {
    (req as any).user = user;
    await audit(req as any, "ADMIN_MFA_CHALLENGE_STARTED", `user:${user.id}`, null, {
      passkeyEnrolled: passkeyCount > 0,
      totpConfigured,
    });
  } catch {
    // Best effort.
  }

  return res.status(202).json({
    ok: false,
    adminMfaRequired: true,
    code: "ADMIN_MFA_REQUIRED",
    expiresInSeconds: CHALLENGE_TTL_SEC,
    enrollmentRequired: passkeyCount === 0,
    methods: {
      passkey: passkeyCount > 0,
      totp: totpConfigured,
      smsBootstrap: passkeyCount === 0 && Boolean(user.phone && user.phoneVerifiedAt),
    },
    maskedPhone: maskPhone(user.phone),
  });
}

export const adminMfaRouter = Router();

adminMfaRouter.post("/admin-mfa/passkey/options", async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  const credentials = await prisma.passkey.findMany({
    where: { userId: loaded.challenge.userId },
    select: { credentialId: true, transports: true },
  });
  if (!credentials.length) {
    return res.status(409).json({ error: "A passkey must be registered first.", code: "ADMIN_PASSKEY_ENROLLMENT_REQUIRED" });
  }
  const { rpID } = getWebAuthnRp();
  const options = await generateAuthenticationOptions({
    timeout: 60_000,
    rpID,
    userVerification: "required",
    allowCredentials: credentials.map((credential) => ({
      id: credential.credentialId,
      type: "public-key" as const,
      transports: Array.isArray(credential.transports) ? credential.transports as any : undefined,
    })),
  });
  loaded.challenge.authenticationChallenge = options.challenge;
  await putChallenge(loaded.id, loaded.challenge);
  return res.json({ publicKey: options });
});

adminMfaRouter.post("/admin-mfa/passkey/verify", async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  if (!loaded.challenge.authenticationChallenge) {
    return res.status(400).json({ error: "Request new passkey options.", code: "ADMIN_MFA_OPTIONS_REQUIRED" });
  }
  const response = req.body?.response;
  const credentialId = normalizeCredentialId(response?.id || response?.rawId);
  const stored = credentialId ? await prisma.passkey.findFirst({
    where: { userId: loaded.challenge.userId, credentialId },
  }) : null;
  if (!stored) {
    if (await recordFailure(loaded.id, loaded.challenge, res)) return;
    return res.status(400).json({ error: "Passkey does not belong to this administrator.", code: "ADMIN_MFA_INVALID" });
  }

  try {
    const { rpID, expectedOrigins } = getWebAuthnRp();
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: loaded.challenge.authenticationChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      authenticator: {
        credentialID: stored.credentialId,
        credentialPublicKey: base64UrlToBuffer(stored.publicKey),
        counter: stored.signCount,
      },
      requireUserVerification: true,
    } as any);
    if (!verification.verified) throw new Error("not verified");
    const counter = verification.authenticationInfo?.newCounter;
    if (typeof counter === "number") {
      await prisma.passkey.update({ where: { credentialId: stored.credentialId }, data: { signCount: counter } });
    }
    await completeAdminLogin(req, res, loaded.id, "passkey");
  } catch {
    if (await recordFailure(loaded.id, loaded.challenge, res)) return;
    return res.status(400).json({ error: "Passkey verification failed.", code: "ADMIN_MFA_INVALID" });
  }
});

adminMfaRouter.post("/admin-mfa/totp/verify", async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  const code = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Enter a six-digit authenticator code." });
  const user = await prisma.user.findUnique({
    where: { id: loaded.challenge.userId },
    select: { twoFactorEnabled: true, twoFactorMethod: true, totpSecretEnc: true },
  });
  let verified = false;
  try {
    verified = Boolean(
      user?.twoFactorEnabled &&
      String(user.twoFactorMethod || "").toUpperCase() === "TOTP" &&
      user.totpSecretEnc &&
      authenticator.verify({ token: code, secret: decrypt(user.totpSecretEnc, { log: false }) }),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    if (await recordFailure(loaded.id, loaded.challenge, res)) return;
    return res.status(400).json({ error: "Authenticator code is invalid.", code: "ADMIN_MFA_INVALID" });
  }
  if (loaded.challenge.passkeyCount === 0) {
    loaded.challenge.bootstrapVerified = true;
    loaded.challenge.failures = 0;
    await putChallenge(loaded.id, loaded.challenge);
    return res.json({ ok: true, enrollmentRequired: true });
  }
  await completeAdminLogin(req, res, loaded.id, "totp");
});

adminMfaRouter.post("/admin-mfa/bootstrap/send", limitOtpSend, async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  if (loaded.challenge.passkeyCount > 0) {
    return res.status(403).json({ error: "SMS recovery requires support approval.", code: "ADMIN_MFA_RECOVERY_REVIEW" });
  }
  if (loaded.challenge.smsSentAt && Date.now() - loaded.challenge.smsSentAt < SMS_RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((SMS_RESEND_COOLDOWN_MS - (Date.now() - loaded.challenge.smsSentAt)) / 1000);
    return res.status(429).json({ error: `Wait ${retryAfter} seconds before requesting another code.`, retryAfter });
  }
  const user = await prisma.user.findUnique({
    where: { id: loaded.challenge.userId },
    select: { phone: true, phoneVerifiedAt: true },
  });
  if (!user?.phone || !user.phoneVerifiedAt) {
    return res.status(403).json({ error: "A verified administrator phone is required.", code: "ADMIN_PHONE_REQUIRED" });
  }
  const code = crypto.randomInt(100000, 1000000).toString();
  const delivery = await sendSms(user.phone, `Your NoLSAF admin security code is ${code}. It expires in 3 minutes. Do not share it.`);
  if (!delivery?.success) {
    return res.status(503).json({ error: "The verification code could not be delivered. Try again later." });
  }
  loaded.challenge.smsCodeHash = hashCode(code);
  loaded.challenge.smsExpiresAt = Date.now() + SMS_TTL_MS;
  loaded.challenge.smsSentAt = Date.now();
  await putChallenge(loaded.id, loaded.challenge);
  return res.json({ ok: true, maskedPhone: maskPhone(user.phone), expiresInSeconds: SMS_TTL_MS / 1000 });
});

adminMfaRouter.post("/admin-mfa/bootstrap/verify", limitOtpVerify, async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  const code = String(req.body?.code || "").trim();
  const expected = loaded.challenge.smsCodeHash;
  const valid = /^\d{6}$/.test(code) && Boolean(
    expected &&
    loaded.challenge.smsExpiresAt &&
    loaded.challenge.smsExpiresAt > Date.now() &&
    crypto.timingSafeEqual(Buffer.from(hashCode(code), "hex"), Buffer.from(expected, "hex")),
  );
  if (!valid) {
    if (await recordFailure(loaded.id, loaded.challenge, res)) return;
    return res.status(400).json({ error: "Security code is invalid or expired.", code: "ADMIN_MFA_INVALID" });
  }
  loaded.challenge.bootstrapVerified = true;
  loaded.challenge.smsCodeHash = undefined;
  loaded.challenge.smsExpiresAt = undefined;
  loaded.challenge.failures = 0;
  await putChallenge(loaded.id, loaded.challenge);
  return res.json({ ok: true, enrollmentRequired: true });
});

adminMfaRouter.post("/admin-mfa/passkey/register/options", async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  if (!loaded.challenge.bootstrapVerified || loaded.challenge.passkeyCount > 0) {
    return res.status(403).json({ error: "Complete bootstrap verification first.", code: "ADMIN_MFA_BOOTSTRAP_REQUIRED" });
  }
  const user = await prisma.user.findUnique({ where: { id: loaded.challenge.userId }, select: { id: true, email: true, name: true } });
  if (!user) return res.status(404).json({ error: "Administrator not found." });
  const { rpID } = getWebAuthnRp();
  const options = await generateRegistrationOptions({
    rpName: process.env.APP_NAME || "NoLSAF",
    rpID,
    userID: String(user.id),
    userName: user.email || `admin-${user.id}`,
    userDisplayName: user.name || user.email || `Admin ${user.id}`,
    timeout: 60_000,
    attestationType: "none",
    authenticatorSelection: { userVerification: "required", residentKey: "required" },
  } as any);
  loaded.challenge.registrationChallenge = options.challenge;
  await putChallenge(loaded.id, loaded.challenge);
  return res.json({ publicKey: options });
});

adminMfaRouter.post("/admin-mfa/passkey/register/verify", async (req, res) => {
  const loaded = await loadRequestChallenge(req, res);
  if (!loaded) return;
  if (!loaded.challenge.bootstrapVerified || !loaded.challenge.registrationChallenge) {
    return res.status(403).json({ error: "Complete bootstrap verification first.", code: "ADMIN_MFA_BOOTSTRAP_REQUIRED" });
  }
  try {
    const { rpID, expectedOrigins } = getWebAuthnRp();
    const verification = await verifyRegistrationResponse({
      response: req.body?.response,
      expectedChallenge: loaded.challenge.registrationChallenge,
      expectedOrigin: expectedOrigins,
      expectedRPID: rpID,
      requireUserVerification: true,
    } as any);
    const info = verification.registrationInfo;
    if (!verification.verified || !info?.credentialID || !info.credentialPublicKey) throw new Error("not verified");
    const credentialId = bufferToBase64Url(Buffer.from(info.credentialID));
    const publicKey = bufferToBase64Url(Buffer.from(info.credentialPublicKey));
    await prisma.passkey.create({
      data: {
        userId: loaded.challenge.userId,
        credentialId,
        publicKey,
        signCount: typeof info.counter === "number" ? info.counter : 0,
        transports: Array.isArray(req.body?.response?.response?.transports) ? req.body.response.response.transports : undefined,
      },
    });
    loaded.challenge.passkeyCount = 1;
    await putChallenge(loaded.id, loaded.challenge);
    await completeAdminLogin(req, res, loaded.id, "passkey");
  } catch {
    if (await recordFailure(loaded.id, loaded.challenge, res)) return;
    return res.status(400).json({ error: "Passkey registration failed.", code: "ADMIN_MFA_INVALID" });
  }
});

adminMfaRouter.post("/admin-mfa/cancel", async (req, res) => {
  const id = challengeIdFrom(req);
  if (id) await removeChallenge(id);
  clearChallengeCookie(res);
  return res.json({ ok: true });
});

export default adminMfaRouter;
