import crypto from "node:crypto";
import type { Request } from "express";
import { getRedis } from "./redis.js";

const FINANCE_GRANT_TTL_SECONDS = 15 * 60;
const REDIS_PREFIX = "admin:finance-grant:";
const fallbackGrants = new Map<string, number>();

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  return cookieHeader.split(";").reduce<Record<string, string>>((result, part) => {
    const index = part.indexOf("=");
    if (index < 0) return result;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) return result;
    try {
      result[name] = decodeURIComponent(value);
    } catch {
      result[name] = value;
    }
    return result;
  }, {});
}

function getAuthCredential(req: Request): string | null {
  const authorization = String(req.headers.authorization || "");
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);

  const cookies = parseCookies(req.headers.cookie);
  return (
    cookies.nolsaf_token ||
    cookies["__Host-nolsaf_token"] ||
    cookies.token ||
    cookies["__Host-token"] ||
    null
  );
}

function getGrantKey(req: Request): string | null {
  const credential = getAuthCredential(req);
  if (!credential) return null;
  const digest = crypto.createHash("sha256").update(credential).digest("hex");
  return `${REDIS_PREFIX}${digest}`;
}

function getSessionGrantUntil(req: Request): number | null {
  const value = Number((req as any).session?.financeOkUntil);
  return Number.isFinite(value) && value > Date.now() ? value : null;
}

function readFallback(key: string): number | null {
  const until = fallbackGrants.get(key);
  if (!until || until <= Date.now()) {
    fallbackGrants.delete(key);
    return null;
  }
  return until;
}

export async function getFinanceGrantUntil(req: Request): Promise<number | null> {
  const sessionUntil = getSessionGrantUntil(req);
  if (sessionUntil) return sessionUntil;

  const key = getGrantKey(req);
  if (!key) return null;

  const redis = getRedis();
  if (redis) {
    try {
      const stored = await redis.get(key);
      const until = Number(stored);
      if (Number.isFinite(until) && until > Date.now()) return until;
    } catch {
      // Redis is optional in local development; use the process-local fallback.
    }
  }
  return readFallback(key);
}

export async function setFinanceGrant(req: Request, until: number): Promise<void> {
  const session = (req as any).session;
  if (session) session.financeOkUntil = until;

  const key = getGrantKey(req);
  if (!key) return;

  const ttlSeconds = Math.max(1, Math.ceil((until - Date.now()) / 1000));
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, String(until), "EX", Math.min(FINANCE_GRANT_TTL_SECONDS, ttlSeconds));
      return;
    } catch {
      // Redis is optional in local development; use the process-local fallback.
    }
  }
  fallbackGrants.set(key, until);
}

export async function hasFinanceGrant(req: Request): Promise<boolean> {
  return (await getFinanceGrantUntil(req)) !== null;
}
