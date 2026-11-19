import { Request, Response, NextFunction } from 'express';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '@nolsaf/prisma';
import { getRoleSessionMaxMinutes, getSessionIdleMinutes } from '../lib/securitySettings.js';
import { clearAuthCookie } from '../lib/sessionManager.js';
import { touchActiveUser } from '../lib/activePresence.js';
import { accountMfaSessionAllowed } from '../lib/accountMfaPolicy.js';
import { supportImpersonatorActive } from '../lib/supportImpersonation.js';

export type Role = 'ADMIN' | 'OWNER' | 'USER' | 'DRIVER' | 'AGENT' | 'NRMS_AGENT';

/** Shape of the payload our JWT tokens carry. */
interface JwtTokenPayload {
  sub: string | number;
  iat?: number;
  exp?: number;
  role?: string;
  /** Server-side session UUID. Required on normal and impersonation auth JWTs. */
  sid?: string;
  /** Set on short-lived admin support tokens issued by the impersonate endpoints. */
  imp?: boolean;
  act?: number;
  /** Admin MFA method, or "passkey" for any role's passkey sign-in. */
  amr?: string;
  /** Account authenticator method on sessions that passed the code step. */
  mfa?: string;
  /** "owner_mfa_setup": a setup-only session (lib/ownerMfaPolicy.ts). */
  scope?: string;
}

function authError(code: "SESSION_EXPIRED" | "SESSION_REVOKED" | "ACCOUNT_SUSPENDED" | "ACCOUNT_DISABLED" | "ADMIN_MFA_REQUIRED" | "MFA_REQUIRED", message: string) {
  const e: any = new Error(message);
  e.code = code;
  return e;
}

export interface AuthedUser {
  id: number;
  role: Role;
  email?: string;
  name?: string;
  /** NRMS finance segregation: NONE, OPERATOR, or APPROVER. */
  nrmsFinanceRole?: string;
  /** True when this session comes from an admin impersonation token. */
  imp?: boolean;
  impersonatorId?: number;
  /** Exact revocable server-side session backing this token. */
  sessionId?: string;
  /** Signed in with a passkey or an authenticator app code (not SMS or password alone). */
  strongAuth?: boolean;
  /** Setup-only session: may only add a passkey or authenticator. */
  setupOnly?: boolean;
}

/**
 * Exactly what a setup-only session may call: read who it is, add a passkey or
 * authenticator, check the policy, and sign out. Everything else, reads
 * included, is refused, so a stolen SMS code cannot open the workspace.
 */
const OWNER_MFA_SETUP_ALLOWED = new Set([
  "GET /api/account/me",
  "GET /api/account/security/passkeys",
  "POST /api/account/security/passkeys",
  "POST /api/account/security/passkeys/verify",
  "POST /api/account/2fa/totp/setup",
  "POST /api/account/2fa/totp/verify",
  "GET /api/auth/owner-mfa/status",
  "GET /api/auth/impersonation/status",
  "GET /api/auth/logout",
  "POST /api/auth/logout",
]);

export function ownerMfaSetupAllows(method: string, path: string): boolean {
  const m = method.toUpperCase() === "HEAD" ? "GET" : method.toUpperCase();
  if (m === "OPTIONS") return true;
  const p = String(path || "").replace(/\/+$/, "") || "/";
  return OWNER_MFA_SETUP_ALLOWED.has(`${m} ${p}`);
}

/** Confine setup-only sessions before any router sees the request. */
export const ownerMfaSetupGuard: RequestHandler = async (req, res, next) => {
  const token = getTokenFromRequest(req);
  if (!token) return next();
  const claims = jwt.decode(token) as JwtTokenPayload | null;
  if (claims?.scope !== "owner_mfa_setup") return next();
  if (ownerMfaSetupAllows(req.method, req.path)) return next();
  return res.status(403).json({
    error: "Add a passkey or an authenticator app to continue.",
    code: "OWNER_MFA_SETUP_REQUIRED",
    redirectTo: "/account/secure-your-account",
  });
};

export interface AuthedRequest extends Request {
  user?: AuthedUser;
  sessionId?: string;
}

function denySupportWrite(req: Request, res: Response, user: AuthedUser): boolean {
  if (!user.imp || !["OWNER", "AGENT"].includes(user.role) || ["GET", "HEAD", "OPTIONS"].includes(req.method)) return false;
  res.status(403).json({
    error: "This action is not available during an admin support session",
    code: "IMPERSONATION_FORBIDDEN",
  });
  return true;
}

function isSensitiveSupportRead(req: Request): boolean {
  if (!["GET", "HEAD"].includes(req.method)) return false;
  const path = String(req.path || "").toLowerCase();
  return path === "/api/account/export"
    || path.startsWith("/api/account/documents/")
    || path.startsWith("/api/account/security/")
    || (/^\/api\/(owner|agent-portal)\//.test(path)
      && (/(?:\.pdf|\.csv|\.xlsx|\.zip)$/.test(path)
        || /\/(?:export|download|pdf|document|manifest|voucher)(?:\/|$)/.test(path)));
}

function denySupportRead(req: Request, res: Response, user: AuthedUser): boolean {
  if (!user.imp || !isSensitiveSupportRead(req)) return false;
  res.status(403).json({
    error: "This download is not available during an admin support session",
    code: "IMPERSONATION_FORBIDDEN",
  });
  return true;
}

/** Keep support sessions read-only even on routes with custom auth. */
export const ownerSupportReadOnly: RequestHandler = async (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) && !isSensitiveSupportRead(req)) return next();
  if (req.path === "/api/auth/impersonation/end" || req.path === "/api/auth/logout") return next();
  const token = getTokenFromRequest(req);
  if (!token) return next();
  const claims = jwt.decode(token) as JwtTokenPayload | null;
  if (claims?.imp !== true) return next();
  try {
    const user = await verifyToken(token);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (denySupportWrite(req, res, user) || denySupportRead(req, res, user)) return;
    return next();
  } catch {
    return res.status(401).json({ error: "Unauthorized" });
  }
};

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

export function getTokenFromRequest(req: Request): string | null {
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
export async function verifyToken(token: string): Promise<AuthedUser | null> {
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
    const sessionId = typeof decoded.sid === "string" ? decoded.sid.trim() : "";
    if (!sessionId) {
      throw authError("SESSION_REVOKED", "Legacy session is no longer valid");
    }
    // Authentication and authorization state is deliberately loaded from the
    // database on every request. Redis may cache public/application data, but
    // it is never authoritative for role, suspension, disablement, token
    // revocation, or the exact server-side session bound to this JWT.
    let activeSession: any;
    try {
      activeSession = await (prisma.session as any).findFirst({
        where: { id: sessionId, userId, revokedAt: null },
        select: {
          id: true,
          lastSeenAt: true,
          user: {
            select: {
              id: true, role: true, email: true, nrmsFinanceRole: true,
              suspendedAt: true, isDisabled: true, tokensValidAfter: true,
              twoFactorEnabled: true, twoFactorMethod: true, totpSecretEnc: true,
              agentProfile: { select: { status: true } },
            },
          },
        },
      });
    } catch (error: any) {
      const missingFinanceRole =
        error?.code === "P2022"
        && String(error?.message || "").includes("nrmsFinanceRole");
      if (!missingFinanceRole) throw error;

      // Safe compatibility path while a forward-only deployment migration is
      // being applied. Finance privileges fail closed to NONE; ordinary
      // authentication must not be converted into a misleading generic 401.
      console.error("[AUTH] user.nrmsFinanceRole is missing; using NONE until migrations are applied");
      activeSession = await (prisma.session as any).findFirst({
        where: { id: sessionId, userId, revokedAt: null },
        select: {
          id: true,
          lastSeenAt: true,
          user: {
            select: {
              id: true, role: true, email: true, suspendedAt: true,
              isDisabled: true, tokensValidAfter: true,
              twoFactorEnabled: true, twoFactorMethod: true, totpSecretEnc: true,
              agentProfile: { select: { status: true } },
            },
          },
        },
      });
      if (activeSession?.user) activeSession.user.nrmsFinanceRole = "NONE";
    }

    if (!activeSession) {
      throw authError("SESSION_REVOKED", "Session revoked");
    }

    const user = activeSession.user;
    if (!user) return null;
    // A support session ends the moment its admin loses access (suspended,
    // demoted, disabled, or signed out everywhere), not when its 10 minutes run out.
    if (decoded.imp === true && !(await supportImpersonatorActive(decoded.act, decoded.iat))) {
      await (prisma.session as any).updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {});
      throw authError("SESSION_REVOKED", "Support session revoked");
    }
    if (!accountMfaSessionAllowed(user, decoded)) {
      throw authError("MFA_REQUIRED", "Sign in again and complete authenticator verification");
    }

    // Check if account is suspended - suspended users cannot access their account.
    if (user.suspendedAt) {
      throw authError("ACCOUNT_SUSPENDED", "Account suspended");
    }
    if (user.isDisabled) {
      throw authError("ACCOUNT_DISABLED", "Account disabled");
    }
    if (String(user.role || "").toUpperCase() === "AGENT" && String(user.agentProfile?.status || "").toUpperCase() !== "ACTIVE") {
      throw authError("ACCOUNT_SUSPENDED", "Agent account is not active");
    }

    // Map database role to Role type (handle case where role might be different format)
    // Check raw database value before casting to handle CUSTOMER -> USER mapping
    const rawRole = (user.role?.toUpperCase() || 'USER');
    if (rawRole === 'ADMIN' && decoded.amr !== 'passkey' && decoded.amr !== 'totp') {
      throw authError('ADMIN_MFA_REQUIRED', 'Administrator verification required');
    }
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

    // Enforce the configured idle timeout using the server-side activity
    // record. Refresh at most once every five minutes to avoid a write on every
    // authenticated request.
    const idleMinutes = await getSessionIdleMinutes();
    const lastSeenMs = new Date(activeSession.lastSeenAt).getTime();
    const idleMs = Math.max(1, idleMinutes) * 60_000;
    if (!Number.isFinite(lastSeenMs) || Date.now() - lastSeenMs > idleMs) {
      await (prisma.session as any).updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {});
      throw authError("SESSION_EXPIRED", "Session expired");
    }
    if (Date.now() - lastSeenMs > Math.min(5 * 60_000, Math.max(60_000, idleMs / 2))) {
      void (prisma.session as any).updateMany({
        where: { id: sessionId, userId, revokedAt: null },
        data: { lastSeenAt: new Date() },
      }).catch(() => {});
    }
    
    const authedUser: AuthedUser = {
      id: user.id,
      role,
      email: user.email || undefined,
      nrmsFinanceRole: (user as any).nrmsFinanceRole || "NONE",
      sessionId,
      ...(decoded.imp === true ? { imp: true } : {}),
      ...(decoded.imp === true && Number.isInteger(decoded.act) && Number(decoded.act) > 0
        ? { impersonatorId: Number(decoded.act) } : {}),
      ...(decoded.imp !== true && decoded.scope !== "owner_mfa_setup"
        && (decoded.amr === "passkey" || decoded.amr === "totp" || decoded.mfa === "totp" || decoded.mfa === "backup_code")
        ? { strongAuth: true } : {}),
      ...(decoded.scope === "owner_mfa_setup" ? { setupOnly: true } : {}),
    };
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
        (req as AuthedRequest).sessionId = user.sessionId;
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
        (req as AuthedRequest).sessionId = user.sessionId;
        markPrivateNoStore(res);
        if (denySupportWrite(req, res, user) || denySupportRead(req, res, user)) return;
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
      if (err?.code === 'ACCOUNT_DISABLED') {
        clearAuthCookie(res);
        return res.status(403).json({ error: "Account disabled", code: "ACCOUNT_DISABLED" });
      }
      if (err?.code === 'MFA_REQUIRED') {
        clearAuthCookie(res);
        return res.status(401).json({ error: err.message, code: "MFA_REQUIRED" });
      }
      if (err?.code === 'ADMIN_MFA_REQUIRED') {
        clearAuthCookie(res);
        return res.status(401).json({ error: "Administrator verification required", code: "ADMIN_MFA_REQUIRED" });
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
            (req as AuthedRequest).sessionId = verified.sessionId;
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
          if (err?.code === 'ACCOUNT_DISABLED') {
            clearAuthCookie(res);
            return res.status(403).json({ error: "Account disabled", code: "ACCOUNT_DISABLED" });
          }
          if (err?.code === 'MFA_REQUIRED') {
            clearAuthCookie(res);
            return res.status(401).json({ error: err.message, code: "MFA_REQUIRED" });
          }
          if (err?.code === 'ADMIN_MFA_REQUIRED') {
            clearAuthCookie(res);
            return res.status(401).json({ error: "Administrator verification required", code: "ADMIN_MFA_REQUIRED" });
          }
        }
      }
    }

    // Production: strict — no user means no access.
    if (!(req as AuthedRequest).user) return res.status(401).json({ error: "Unauthorized" });

    if (required && (req as AuthedRequest).user!.role !== required) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (denySupportWrite(req, res, (req as AuthedRequest).user!) || denySupportRead(req, res, (req as AuthedRequest).user!)) return;

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
