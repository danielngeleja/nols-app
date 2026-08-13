import crypto from "node:crypto";
import { getRedis } from "./redis.js";
import type { AuthedUser } from "../middleware/auth.js";

type CachedSession = {
  user: AuthedUser;
  expiresAt: number;
};

const CACHE_PREFIX = "auth:session:";
const USER_INDEX_PREFIX = "auth:session:user:";

function getTtlSeconds(): number {
  const raw = Number(process.env.AUTH_SESSION_CACHE_TTL_SECONDS ?? 45);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(60, Math.max(5, Math.floor(raw)));
}

function tokenCacheKey(token: string): string {
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return `${CACHE_PREFIX}${digest}`;
}

function userIndexKey(userId: number): string {
  return `${USER_INDEX_PREFIX}${userId}`;
}

export async function getCachedAuthSession(token: string): Promise<AuthedUser | null> {
  const ttlSeconds = getTtlSeconds();
  if (ttlSeconds <= 0) return null;

  const key = tokenCacheKey(token);
  try {
    const redis = getRedis();
    if (redis) {
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw) as CachedSession;
        if (parsed?.user?.id && parsed.expiresAt > Date.now()) {
          return parsed.user;
        }
      }
      return null;
    }
  } catch {
    // Fail open to the authoritative database authentication path, never to a
    // process-local identity cache that another instance cannot invalidate.
  }
  return null;
}

export async function cacheAuthSession(token: string, user: AuthedUser, tokenExpSec?: number): Promise<void> {
  const baseTtlSeconds = getTtlSeconds();
  if (baseTtlSeconds <= 0) return;

  const now = Date.now();
  const tokenRemainingSeconds =
    typeof tokenExpSec === "number" && Number.isFinite(tokenExpSec)
      ? Math.max(0, Math.floor(tokenExpSec - now / 1000))
      : baseTtlSeconds;
  const ttlSeconds = Math.min(baseTtlSeconds, tokenRemainingSeconds);
  if (ttlSeconds <= 0) return;

  const key = tokenCacheKey(token);
  const expiresAt = now + ttlSeconds * 1000;
  const payload: CachedSession = { user, expiresAt };

  try {
    const redis = getRedis();
    if (redis) {
      const indexKey = userIndexKey(user.id);
      await redis
        .multi()
        .set(key, JSON.stringify(payload), "EX", ttlSeconds)
        .sadd(indexKey, key)
        .expire(indexKey, ttlSeconds + 60)
        .exec();
      return;
    }
  } catch {
    // Authentication continues through the authoritative database path.
  }
}

export async function invalidateAuthSessionCacheForToken(token: string): Promise<void> {
  const key = tokenCacheKey(token);
  try {
    const redis = getRedis();
    if (redis) await redis.del(key);
  } catch {
    // best effort
  }
}

export async function invalidateAuthSessionCacheForUser(userId: number): Promise<void> {
  try {
    const redis = getRedis();
    if (redis) {
      const indexKey = userIndexKey(userId);
      const keys = await redis.smembers(indexKey);
      if (keys.length > 0) await redis.del(...keys);
      await redis.del(indexKey);
    }
  } catch {
    // best effort
  }
}

