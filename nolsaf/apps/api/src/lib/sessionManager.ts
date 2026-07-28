import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { 
  getSessionIdleMinutes, 
  getMaxSessionDurationHours,
  getRoleSessionMaxMinutes,
  shouldForceLogoutOnPasswordChange 
} from "./securitySettings.js";

const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV !== "production" 
    ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret") 
    : "");

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET not set");
}

// Cache for session settings (refresh every 5 minutes)
let cachedSessionSettings = {
  idleMinutes: 30,
  maxDurationHours: 24,
  lastUpdate: 0,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Get session settings with caching
 */
async function getSessionSettings() {
  const now = Date.now();
  if (now - cachedSessionSettings.lastUpdate > CACHE_TTL_MS) {
    try {
      const [idleMinutes, maxDurationHours] = await Promise.all([
        getSessionIdleMinutes(),
        getMaxSessionDurationHours(),
      ]);
      cachedSessionSettings = {
        idleMinutes,
        maxDurationHours,
        lastUpdate: now,
      };
    } catch (err) {
      console.error('Failed to fetch session settings:', err);
      // Use cached values on error, or defaults if no cache exists
      if (cachedSessionSettings.lastUpdate === 0) {
        // First call failed - use defaults
        cachedSessionSettings = {
          idleMinutes: 30,
          maxDurationHours: 24,
          lastUpdate: now,
        };
      }
      // Otherwise, keep using existing cached values
    }
  }
  return cachedSessionSettings;
}

/**
 * Sign JWT token with dynamic expiration based on SystemSetting
 */
export async function signUserJwt(
  user: { id: number; role?: string | null; email?: string | null },
  options: { impersonated?: boolean; expiresInSeconds?: number } = {},
): Promise<string> {
  let sessionId: string | null = null;
  try {
    const roleMaxMinutes = await getRoleSessionMaxMinutes(user.role);
    const maxDurationSeconds = Math.min(
      options.expiresInSeconds ?? roleMaxMinutes * 60,
      7 * 24 * 60 * 60,
    );
    
    // Use environment variable if set, otherwise use calculated max duration (in seconds)
    // Always use number (seconds) for consistency - jsonwebtoken accepts this
    let expiresIn: number = maxDurationSeconds;
    if (options.expiresInSeconds == null && process.env.JWT_EXPIRES_IN) {
      const envValue = process.env.JWT_EXPIRES_IN;
      const numValue = Number(envValue);
      // Only use numeric values from env; if not a number, use default
      if (!isNaN(numValue)) {
        expiresIn = numValue;
      }
    }
    
    // Create the server-side session before signing so every normal auth token
    // is bound to one revocable device/session record.
    const session = await prisma.session.create({
      data: { userId: user.id, lastSeenAt: new Date() },
      select: { id: true },
    });
    sessionId = session.id;

    return jwt.sign(
      { 
        sub: String(user.id),
        role: user.role ? String(user.role).toUpperCase() : undefined,
        sid: session.id,
        ...(options.impersonated ? { imp: true } : {}),
        iat: Math.floor(Date.now() / 1000), // Issued at time
      },
      JWT_SECRET,
      { expiresIn }
    );
  } catch (error: any) {
    if (sessionId) {
      await prisma.session.updateMany({
        where: { id: sessionId, userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      }).catch(() => {});
    }
    console.error("Error signing JWT:", error);
    throw new Error(`Failed to sign JWT: ${error?.message || String(error)}`);
  }
}

/**
 * Calculate session expiration time based on idle timeout
 */
export async function getSessionExpirationTime(): Promise<Date> {
  const settings = await getSessionSettings();
  const expirationMs = settings.idleMinutes * 60 * 1000; // Convert minutes to milliseconds
  return new Date(Date.now() + expirationMs);
}

/**
 * Set auth cookie with dynamic expiration
 */
export async function setAuthCookie(
  res: any, 
  token: string, 
  role?: string | null
): Promise<void> {
  try {
    const isProd = process.env.NODE_ENV === "production";
    const cookieDomain = (process.env.COOKIE_DOMAIN || "").trim() || undefined;
    const roleMaxMinutes = await getRoleSessionMaxMinutes(role);
    const maxAge = roleMaxMinutes * 60 * 1000;
    
    // sameSite: "none" + secure is required when the Socket.IO client connects
    // cross-origin (e.g. Next.js on app.nolsaf.com → API on api.nolsaf.com).
    // In dev (non-secure) we fall back to "lax" so localhost still works.
    const sameSite = isProd ? ("none" as const) : ("lax" as const);

    const cookieOptions = {
      httpOnly: true,
      secure: isProd,         // "none" requires secure=true per spec
      sameSite,
      path: "/",
      maxAge,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    };
    
    // Set the JWT token cookie
    res.cookie("nolsaf_token", token, cookieOptions);
    res.cookie("token", token, cookieOptions); // Also set as "token" for middleware compatibility
    
    // Set role cookie for easier middleware access (non-httpOnly so client can read it)
    if (role) {
      res.cookie("role", String(role).toUpperCase(), {
        httpOnly: false, // Allow client-side access for middleware
        secure: isProd,
        sameSite: "lax" as const,
        path: "/",
        maxAge,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      });
    }
  } catch (error: any) {
    console.error("Error setting auth cookie:", error);
    // Don't throw - cookie setting failure shouldn't break login
    // The token is still in the response body
  }
}

/**
 * Check if force logout on password change is enabled
 */
export async function shouldForceLogout(): Promise<boolean> {
  return await shouldForceLogoutOnPasswordChange();
}

/**
 * Clear all auth cookies (used for force logout)
 */
export function clearAuthCookie(res: any): void {
  const cookieDomain = (process.env.COOKIE_DOMAIN || "").trim() || undefined;
  const baseOpts = { path: "/", ...(cookieDomain ? { domain: cookieDomain } : {}) };
  res.clearCookie("nolsaf_token", baseOpts);
  res.clearCookie("token", baseOpts);
  res.clearCookie("role", baseOpts);
}

