import { getMaxLoginAttempts, getAccountLockoutDurationMinutes, shouldLogFailedLoginAttempts } from './securitySettings.js';
import { getRedis } from './redis.js';
import { raiseSecurityAlert } from './securityAlerts.js';

// Failed attempts from one address within an hour that raise an admin alert.
const IP_BURST_ALERT_THRESHOLD = 20;

// Redis key prefixes
const REDIS_ATTEMPT_PREFIX = 'login:attempt:';
const REDIS_LOCK_PREFIX    = 'login:lock:';
const REDIS_IP_PREFIX      = 'login:ip:';

// ─── In-memory fallback (used when Redis is unavailable) ─────────────────────
interface EmailAttempt { count: number; lockedUntil: number | null; lastAttempt: number; }
interface IpAttempt    { count: number; lastAttempt: number; }
const memEmail = new Map<string, EmailAttempt>();
const memIp    = new Map<string, IpAttempt>();
setInterval(() => {
  const now = Date.now();
  const STALE = 30 * 60 * 1000;
  for (const [k, v] of memEmail.entries()) {
    if ((v.lockedUntil && v.lockedUntil < now) || (!v.lockedUntil && now - v.lastAttempt > STALE))
      memEmail.delete(k);
  }
  for (const [k, v] of memIp.entries()) {
    if (now - v.lastAttempt > 60 * 60 * 1000) memIp.delete(k);
  }
}, 5 * 60 * 1000);

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function redisAvailable(): Promise<boolean> {
  try {
    const r = getRedis();
    if (!r) return false;
    await r.ping();
    return true;
  } catch { return false; }
}

/**
 * Check if an email is locked out
 */
export async function isEmailLocked(email: string): Promise<{ locked: boolean; lockedUntil: number | null }> {
  const key = email.toLowerCase();
  try {
    const r = getRedis();
    if (r && await redisAvailable()) {
      const ttlMs = await r.pttl(`${REDIS_LOCK_PREFIX}${key}`);
      if (ttlMs > 0) {
        return { locked: true, lockedUntil: Date.now() + ttlMs };
      }
      return { locked: false, lockedUntil: null };
    }
  } catch (err) {
    console.error('[isEmailLocked] Redis error, using fallback:', err);
  }

  // Fallback
  const attempt = memEmail.get(key);
  if (!attempt) return { locked: false, lockedUntil: null };
  const now = Date.now();
  if (attempt.lockedUntil && attempt.lockedUntil > now) return { locked: true, lockedUntil: attempt.lockedUntil };
  if (attempt.lockedUntil) memEmail.delete(key);
  return { locked: false, lockedUntil: null };
}

/**
 * Record a failed login attempt
 */
export async function recordFailedAttempt(email: string, ip: string): Promise<void> {
  const key = email.toLowerCase();
  try {
    const maxAttempts = await getMaxLoginAttempts();
    const lockoutSec  = (await getAccountLockoutDurationMinutes()) * 60;
    const shouldLog   = await shouldLogFailedLoginAttempts();
    const windowSec   = lockoutSec || 300; // fallback 5 min window

    const r = getRedis();
    if (r && await redisAvailable()) {
      const attemptKey = `${REDIS_ATTEMPT_PREFIX}${key}`;
      const lockKey    = `${REDIS_LOCK_PREFIX}${key}`;
      const ipKey      = `${REDIS_IP_PREFIX}${ip}`;

      // Atomic increment; set expiry on first write
      const count = await r.incr(attemptKey);
      if (count === 1) await r.expire(attemptKey, windowSec);

      if (shouldLog) {
        console.warn(`[SECURITY] Failed login: ${email} from ${ip} (attempt ${count}/${maxAttempts})`);
      }

      if (count >= maxAttempts) {
        await r.set(lockKey, '1', 'EX', lockoutSec || 300);
        await r.del(attemptKey); // reset counter after locking
        if (shouldLog) {
          console.warn(`[SECURITY] Account locked: ${email} for ${lockoutSec}s after ${count} failed attempts`);
        }
        void raiseSecurityAlert('security_account_locked', key, { identifier: email, ip, attempts: count, lockoutMinutes: Math.round((lockoutSec || 300) / 60) });
      }

      // IP tracking (1 h window); crossing the burst threshold alerts once
      const ipCount = await r.incr(ipKey);
      await r.expire(ipKey, 3600);
      if (ipCount === IP_BURST_ALERT_THRESHOLD) {
        void raiseSecurityAlert('security_ip_burst', ip, { ip, attempts: ipCount });
      }
      return;
    }
  } catch (err) {
    console.error('[recordFailedAttempt] Redis error, using fallback:', err);
  }

  // Fallback: in-memory
  try {
    const maxAttempts    = await getMaxLoginAttempts();
    const lockoutMs      = (await getAccountLockoutDurationMinutes()) * 60 * 1000;
    const shouldLog      = await shouldLogFailedLoginAttempts();
    const now            = Date.now();
    const emailAttempt   = memEmail.get(key) || { count: 0, lockedUntil: null, lastAttempt: now };
    emailAttempt.count  += 1;
    emailAttempt.lastAttempt = now;
    if (emailAttempt.count >= maxAttempts) {
      emailAttempt.lockedUntil = now + lockoutMs;
      if (shouldLog) console.warn(`[SECURITY] Account locked (mem): ${email} until ${new Date(emailAttempt.lockedUntil).toISOString()}`);
      void raiseSecurityAlert('security_account_locked', key, { identifier: email, ip, attempts: emailAttempt.count, lockoutMinutes: Math.round(lockoutMs / 60000) });
    }
    memEmail.set(key, emailAttempt);
    const ipAttempt = memIp.get(ip) || { count: 0, lastAttempt: now };
    ipAttempt.count += 1;
    ipAttempt.lastAttempt = now;
    memIp.set(ip, ipAttempt);
    if (ipAttempt.count === IP_BURST_ALERT_THRESHOLD) {
      void raiseSecurityAlert('security_ip_burst', ip, { ip, attempts: ipAttempt.count });
    }
    if (shouldLog) console.warn(`[SECURITY] Failed login (mem): ${email} from ${ip} (attempt ${emailAttempt.count}/${maxAttempts})`);
  } catch (err) {
    console.error('[recordFailedAttempt] Fallback error:', err);
  }
}

/**
 * Clear failed attempts for an email (on successful login)
 */
export async function clearFailedAttempts(email: string): Promise<void> {
  const key = email.toLowerCase();
  try {
    const r = getRedis();
    if (r && await redisAvailable()) {
      await r.del(`${REDIS_ATTEMPT_PREFIX}${key}`, `${REDIS_LOCK_PREFIX}${key}`);
      return;
    }
  } catch (err) {
    console.error('[clearFailedAttempts] Redis error:', err);
  }
  memEmail.delete(key);
}

/**
 * Get remaining attempts before lockout
 */
export async function getRemainingAttempts(email: string): Promise<number> {
  const key = email.toLowerCase();
  try {
    const maxAttempts = await getMaxLoginAttempts();
    const r = getRedis();
    if (r && await redisAvailable()) {
      const raw = await r.get(`${REDIS_ATTEMPT_PREFIX}${key}`);
      return Math.max(0, maxAttempts - (parseInt(raw ?? '0', 10) || 0));
    }
    const attempt = memEmail.get(key);
    return Math.max(0, maxAttempts - (attempt?.count ?? 0));
  } catch (err) {
    console.error('[getRemainingAttempts] Error:', err);
    return 5;
  }
}

/**
 * Get lockout status and time remaining
 */
export async function getLockoutStatus(email: string): Promise<{ locked: boolean; timeRemaining: number | null }> {
  const { locked, lockedUntil } = await isEmailLocked(email);
  if (!locked) return { locked: false, timeRemaining: null };
  return { locked: true, timeRemaining: lockedUntil ? lockedUntil - Date.now() : null };
}

