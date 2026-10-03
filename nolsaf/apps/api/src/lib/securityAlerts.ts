import { notifyAdmins } from "./notifications.js";
import { getRedis } from "./redis.js";
import { shouldAlertOnSuspiciousActivity } from "./securitySettings.js";

/**
 * Admin alerts for suspicious security events, gated by the
 * "Suspicious activity alerts" system setting (alertOnSuspiciousActivity).
 *
 * Alerts land in the admin notification inbox (and realtime dashboards).
 * Each kind+subject pair alerts at most once per DEDUPE_SECONDS so a brute
 * force run produces one notification, not hundreds.
 */
export type SecurityAlertKind =
  | "security_account_locked"
  | "security_ip_burst"
  | "security_admin_mfa_locked"
  | "security_admin_ip_blocked";

const DEDUPE_SECONDS = 30 * 60;
const memSeen = new Map<string, number>();

async function firstInWindow(key: string): Promise<boolean> {
  try {
    const r = getRedis();
    if (r) {
      const set = await r.set(`secalert:${key}`, "1", "EX", DEDUPE_SECONDS, "NX");
      return set === "OK";
    }
  } catch {
    // fall through to the in-memory window
  }
  const now = Date.now();
  for (const [k, until] of memSeen) if (until < now) memSeen.delete(k);
  if ((memSeen.get(key) ?? 0) > now) return false;
  memSeen.set(key, now + DEDUPE_SECONDS * 1000);
  return true;
}

/** Best effort: never throws, never blocks the request that triggered it. */
export async function raiseSecurityAlert(kind: SecurityAlertKind, subject: string, data: Record<string, unknown>): Promise<void> {
  try {
    if (!(await shouldAlertOnSuspiciousActivity())) return;
    if (!(await firstInWindow(`${kind}:${subject.toLowerCase()}`))) return;
    await notifyAdmins(kind, data);
  } catch (err: any) {
    console.error("[securityAlerts] failed", kind, err?.message || err);
  }
}
