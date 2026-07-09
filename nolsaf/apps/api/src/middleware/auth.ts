import { Request, Response, NextFunction } from 'express';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@nolsaf/prisma';
import { getRoleSessionMaxMinutes } from '../lib/securitySettings.js';
import { clearAuthCookie } from '../lib/sessionManager.js';
import { touchActiveUser } from '../lib/activePresence.js';
import { cacheAuthSession, getCachedAuthSession } from '../lib/authSessionCache.js';

export type Role = 'ADMIN' | 'OWNER' | 'USER' | 'DRIVER' | 'AGENT';

/** Shape of the payload our JWT tokens carry. */
interface JwtTokenPayload {
  sub: string | number;
  iat?: number;
  exp?: number;
  role?: string;
  /** Set on short-lived admin support tokens issued by the impersonate endpoints. */
  imp?: boolean;
}

function authError(code: "SESSION_EXPIRED" | "SESSION_REVOKED" | "ACCOUNT_SUSPENDED", message: string) {
  const e: any = new Error(message);
  e.code = code;
  return e;
}

export interface AuthedUser {
  id: number;
  role: Role;
  email?: string;
  name?: string;
  /** True when this session comes from an admin impersonation token. */
  imp?: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthedUser;
}

/**
 * Mark a response as personalized so it is never stored by a shared cache
 * (CDN, reverse proxy, load balancer) and replayed to a different user.
 *
 * This is the fix for cross-account data bleed: without `no-store`, a cache
 * in front of the API can serve one user's `/account/session` (their identity)
 * to another user. We call this at the single point where a request is
 * authenticated, so every authenticated response across the API is covered.
 */
function markPrivateNoStore(res: Response): void {
  res.set("Cache-Control", "private, no-store, max-age=0");
  // Even if a downstream cache ignores no-store, vary on the credential carriers
  // so a cached entry is never keyed across different sessions.
  res.set("Vary", "Cookie, Authorization");
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function getTokenFromRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) return authHeader.substring(7);
  const cookies = parseCookies(req.headers.cookie);
  // Support both cookie names for compatibility (web middleware uses `token`)
  return (
    cookies["nolsaf_token"] ||
    cookies["__Host-nolsaf_token"] ||
    cookies["token"] ||
    cookies["__Host-token"] ||
    null
  );
}

// Verify JWT token and extract user info
async function verifyToken(token: string): Promise<AuthedUser | null> {
  try {
    const secret =
      process.env.JWT_SECRET ||
      (process.env.NODE_ENV !== "production" ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret") : "");
    if (!secret) {
      // Production must fail closed if misconfigured
      console.error("JWT_SECRET not set in production; refusing auth");
      return null;
    }

    const decoded = jwt.verify(token, secret) as JwtTokenPayload;
    if (!decoded || decoded.sub == null) return null;

    const userId = Number(decoded.sub);
    const cached = await getCachedAuthSession(token);
    if (cached && cached.id === userId) {
      return cached;
    }

    // The common path is an active session. Fetch the session and user in one query
    // instead of querying user + session separately on every authenticated request.
    const activeSession = await (prisma.session as any).findFirst({
      where: { userId, revokedAt: null },
      select: {
        id: true,
        user: {
          select: { id: true, role: true, email: true, suspendedAt: true, tokensValidAfter: true },
        },
      },
    });

    let user = activeSession?.user ?? null;

    if (!activeSession) {
      const [dbUser, anySession] = await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, email: true, suspendedAt: true, tokensValidAfter: true },
        }),
        (prisma.session as any).findFirst({
          where: { userId },
          select: { id: true },
        }),
      ]);
      user = dbUser;
      if (anySession) {
        throw authError("SESSION_REVOKED", "Session revoked");
      }
    }

    if (!user) return null;

    // Check if account is suspended - suspended users cannot access their account.
    if (user.suspendedAt) {
      throw authError("ACCOUNT_SUSPENDED", "Account suspended");
    }

    // Map database role to Role type (handle case where role might be different format)
    // Check raw database value before casting to handle CUSTOMER -> USER mapping
    const rawRole = (user.role?.toUpperCase() || 'USER');
    const role: Role = rawRole === 'CUSTOMER' ? 'USER' : (rawRole as Role);

    // Enforce dynamic per-role session TTL based on token issuance time.
    // This ensures that if admin reduces TTL, old tokens are also forced out.
    // Use rawRole for TTL lookup so CUSTOMER maps to sessionMaxMinutesCustomer, not USER fallback.
    const issuedAtSec = typeof decoded.iat === 'number' ? decoded.iat : Number(decoded.iat);

    // Global revocation gate: reject any token issued before the user's
    // tokensValidAfter cutoff (bumped on password reset/change and "sign out
    // other devices"). Compared at second granularity so a token re-issued in
    // the same second as the cutoff is never falsely rejected.
    const tokensValidAfter = (user as any).tokensValidAfter as Date | string | null | undefined;
    if (tokensValidAfter && Number.isFinite(issuedAtSec)) {
      const validAfterSec = Math.floor(new Date(tokensValidAfter).getTime() / 1000);
      if (issuedAtSec < validAfterSec) {
        throw authError("SESSION_REVOKED", "Session revoked");
      }
    }

    if (Number.isFinite(issuedAtSec) && issuedAtSec > 0) {
      const maxMinutes = await getRoleSessionMaxMinutes(rawRole);
      const ageSec = Math.floor(Date.now() / 1000) - issuedAtSec;
      if (ageSec > maxMinutes * 60) {
        throw authError("SESSION_EXPIRED", "Session expired");
      }
    }
    
    const authedUser: AuthedUser = {
      id: user.id,
      role,
      email: user.email || undefined,
      ...(decoded.imp === true ? { imp: true } : {}),
    };
    await cacheAuthSession(token, authedUser, decoded.exp);
    return authedUser;
  } catch (err) {
    throw err;
  }
}

// Optional auth: if a valid token is present, attach req.user; otherwise continue.
// No DEV bypass, no 401.
export const maybeAuth: RequestHandler = async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const user = await verifyToken(token);
      if (user) {
        (req as AuthedRequest).user = user;
        markPrivateNoStore(res);
        try {
          touchActiveUser(user.id, user.role);
        } catch {}
      }
    } catch {
      // ignore in maybeAuth
    }
  }
  return next();
};

// Minimal auth stub: read role and user id from headers for now.
// In production, verify JWT in Authorization: Bearer <token>
// Basic auth that attaches a user from headers (dev-friendly)
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (token) {
    try {
      const user = await verifyToken(token);
      if (user) {
        (req as AuthedRequest).user = user;
        markPrivateNoStore(res);
        try {
          touchActiveUser(user.id, user.role);
        } catch {}
        return next();
      }
    } catch (err: any) {
      if (err?.code === 'SESSION_EXPIRED') {
        clearAuthCookie(res);
        return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
      }
      if (err?.code === 'SESSION_REVOKED') {
        clearAuthCookie(res);
        return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
      }
      if (err?.code === 'ACCOUNT_SUSPENDED') {
        return res.status(403).json({ error: "Account suspended", code: "ACCOUNT_SUSPENDED" });
      }
      // fallthrough to unauthorized logic
    }
  }

  return res.status(401).json({ error: "Unauthorized" });
};

// Role gate. If no role required, just ensure user exists.
export function requireRole(required?: Role) {
  const handler: RequestHandler = async (req, res, next) => {
    // Ensure req.user exists (supports Bearer or httpOnly cookie).
    if (!(req as AuthedRequest).user) {
      const token = getTokenFromRequest(req);
      if (token) {
        try {
          const verified = await verifyToken(token);
          if (verified) {
            (req as AuthedRequest).user = verified;
            try {
              touchActiveUser(verified.id, verified.role);
            } catch {}
          } else {
            // token verified but user not found/suspended etc
          }
        } catch (err: any) {
          if (err?.code === 'SESSION_EXPIRED') {
            clearAuthCookie(res);
            return res.status(401).json({ error: 'Session expired', code: 'SESSION_EXPIRED' });
          }
          if (err?.code === 'SESSION_REVOKED') {
            clearAuthCookie(res);
            return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
          }
          if (err?.code === 'ACCOUNT_SUSPENDED') {
            return res.status(403).json({ error: "Account suspended", code: "ACCOUNT_SUSPENDED" });
          }
        }
      }
    }

    // Production: strict — no user means no access.
    if (!(req as AuthedRequest).user) return res.status(401).json({ error: "Unauthorized" });

    if (required && (req as AuthedRequest).user!.role !== required) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // User is authenticated and authorized — never let a shared cache store this.
    markPrivateNoStore(res);
    return next();
  };

  return handler;
}

// Deny the request when the session comes from an admin impersonation token
// (the `imp` claim signed by the /impersonate endpoints). Use on endpoints
// that change credentials, contact info, payout details, or sessions so a
// support session can never take over or lock out the real account.
export const blockImpersonated: RequestHandler = (req, res, next) => {
  if ((req as AuthedRequest).user?.imp) {
    return res.status(403).json({
      error: "This action is not available during an admin support session",
      code: "IMPERSONATION_FORBIDDEN",
    });
  }
  return next();
};

export default requireRole;
