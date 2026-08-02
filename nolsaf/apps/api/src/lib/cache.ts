import Redis from "ioredis";
import { createHash } from "node:crypto";
import { requireTenantId } from "./tenantIsolation.js";

const enabled = String(process.env.REPORTS_CACHE_ENABLED).toLowerCase() === "true";
const ttl = Number(process.env.REPORTS_CACHE_TTL_SECONDS ?? 600);

let redis: Redis | null = null;
if (enabled && process.env.REDIS_URL) {
  try {
    redis = new Redis(process.env.REDIS_URL, { lazyConnect: true });
    // ioredis emits 'error' events; without a listener Node treats it as unhandled and may crash.
    redis.on("error", () => {
      // Best-effort cache: ignore connection errors and let per-call fallbacks handle it.
    });
    // connect in background, failures are handled per-call
    redis.connect().catch(() => { /* swallow here; fallback will kick in */ });
  } catch {
    redis = null;
  }
}

declare const ownerReportCacheKeyBrand: unique symbol;
export type OwnerReportCacheKey = string & { readonly [ownerReportCacheKeyBrand]: true };

/** Build a stable, owner-bound key without exposing report parameters in Redis. */
export function makeKey(ownerId: number, route: string, params: Record<string, any>): OwnerReportCacheKey {
  const id = requireTenantId(ownerId, "ownerId");
  const safeRoute = String(route || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!safeRoute) throw new Error("Report cache route is required");
  const sorted = JSON.stringify(params, Object.keys(params || {}).sort());
  const digest = createHash("sha256").update(sorted).digest("hex").slice(0, 24);
  return `reports:${id}:${safeRoute}:${digest}` as OwnerReportCacheKey;
}

/** Wrap a producer with cache get/set (JSON). Fallbacks gracefully if cache disabled/unavailable. */
export async function withCache<T>(key: OwnerReportCacheKey, producer: () => Promise<T>): Promise<T> {
  if (!/^reports:[1-9]\d*:[a-zA-Z0-9._-]+:[a-f0-9]{24}$/.test(key)) return producer();
  if (!enabled || !redis) return producer();

  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    // Redis read failed: fallback to producer
  }

  const value = await producer();

  try {
    await redis!.set(key, JSON.stringify(value), "EX", ttl);
  } catch {
    // Redis write failed: ignore
  }

  return value;
}

/** Invalidate a set of keys by pattern (coarse). */
export async function invalidateByPattern(pattern: string) {
  if (!enabled || !redis) return;
  try {
    const stream = redis.scanStream({ match: pattern, count: 100 });
    const keys: string[] = [];
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (k: string[]) => keys.push(...k));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    if (keys.length) await redis.del(keys);
  } catch {
    // ignore
  }
}

/** Convenience: invalidate all report caches for an owner */
export function invalidateOwnerReports(ownerId: number) {
  return invalidateByPattern(`reports:${requireTenantId(ownerId, "ownerId")}:*`);
}
export async function invalidateOwnerPropertyLists(ownerId: number) {
  try {
    // If you added Redis keys for owner property lists, delete them here.
    console.log("[cache] invalidate owner properties", ownerId);
  } catch {}
}

export async function invalidateAdminPropertyQueues() {
  try {
    console.log("[cache] invalidate admin queues");
  } catch {}
}
