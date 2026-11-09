// apps/api/src/lib/otpAttempts.ts
//
// Guess budget for a single issued one-time code. Every attempt is counted
// atomically BEFORE the comparison (not only failures), so parallel guesses
// cannot slip past the cap. Callers destroy the code once the count passes
// OTP_MAX_ATTEMPTS, which makes a 6-digit code impossible to brute-force
// within its lifetime.

import { getRedis } from "./redis.js";

export const OTP_MAX_ATTEMPTS = 5;

const PREFIX = "otp-attempts:";
const fallback = new Map<string, { count: number; expiresAt: number }>();

/** Counts one attempt against `key` and returns the running total. */
export async function registerOtpAttempt(key: string, ttlSec: number): Promise<number> {
  const redisKey = PREFIX + key;
  try {
    const r = getRedis();
    if (r) {
      const results = await r.multi().incr(redisKey).expire(redisKey, Math.max(1, Math.ceil(ttlSec))).exec();
      const count = Number(results?.[0]?.[1]);
      if (Number.isFinite(count) && count > 0) return count;
    }
  } catch (err) {
    console.error("[otpAttempts] Redis error, using fallback:", err);
  }
  const now = Date.now();
  const current = fallback.get(redisKey);
  const next = current && current.expiresAt > now
    ? { count: current.count + 1, expiresAt: current.expiresAt }
    : { count: 1, expiresAt: now + Math.max(1, ttlSec) * 1000 };
  fallback.set(redisKey, next);
  return next.count;
}

/** Clears the budget, for example when a fresh code replaces the old one. */
export async function resetOtpAttempts(key: string): Promise<void> {
  const redisKey = PREFIX + key;
  fallback.delete(redisKey);
  try {
    const r = getRedis();
    if (r) await r.del(redisKey);
  } catch (err) {
    console.error("[otpAttempts] Redis reset error:", err);
  }
}
