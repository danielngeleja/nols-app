import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import { prisma } from "@nolsaf/prisma";
import { backupCodeCandidates, verifyTotp } from "../lib/totp.js";
import { decrypt, verifyCode } from "../lib/crypto.js";
import { getRedis } from "../lib/redis.js";
import { audit } from "../lib/audit.js";
import { signUserJwt, setAuthCookie } from "../lib/sessionManager.js";
import { accountMfaBinding, requiresAccountTotp } from "../lib/accountMfaPolicy.js";
import { limitOtpVerify } from "../middleware/rateLimit.js";

const TTL = 300_000;
const PREFIX = "auth:account-mfa:";
type Challenge = { userId: number; binding: string; expiresAt: number; attempts: number };
const local = new Map<string, Challenge>();
const usedCodes = new Map<string, number>();
const userAttempts = new Map<number, { count: number; expiresAt: number }>();
function redisStore() {
  const redis = getRedis();
  if (!redis && process.env.NODE_ENV === "production") throw new Error("MFA store unavailable");
  return redis;
}
function identityBinding(user: any): string {
  return crypto.createHash("sha256").update(JSON.stringify([
    user.id, user.role, user.email, user.phone, user.passwordHash, user.tokensValidAfter,
    user.twoFactorEnabled, user.twoFactorMethod, user.totpSecretEnc,
  ])).digest("hex");
}

// Attempts and consumption are atomic across API workers. Redis failure never
// falls back to a separate store in production and cannot mint a session.
async function attempt(id: string): Promise<Challenge | null> {
  const redis = redisStore();
  if (redis) {
    const raw = await redis.eval(`
      local raw = redis.call('GET', KEYS[1])
      if not raw then return nil end
      local v = cjson.decode(raw)
      local ttl = redis.call('PTTL', KEYS[1])
      if v.attempts >= 5 or ttl <= 0 then redis.call('DEL', KEYS[1]); return nil end
      v.attempts = v.attempts + 1
      local updated = cjson.encode(v)
      redis.call('SET', KEYS[1], updated, 'PX', ttl)
      return updated
    `, 1, PREFIX + id);
    return raw ? JSON.parse(String(raw)) : null;
  }
  const state = local.get(id);
  if (!state || state.expiresAt <= Date.now() || state.attempts >= 5) { local.delete(id); return null; }
  state.attempts++;
  return { ...state };
}
async function consume(id: string): Promise<boolean> {
  const redis = redisStore();
  if (redis) return Number(await redis.del(PREFIX + id)) === 1;
  return local.delete(id);
}
async function allowUserAttempt(userId: number): Promise<boolean> {
  const redis = redisStore();
  if (redis) {
    const count = await redis.eval(`
      local count = redis.call('INCR', KEYS[1])
      if count == 1 then redis.call('EXPIRE', KEYS[1], 900) end
      return count
    `, 1, PREFIX + "attempts:" + userId);
    return Number(count) <= 10;
  }
  for (const [id, entry] of userAttempts) if (entry.expiresAt <= Date.now()) userAttempts.delete(id);
  const entry = userAttempts.get(userId) || { count: 0, expiresAt: Date.now() + 900_000 };
  entry.count++;
  userAttempts.set(userId, entry);
  return entry.count <= 10;
}
async function claimTotp(user: any, code: string): Promise<boolean> {
  const key = PREFIX + "used:" + crypto.createHash("sha256")
    .update(`${user.id}:${accountMfaBinding(user)}:${code}`).digest("hex");
  const redis = redisStore();
  if (redis) return (await redis.set(key, "1", "EX", 120, "NX")) === "OK";
  for (const [k, expiry] of usedCodes) if (expiry <= Date.now()) usedCodes.delete(k);
  if (usedCodes.has(key)) return false;
  usedCodes.set(key, Date.now() + 120_000);
  return true;
}

export async function beginAccountMfaChallenge(_req: Request, res: Response, userId: number): Promise<Response> {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !requiresAccountTotp(user) || !user.totpSecretEnc || user.isDisabled || user.suspendedAt) {
      return res.status(403).json({ code: "MFA_UNAVAILABLE", message: "Account verification is unavailable. Contact support." });
    }
    const challengeId = crypto.randomBytes(32).toString("hex");
    const state: Challenge = { userId, binding: identityBinding(user), expiresAt: Date.now() + TTL, attempts: 0 };
    const redis = redisStore();
    if (redis) await redis.set(PREFIX + challengeId, JSON.stringify(state), "PX", TTL);
    else {
      for (const [id, value] of local) if (value.expiresAt <= Date.now()) local.delete(id);
      local.set(challengeId, state);
    }
    // This opaque challenge is not a JWT and cannot authenticate API requests.
    return res.status(202).json({ ok: false, mfaRequired: true, code: "MFA_REQUIRED",
      method: "TOTP", challengeId, expiresInSeconds: TTL / 1000 });
  } catch {
    return res.status(503).json({ code: "MFA_UNAVAILABLE", message: "Verification is temporarily unavailable. Please try again." });
  }
}

export const accountMfaRouter = Router();
accountMfaRouter.post("/mfa/verify", limitOtpVerify, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const { challengeId, code, useBackupCode } = req.body || {};
  if (typeof challengeId !== "string" || !/^[a-f0-9]{64}$/.test(challengeId)) {
    return res.status(401).json({ code: "MFA_EXPIRED", message: "Sign in again to verify your account." });
  }
  try {
    const state = await attempt(challengeId);
    if (!state || state.expiresAt <= Date.now()) return res.status(401).json({ code: "MFA_EXPIRED", message: "Verification expired or too many attempts. Sign in again." });
    if (!await allowUserAttempt(state.userId)) {
      return res.status(429).json({ code: "MFA_RATE_LIMITED", message: "Too many verification attempts. Wait 15 minutes before trying again." });
    }
    const user = await prisma.user.findUnique({ where: { id: state.userId } });
    if (!user || user.suspendedAt || user.isDisabled || !requiresAccountTotp(user)
      || identityBinding(user) !== state.binding
      || (user.role === "AGENT" && (await prisma.agentProfile.findUnique({ where: { userId: user.id } }))?.status !== "ACTIVE")) {
      await consume(challengeId);
      return res.status(403).json({ code: "MFA_ACCOUNT_CHANGED", message: "Your account changed. Please sign in again." });
    }
    const suppliedCode = typeof code === "string" ? code.trim() : "";
    const backup = useBackupCode === true;
    const hashes = Array.isArray(user.backupCodesHash) ? user.backupCodesHash.filter((h): h is string => typeof h === "string") : [];
    let matchedHash: string | undefined;
    let valid = false;
    if (backup && suppliedCode.length >= 6 && suppliedCode.length <= 128) {
      const candidates = backupCodeCandidates(suppliedCode);
      outer: for (const hash of hashes) for (const candidate of candidates) if (await verifyCode(hash, candidate)) { matchedHash = hash; break outer; }
      valid = Boolean(matchedHash);
    } else if (!backup && /^\d{6}$/.test(suppliedCode) && user.totpSecretEnc) {
      try { valid = verifyTotp(suppliedCode, decrypt(user.totpSecretEnc, { log: false })); }
      catch { valid = false; }
    }
    if (!valid) return res.status(400).json({ code: "MFA_INVALID", message: "The verification code is invalid." });
    // Consume before issuing credentials so concurrent valid requests have one winner.
    if (state.expiresAt <= Date.now() || !await consume(challengeId)) return res.status(401).json({ code: "MFA_EXPIRED", message: "Sign in again to verify your account." });
    if (backup) {
      const changed = await prisma.user.updateMany({
        where: { id: user.id, backupCodesHash: { equals: hashes }, totpSecretEnc: user.totpSecretEnc, twoFactorEnabled: true },
        data: { backupCodesHash: hashes.filter((h) => h !== matchedHash) },
      });
      if (changed.count !== 1) return res.status(400).json({ code: "MFA_INVALID", message: "This backup code is no longer available." });
    } else if (!await claimTotp(user, suppliedCode)) {
      return res.status(400).json({ code: "MFA_REPLAY", message: "Wait for a new authenticator code, then sign in again." });
    }
    // Recheck credential changes after asynchronous cryptographic verification.
    const fresh = await prisma.user.findUnique({ where: { id: user.id } });
    if (!fresh || fresh.suspendedAt || fresh.isDisabled || identityBinding(fresh) !== state.binding) {
      return res.status(403).json({ code: "MFA_ACCOUNT_CHANGED", message: "Your account changed. Please sign in again." });
    }
    const method = backup ? "backup_code" : "totp";
    const token = await signUserJwt({ id: fresh.id, role: fresh.role, email: fresh.email },
      { accountMfa: { method, binding: accountMfaBinding(fresh) } });
    await setAuthCookie(res, token, fresh.role);
    (req as any).user = fresh;
    await audit(req, "USER_LOGIN", `user:${fresh.id}`, null, { success: true, mfa: true, loginMethod: method });
    return res.json({ ok: true, token, user: { id: fresh.id, role: fresh.role, email: fresh.email } });
  } catch {
    return res.status(503).json({ code: "MFA_UNAVAILABLE", message: "Verification is temporarily unavailable. Please sign in again." });
  }
});
