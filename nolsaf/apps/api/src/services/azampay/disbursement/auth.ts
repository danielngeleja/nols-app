/**
 * AzamPay Disbursement — Bearer Token Manager
 *
 * Disbursement keeps a separate token cache from checkout. AzamPay confirmed
 * that NoLSAF's live disbursement account reuses the checkout app credentials,
 * so disbursement-specific env vars remain optional overrides and otherwise
 * fall back to the established checkout values.
 *
 * SECURITY: env var VALUES are never logged, only key names when missing.
 * The raw AzamPay response body is never forwarded to callers.
 */

import { getRedis } from "../../../lib/redis.js";
import { AzamPayDisburseConfigurationError } from "./errors.js";

const REDIS_KEY = "azp:disburse:token";
const CLOCK_SKEW_SEC = 60;
const FETCH_TIMEOUT_MS = 10_000;

interface TokenCache {
  token: string;
  expiresAtMs: number;
}

let inMemCache: TokenCache | null = null;
let inflightRefresh: Promise<string> | null = null;

function parseExpiry(expire: string | number | undefined | null): number {
  if (!expire) return Date.now() + 50 * 60 * 1000;
  if (typeof expire === "number") {
    return expire < 1e12 ? expire * 1000 : expire;
  }
  const ms = Date.parse(expire);
  return Number.isFinite(ms) && ms > 0 ? ms : Date.now() + 50 * 60 * 1000;
}

async function fetchFreshToken(): Promise<TokenCache> {
  const authUrl = (
    process.env.AZAMPAY_DISBURSE_AUTH_URL ||
    process.env.AZAMPAY_AUTH_URL ||
    "https://authenticator-sandbox.azampay.co.tz"
  ).replace(/\/$/, "");
  const appName = process.env.AZAMPAY_DISBURSE_APP_NAME || process.env.AZAMPAY_APP_NAME || "NoLSAF";
  const clientId = process.env.AZAMPAY_DISBURSE_CLIENT_ID || process.env.AZAMPAY_CLIENT_ID || "";
  const clientSecret = process.env.AZAMPAY_DISBURSE_CLIENT_SECRET || process.env.AZAMPAY_CLIENT_SECRET || "";

  if (!clientId || !clientSecret) {
    const missing = [
      !clientId && "AZAMPAY_DISBURSE_CLIENT_ID or AZAMPAY_CLIENT_ID",
      !clientSecret && "AZAMPAY_DISBURSE_CLIENT_SECRET or AZAMPAY_CLIENT_SECRET",
    ].filter(Boolean);
    throw new AzamPayDisburseConfigurationError({
      operation: "AUTH",
      missingKeys: missing as string[],
      message: `AzamPay disbursement auth: missing required env var(s): ${missing.join(", ")}`,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${authUrl}/AppRegistration/GenerateToken`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appName, clientId, clientSecret }),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    throw new Error(`AzamPay disbursement auth: network error reaching authenticator (${err?.name ?? "unknown"})`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    try {
      await res.text();
    } catch {
      /* discard, never forward raw body */
    }
    throw new Error(`AzamPay disbursement auth: authenticator returned HTTP ${res.status}`);
  }

  let body: any;
  try {
    body = await res.json();
  } catch {
    throw new Error("AzamPay disbursement auth: authenticator returned non-JSON body");
  }

  if (!body?.success || !body?.data?.accessToken) {
    throw new Error(`AzamPay disbursement auth: token fetch failed (success=${body?.success})`);
  }

  const token: string = body.data.accessToken;
  const expiresAtMs = parseExpiry(body.data.expire) - CLOCK_SKEW_SEC * 1000;

  return { token, expiresAtMs };
}

async function persistToRedis(cache: TokenCache): Promise<void> {
  try {
    const redis = getRedis();
    if (!redis) return;
    const ttlSec = Math.max(0, Math.floor((cache.expiresAtMs - Date.now()) / 1000));
    if (ttlSec < 10) return;
    await redis.set(REDIS_KEY, cache.token, "EX", ttlSec);
  } catch {
    /* Redis failure is non-fatal, in-process cache still valid */
  }
}

async function readFromRedis(): Promise<string | null> {
  try {
    const redis = getRedis();
    if (!redis) return null;
    return await redis.get(REDIS_KEY);
  } catch {
    return null;
  }
}

/** Returns a valid AzamPay disbursement Bearer token, fetching a new one only when necessary. */
export async function getAzamPayDisburseToken(): Promise<string> {
  const now = Date.now();

  if (inMemCache && inMemCache.expiresAtMs > now) {
    return inMemCache.token;
  }

  const redisToken = await readFromRedis();
  if (redisToken) {
    inMemCache = { token: redisToken, expiresAtMs: now + 55 * 60 * 1000 };
    return redisToken;
  }

  if (inflightRefresh) {
    return inflightRefresh;
  }

  inflightRefresh = (async () => {
    try {
      const cache = await fetchFreshToken();
      inMemCache = cache;
      await persistToRedis(cache);
      return cache.token;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

/** Force-invalidate the cached token, e.g. after a 401 from the disbursement API. */
export async function invalidateAzamPayDisburseToken(): Promise<void> {
  inMemCache = null;
  try {
    const redis = getRedis();
    if (redis) await redis.del(REDIS_KEY);
  } catch {
    /* non-fatal */
  }
}
