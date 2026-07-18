// apps/api/src/middleware/csrf.ts
import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { getRedis } from "../lib/redis.js";

const CSRF_TTL_SEC = 60 * 60; // 1 hour
const AUTH_COOKIE_NAMES = new Set(["nolsaf_token", "__Host-nolsaf_token", "token", "__Host-token"]);

// ---------------------------------------------------------------------------
// In-memory fallback (used when Redis is unavailable, e.g. local dev without Redis)
// ---------------------------------------------------------------------------
const tokenStore = new Map<string, { token: string; expiresAt: number }>();

// Prune expired entries every 5 minutes to avoid unbounded memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenStore.entries()) {
    if (value.expiresAt < now) tokenStore.delete(key);
  }
}, 5 * 60 * 1000);

function memSet(sessionId: string, token: string): void {
  tokenStore.set(sessionId, { token, expiresAt: Date.now() + CSRF_TTL_SEC * 1000 });
}

function memGet(sessionId: string): string | null {
  const stored = tokenStore.get(sessionId);
  if (!stored || stored.expiresAt < Date.now()) return null;
  return stored.token;
}

// ---------------------------------------------------------------------------
// Redis-backed store with in-memory fallback
// ---------------------------------------------------------------------------
const REDIS_PREFIX = "csrf:";

async function storeToken(sessionId: string, token: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(`${REDIS_PREFIX}${sessionId}`, token, "EX", CSRF_TTL_SEC);
      return;
    } catch {
      // Redis unavailable — fall through to in-memory
    }
  }
  memSet(sessionId, token);
}

async function retrieveToken(sessionId: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    try {
      return await redis.get(`${REDIS_PREFIX}${sessionId}`);
    } catch {
      // Redis unavailable — fall through to in-memory
    }
  }
  return memGet(sessionId);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generate a CSRF token for a session and persist it.
 */
export async function generateCsrfToken(sessionId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  await storeToken(sessionId, token);
  return token;
}

async function getOrCreateCsrfToken(sessionId: string): Promise<string> {
  const existing = await retrieveToken(sessionId);
  if (existing) return existing;
  return generateCsrfToken(sessionId);
}

/**
 * Verify a submitted CSRF token against the stored value using
 * constant-time comparison to resist timing attacks.
 */
export async function verifyCsrfToken(sessionId: string, token: string): Promise<boolean> {
  const stored = await retrieveToken(sessionId);
  if (!stored) return false;
  try {
    const a = Buffer.from(stored);
    const b = Buffer.from(token);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Get session ID from request.
 *
 * Priority:
 *  1. JWT cookie (nolsaf_token / token) — ties the CSRF token to the
 *     authenticated session. A new JWT is issued on every login, so each
 *     session automatically gets a fresh CSRF binding.
 *  2. IP + User-Agent fallback — weaker, but acceptable for unauthenticated
 *     state-changing endpoints (e.g. public plan-request submissions).
 */
function getSessionId(req: Request): string {
  const cookieHeader = req.headers.cookie || "";
  // Parse cookies manually — avoids a cookie-parser dependency.
  // Match auth middleware precedence exactly. Browsers can temporarily carry
  // legacy and __Host cookies together; header order must not select a
  // different JWT for CSRF than the one authentication selected.
  const cookies = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .reduce<Record<string, string>>((result, part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return result;
      const name = part.slice(0, eqIdx).trim();
      if (AUTH_COOKIE_NAMES.has(name)) result[name] = part.slice(eqIdx + 1).trim();
      return result;
    }, {});
  const jwt = cookies["nolsaf_token"] || cookies["__Host-nolsaf_token"] || cookies["token"] || cookies["__Host-token"] || null;

  if (jwt) {
    // Hash the token so the raw credential never appears in any store key.
    return crypto.createHash("sha256").update(jwt).digest("hex");
  }

  // Unauthenticated fallback.
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const ua = req.get("user-agent") || "unknown";
  return crypto.createHash("sha256").update(`${ip}:${ua}`).digest("hex");
}

function hasBearerAuth(req: Request): boolean {
  const auth = String(req.headers.authorization || "");
  return auth.startsWith("Bearer ");
}

function hasAuthCookie(req: Request): boolean {
  const cookieHeader = req.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .some((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx === -1) return false;
      return AUTH_COOKIE_NAMES.has(part.slice(0, eqIdx).trim());
    });
}

function parseOrigin(value: string): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(): string[] {
  return Array.from(
    new Set(
      [
        process.env.WEB_ORIGIN,
        process.env.APP_ORIGIN,
        ...(process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()),
      ].filter(Boolean) as string[]
    )
  );
}

function isTrustedOrigin(req: Request): boolean {
  const origin = parseOrigin(String(req.get("origin") || "")) || parseOrigin(String(req.get("referer") || ""));
  if (!origin) return false;

  const host = String(req.get("host") || "").trim();
  const sameHost = origin === `https://${host}` || origin === `http://${host}`;
  return sameHost || getAllowedOrigins().includes(origin);
}

// Pre-authentication endpoints: the user has no established session yet.
// A stale auth cookie from a previous session may still be present in the
// browser (especially on mobile after logout), causing hasAuthCookie() to
// return true — which would incorrectly trigger CSRF enforcement on login.
// These endpoints are already protected by rate-limiting; CSRF does not apply.
const PRE_AUTH_PATHS = new Set([
  "/api/auth/send-otp",
  "/api/auth/verify-otp",
  "/api/auth/login-password",
  "/api/auth/login-otp",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/register",
  "/api/auth/passkeys/options",
  "/api/auth/passkeys/verify",
]);

/**
 * CSRF protection middleware for state-changing operations
 * Only applies to POST, PUT, DELETE, PATCH methods
 */
export async function csrfProtection(req: Request, res: Response, next: NextFunction) {
  // Skip CSRF for GET, HEAD, OPTIONS
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    return next();
  }

  // Skip CSRF for webhooks (they use signature verification)
  if (req.path.startsWith("/webhooks/")) {
    return next();
  }

  // Skip CSRF for pre-authentication endpoints — stale cookies from a prior
  // session must not block login on mobile browsers.
  // Apply origin validation instead: if the browser sent an Origin header it
  // must come from an allowed domain (same pattern as adminOriginGuard).
  // Only enforced when at least one allowed origin env var is configured —
  // fails-open otherwise so the check is never silently wrong.
  if (PRE_AUTH_PATHS.has(req.path)) {
    const origin = req.get("origin");
    if (origin) {
      const allowedOrigins = [
        process.env.WEB_ORIGIN,
        process.env.APP_ORIGIN,
        ...(process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()),
      ].filter(Boolean) as string[];
      if (allowedOrigins.length > 0) {
        const isAllowed =
          allowedOrigins.some((o) => o === origin) ||
          origin === `https://${req.get("host")}` ||
          origin === `http://${req.get("host")}`;
        if (!isAllowed) {
          return res.status(403).json({ error: "Forbidden origin" });
        }
      }
    }
    return next();
  }

  // Bearer-token clients do not rely on ambient browser cookies.
  if (hasBearerAuth(req)) {
    return next();
  }

  // Public unauthenticated mutations are protected by validation/rate limits, not CSRF.
  if (!hasAuthCookie(req)) {
    return next();
  }

  const sessionId = getSessionId(req);
  const token = req.headers["x-csrf-token"] as string;

  if (token) {
    if (!(await verifyCsrfToken(sessionId, token))) {
      return res.status(403).json({
        error: "Invalid CSRF token",
        message: "CSRF token verification failed",
      });
    }
    return next();
  }

  const secFetchSite = String(req.get("sec-fetch-site") || "").toLowerCase();
  const explicitlyCrossSite = secFetchSite === "cross-site";
  const hasOriginHeaders = Boolean(req.get("origin") || req.get("referer"));

  if (explicitlyCrossSite || (hasOriginHeaders && !isTrustedOrigin(req))) {
    return res.status(403).json({
      error: "CSRF token missing",
      message: "Cross-site cookie-auth requests must include X-CSRF-Token.",
    });
  }

  next();
}

/**
 * Middleware to add CSRF token to response headers
 * Call this on GET requests to provide token to frontend
 */
export async function csrfTokenHeader(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET") {
    const sessionId = getSessionId(req);
    const token = await getOrCreateCsrfToken(sessionId);
    res.setHeader("X-CSRF-Token", token);
  }
  next();
}

