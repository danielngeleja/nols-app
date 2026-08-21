import { prisma } from "@nolsaf/prisma";
import { validatePasswordStrength } from "./security.js";

type SessionRole = 'ADMIN' | 'OWNER' | 'DRIVER' | 'AGENT' | 'USER' | 'CUSTOMER';

// Cache session-related settings to avoid DB hits on every request.
let cachedSessionPolicy: {
  lastUpdate: number;
  sessionIdleMinutes: number;
  maxSessionDurationHours: number;
  sessionMaxMinutesAdmin?: number | null;
  sessionMaxMinutesOwner?: number | null;
  sessionMaxMinutesDriver?: number | null;
  sessionMaxMinutesCustomer?: number | null;
  sessionMaxMinutesAgent?: number | null;
} = {
  lastUpdate: 0,
  sessionIdleMinutes: 30,
  maxSessionDurationHours: 24,
  sessionMaxMinutesAdmin: null,
  sessionMaxMinutesOwner: null,
  sessionMaxMinutesDriver: null,
  sessionMaxMinutesCustomer: null,
  sessionMaxMinutesAgent: null,
};

// Session-policy reductions are security controls and must be visible on the
// next authenticated request, including on other API instances. Do not keep a
// process-local TTL cache by default. Deployments may opt into a very short
// cache explicitly if they accept the corresponding enforcement delay.
const SESSION_POLICY_CACHE_TTL_MS = Math.max(
  0,
  Number(process.env.SESSION_POLICY_CACHE_TTL_MS ?? 0) || 0,
);

export function invalidateSessionPolicyCache(): void {
  cachedSessionPolicy.lastUpdate = 0;
}

async function getSessionPolicyCached() {
  const now = Date.now();
  if (
    SESSION_POLICY_CACHE_TTL_MS > 0
    && now - cachedSessionPolicy.lastUpdate <= SESSION_POLICY_CACHE_TTL_MS
  ) return cachedSessionPolicy;

  try {
    let settings: any = null;
    try {
      settings = await prisma.systemSetting.findUnique({
        where: { id: 1 },
        select: {
          sessionIdleMinutes: true,
          maxSessionDurationHours: true,
          sessionMaxMinutesAdmin: true,
          sessionMaxMinutesOwner: true,
          sessionMaxMinutesDriver: true,
          sessionMaxMinutesCustomer: true,
          sessionMaxMinutesAgent: true,
        } as any,
      });
    } catch (err: any) {
      // If the DB hasn't been migrated yet, these columns may not exist.
      // Fall back to selecting only columns guaranteed to exist.
      if (err?.code === 'P2022' || String(err?.message || '').includes('ColumnNotFound')) {
        settings = await prisma.systemSetting.findUnique({
          where: { id: 1 },
          select: {
            sessionIdleMinutes: true,
            maxSessionDurationHours: true,
          },
        });
      } else {
        throw err;
      }
    }

    cachedSessionPolicy = {
      lastUpdate: now,
      sessionIdleMinutes: settings?.sessionIdleMinutes ?? 30,
      maxSessionDurationHours: settings?.maxSessionDurationHours ?? 24,
      sessionMaxMinutesAdmin: (settings as any)?.sessionMaxMinutesAdmin ?? null,
      sessionMaxMinutesOwner: (settings as any)?.sessionMaxMinutesOwner ?? null,
      sessionMaxMinutesDriver: (settings as any)?.sessionMaxMinutesDriver ?? null,
      sessionMaxMinutesCustomer: (settings as any)?.sessionMaxMinutesCustomer ?? null,
      sessionMaxMinutesAgent: (settings as any)?.sessionMaxMinutesAgent ?? null,
    };
  } catch (err) {
    console.error('Failed to fetch session policy from SystemSetting:', err);
    // Keep existing cached values.
    cachedSessionPolicy.lastUpdate = now;
  }

  return cachedSessionPolicy;
}

function normalizeSessionRole(role?: string | null): SessionRole {
  const r = String(role ?? '').trim().toUpperCase();
  if (r === 'ADMIN') return 'ADMIN';
  if (r === 'OWNER') return 'OWNER';
  if (r === 'DRIVER') return 'DRIVER';
  if (r === 'AGENT' || r === 'NRMS_AGENT') return 'AGENT';
  if (r === 'CUSTOMER' || r === 'USER' || r === 'TRAVELLER' || r === 'TRAVELER') return 'CUSTOMER';
  return 'USER';
}

/**
 * Get the effective session TTL (minutes) for a given role.
 *
 * - Uses per-role override if set (e.g. sessionMaxMinutesAdmin)
 * - Falls back to global sessionIdleMinutes
 * - Enforces maxSessionDurationHours as an upper bound (defense-in-depth)
 */
export async function getRoleSessionMaxMinutes(role?: string | null): Promise<number> {
  const policy = await getSessionPolicyCached();
  const normalized = normalizeSessionRole(role);

  let roleMinutes: number | null | undefined;
  switch (normalized) {
    case 'ADMIN':
      roleMinutes = policy.sessionMaxMinutesAdmin;
      break;
    case 'OWNER':
      roleMinutes = policy.sessionMaxMinutesOwner;
      break;
    case 'DRIVER':
      roleMinutes = policy.sessionMaxMinutesDriver;
      break;
    case 'AGENT':
      roleMinutes = policy.sessionMaxMinutesAgent;
      break;
    case 'CUSTOMER':
      roleMinutes = policy.sessionMaxMinutesCustomer;
      break;
    default:
      roleMinutes = null;
  }

  const fallbackMinutes = Number(policy.sessionIdleMinutes ?? 30);
  const chosenMinutes = Number(roleMinutes ?? fallbackMinutes);
  const capMinutes = Number(policy.maxSessionDurationHours ?? 24) * 60;

  // Sanitize: minimum 1 minute; cap to configured max duration.
  const safe = Math.max(1, isFinite(chosenMinutes) ? chosenMinutes : 30);
  const capped = isFinite(capMinutes) && capMinutes > 0 ? Math.min(safe, capMinutes) : safe;
  return Math.floor(capped);
}

/**
 * Get password validation options from SystemSetting
 */
export async function getPasswordValidationOptions() {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: {
        minPasswordLength: true,
        requirePasswordUppercase: true,
        requirePasswordLowercase: true,
        requirePasswordNumber: true,
        requirePasswordSpecial: true,
      },
    });
    return {
      minLength: settings?.minPasswordLength ?? 8,
      requireUpper: settings?.requirePasswordUppercase ?? false,
      requireLower: settings?.requirePasswordLowercase ?? false,
      requireNumber: settings?.requirePasswordNumber ?? false,
      requireSpecial: settings?.requirePasswordSpecial ?? false,
    };
  } catch (err) {
    console.error('Failed to fetch password validation options from SystemSetting:', err);
    // Return safe defaults
    return {
      minLength: 8,
      requireUpper: false,
      requireLower: false,
      requireNumber: false,
      requireSpecial: false,
    };
  }
}

/**
 * Validate password using SystemSetting configuration
 */
export async function validatePasswordWithSettings(
  password: string,
  role?: string | null
): Promise<{ valid: boolean; reasons: string[] }> {
  const options = await getPasswordValidationOptions();
  return validatePasswordStrength(password, { ...options, role: role || undefined });
}

/**
 * Check if admin 2FA is required
 */
export async function isAdmin2FARequired(): Promise<boolean> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { requireAdmin2FA: true },
    });
    return settings?.requireAdmin2FA ?? false;
  } catch (err) {
    console.error('Failed to fetch admin 2FA requirement setting:', err);
    return false; // Default fallback
  }
}

/**
 * Get session idle timeout in minutes
 */
export async function getSessionIdleMinutes(): Promise<number> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { sessionIdleMinutes: true },
    });
    return settings?.sessionIdleMinutes ?? 30;
  } catch (err: any) {
    console.error('Failed to fetch session idle minutes from SystemSetting:', err);
    return 30; // Default fallback
  }
}

/**
 * Get maximum session duration in hours
 */
export async function getMaxSessionDurationHours(): Promise<number> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { maxSessionDurationHours: true },
    });
    return settings?.maxSessionDurationHours ?? 24;
  } catch (err) {
    console.error('Failed to fetch max session duration from SystemSetting:', err);
    return 24; // Default fallback
  }
}

/**
 * Check if force logout on password change is enabled
 */
export async function shouldForceLogoutOnPasswordChange(): Promise<boolean> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { forceLogoutOnPasswordChange: true },
    });
    return settings?.forceLogoutOnPasswordChange ?? true;
  } catch (err) {
    console.error('Failed to fetch force logout on password change setting:', err);
    return true; // Default fallback
  }
}

/**
 * Get API rate limit per minute
 */
export async function getApiRateLimitPerMinute(): Promise<number> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { apiRateLimitPerMinute: true },
    });
    return settings?.apiRateLimitPerMinute ?? 100;
  } catch (err) {
    console.error('Failed to fetch API rate limit from SystemSetting:', err);
    return 100; // Default fallback
  }
}

/**
 * Get max login attempts before lockout
 */
export async function getMaxLoginAttempts(): Promise<number> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { maxLoginAttempts: true },
    });
    return settings?.maxLoginAttempts ?? 5;
  } catch (err: any) {
    console.error('Failed to fetch max login attempts from SystemSetting:', err);
    return 5; // Default fallback
  }
}

/**
 * Get account lockout duration in minutes
 */
export async function getAccountLockoutDurationMinutes(): Promise<number> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { accountLockoutDurationMinutes: true },
    });
    return settings?.accountLockoutDurationMinutes ?? 5; // Default: 5 minutes (was 30)
  } catch (err) {
    console.error('Failed to fetch account lockout duration from SystemSetting:', err);
    return 5; // Default fallback
  }
}

/**
 * Check if security audit logging is enabled
 */
export async function isSecurityAuditLoggingEnabled(): Promise<boolean> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { enableSecurityAuditLogging: true },
    });
    return settings?.enableSecurityAuditLogging ?? true;
  } catch (err) {
    console.error('Failed to fetch security audit logging setting:', err);
    return true; // Default fallback
  }
}

/**
 * Check if failed login attempts should be logged
 */
export async function shouldLogFailedLoginAttempts(): Promise<boolean> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { logFailedLoginAttempts: true },
    });
    return settings?.logFailedLoginAttempts ?? true;
  } catch (err) {
    console.error('Failed to fetch log failed login attempts setting:', err);
    return true; // Default fallback
  }
}

/**
 * Check if alerts should be sent on suspicious activity
 */
export async function shouldAlertOnSuspiciousActivity(): Promise<boolean> {
  try {
    const settings = await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { alertOnSuspiciousActivity: true },
    });
    return settings?.alertOnSuspiciousActivity ?? false;
  } catch (err) {
    console.error('Failed to fetch alert on suspicious activity setting:', err);
    return false; // Default fallback
  }
}

