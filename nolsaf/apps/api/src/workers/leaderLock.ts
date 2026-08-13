import crypto from "crypto";
import { getRedis } from "../lib/redis.js";

/**
 * Distributed worker-leader lease.
 *
 * Acquisition, renewal, and release are ownership-checked in Redis. Production
 * fails closed when coordination is unavailable. A known single-instance
 * deployment can explicitly allow uncoordinated workers by setting both
 * WORKER_SINGLE_INSTANCE=true and ALLOW_UNCOORDINATED_WORKERS=true.
 */
const LOCK_KEY = "nolsaf:workers:leader";
const LEASE_TTL_SECONDS = 60;
const RENEW_INTERVAL_MS = 25_000;
const LEASE_SAFETY_MARGIN_MS = 5_000;

const RENEW_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return 0`;

const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0`;

const instanceId = `${process.pid}-${crypto.randomBytes(6).toString("hex")}`;

let renewTimer: NodeJS.Timeout | null = null;
let leaseDeadlineTimer: NodeJS.Timeout | null = null;
let holdsLease = false;
let leadershipLostHandler: ((reason: string) => void) | null = null;

function envEnabled(name: string): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(process.env[name] || "").trim().toLowerCase(),
  );
}

function uncoordinatedSingleInstanceAllowed(): boolean {
  return envEnabled("WORKER_SINGLE_INSTANCE") && envEnabled("ALLOW_UNCOORDINATED_WORKERS");
}

export function setLeadershipLostHandler(handler: (reason: string) => void): void {
  leadershipLostHandler = handler;
}

export function hasLeaderLease(): boolean {
  return holdsLease;
}

export async function acquireLeaderLock(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    if (uncoordinatedSingleInstanceAllowed()) {
      console.warn("[workers] Running without Redis under the explicit single-instance override.");
      holdsLease = true;
      return true;
    }
    console.error("[workers] Redis unavailable; workers are disabled because leadership cannot be proven.");
    return false;
  }

  try {
    const result = await redis.set(LOCK_KEY, instanceId, "EX", LEASE_TTL_SECONDS, "NX");
    if (result !== "OK") return false;

    holdsLease = true;
    armLeaseDeadline();
    startRenewal();
    return true;
  } catch (error: any) {
    if (uncoordinatedSingleInstanceAllowed()) {
      console.warn(
        "[workers] Redis lease unavailable; using the explicit single-instance override:",
        error?.message || error,
      );
      holdsLease = true;
      return true;
    }
    console.error(
      "[workers] Could not acquire the Redis worker lease; workers remain disabled:",
      error?.message || error,
    );
    return false;
  }
}

function armLeaseDeadline(): void {
  if (leaseDeadlineTimer) clearTimeout(leaseDeadlineTimer);
  leaseDeadlineTimer = setTimeout(
    () => loseLeadership("The Redis lease could not be renewed before its safety deadline."),
    LEASE_TTL_SECONDS * 1000 - LEASE_SAFETY_MARGIN_MS,
  );
  leaseDeadlineTimer.unref?.();
}

function loseLeadership(reason: string): void {
  if (!holdsLease) return;
  holdsLease = false;
  stopRenewal();
  console.error(`[workers] Leadership lost. ${reason}`);
  leadershipLostHandler?.(reason);
}

function startRenewal(): void {
  if (renewTimer) return;

  renewTimer = setInterval(async () => {
    const redis = getRedis();
    if (!redis) return; // the independent deadline fails closed

    try {
      const renewed = Number(
        await redis.eval(RENEW_SCRIPT, 1, LOCK_KEY, instanceId, String(LEASE_TTL_SECONDS)),
      );
      if (renewed === 1) {
        armLeaseDeadline();
      } else {
        loseLeadership("Another process owns the lease or the lease expired.");
      }
    } catch (error: any) {
      // A brief outage can recover at the next heartbeat. The deadline stops
      // this process before its last known lease can be acquired elsewhere.
      console.warn("[workers] Worker lease renewal failed:", error?.message || error);
    }
  }, RENEW_INTERVAL_MS);

  renewTimer.unref?.();
}

function stopRenewal(): void {
  if (renewTimer) {
    clearInterval(renewTimer);
    renewTimer = null;
  }
  if (leaseDeadlineTimer) {
    clearTimeout(leaseDeadlineTimer);
    leaseDeadlineTimer = null;
  }
}

/** Best-effort ownership-checked release during graceful shutdown. */
export async function releaseLeaderLock(): Promise<void> {
  stopRenewal();
  if (!holdsLease) return;
  holdsLease = false;

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.eval(RELEASE_SCRIPT, 1, LOCK_KEY, instanceId);
  } catch {
    // The lease expires without an unsafe delete of another owner's lock.
  }
}
