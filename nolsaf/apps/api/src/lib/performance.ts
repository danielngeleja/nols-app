/**
 * Performance Monitoring & Optimization Utilities
 * 
 * Provides query timing, caching helpers, and performance metrics
 * for identifying and optimizing slow database queries and API endpoints.
 */

import { prisma } from "@nolsaf/prisma";
import { getRedis } from "./redis.js";
import { createHash } from "node:crypto";
import { requireTenantId } from "./tenantIsolation.js";

// Security constants
const MAX_METRICS_SIZE = 10000; // Maximum metrics entries before eviction
const MAX_LOGGED_PATTERNS = 1000; // Maximum logged patterns to track
const MAX_CACHE_KEY_LENGTH = 250; // Maximum cache key length
const MAX_TTL = 86400 * 30; // 30 days maximum TTL
const MAX_TAGS = 100; // Maximum tags per cache entry
const MAX_CACHE_VALUE_SIZE = 10 * 1024 * 1024; // 10MB maximum cache value size
const SCAN_TIMEOUT = 5000; // 5 seconds timeout for SCAN operations
const MAX_SCAN_ITERATIONS = 10000; // Maximum SCAN iterations to prevent DoS

// Performance metrics storage with size limits
const queryMetrics = new Map<string, { count: number; totalTime: number; avgTime: number; maxTime: number }>();

// Track logged patterns to avoid spam (with size limit)
const loggedMissingRedisPatterns = new Set<string>();

declare const scopedCacheKeyBrand: unique symbol;
export type ScopedCacheKey = string & { readonly [scopedCacheKeyBrand]: true };
export type TenantCacheScope =
  | "user"
  | "owner"
  | "property"
  | "driver"
  | "agent"
  | "sales_partner"
  | "nrms_property";

function stableCacheParams(params: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(params).sort()) sorted[key] = params[key];
  return JSON.stringify(sorted);
}

function safeResourceName(resource: string): string {
  const safe = String(resource || "").trim().replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  if (!safe) throw new Error("Cache resource name is required");
  return safe;
}

function paramDigest(params: Record<string, unknown>): string {
  return createHash("sha256").update(stableCacheParams(params)).digest("hex").slice(0, 24);
}

/** Public data only. Never use this namespace for personalized responses. */
export function publicCacheKey(resource: string, params: Record<string, unknown> = {}): ScopedCacheKey {
  return `public:${safeResourceName(resource)}:${paramDigest(params)}` as ScopedCacheKey;
}

/** Platform-wide data that is reachable only behind the ADMIN role gate. */
export function adminCacheKey(resource: string, params: Record<string, unknown> = {}): ScopedCacheKey {
  return `admin:${safeResourceName(resource)}:${paramDigest(params)}` as ScopedCacheKey;
}

/**
 * The only supported key builder for private tenant data. Requiring both the
 * tenancy dimension and its authoritative id prevents cross-account key reuse.
 */
export function tenantCacheKey(
  scope: TenantCacheScope,
  tenantId: number,
  resource: string,
  params: Record<string, unknown> = {},
): ScopedCacheKey {
  const id = requireTenantId(tenantId, `${scope} tenant ID`);
  return `tenant:${scope}:${id}:${safeResourceName(resource)}:${paramDigest(params)}` as ScopedCacheKey;
}

function hasValidCacheNamespace(key: string): boolean {
  if (/^(public|admin):[a-zA-Z0-9._-]+:[a-f0-9]{24}$/.test(key)) return true;
  return /^tenant:(user|owner|property|driver|agent|sales_partner|nrms_property):[1-9]\d*:[a-zA-Z0-9._-]+:[a-f0-9]{24}$/.test(key);
}

/**
 * Sanitize cache key to prevent injection attacks while preserving existing keys
 * Uses sanitization instead of rejection to maintain backward compatibility
 */
function sanitizeCacheKey(key: string): string {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid cache key: must be a non-empty string');
  }
  
  // Remove dangerous characters but keep common separators (:, _, -)
  // This preserves existing keys like "property:123" and "cache:tags:key"
  let sanitized = key.replace(/[^\w:._-]/g, '_');
  
  // Limit key length
  if (sanitized.length > MAX_CACHE_KEY_LENGTH) {
    // Truncate and hash the rest to maintain uniqueness
    const hash = sanitized.substring(MAX_CACHE_KEY_LENGTH - 9).split('').reduce((acc, char) => {
      return ((acc << 5) - acc) + char.charCodeAt(0) | 0;
    }, 0).toString(36);
    sanitized = sanitized.substring(0, MAX_CACHE_KEY_LENGTH - 9) + '_' + hash;
  }
  
  return sanitized;
}

/**
 * Sanitize cache key for logging to prevent information disclosure
 */
function logSafeKey(key: string): string {
  if (!key || key.length <= 20) {
    return key || '<empty>';
  }
  // Show first 10 and last 10 characters, with ... in between
  return key.substring(0, 10) + '...' + key.substring(key.length - 10);
}

/**
 * Enforce memory limits on queryMetrics with LRU-style eviction
 */
function enforceMetricsLimit(): void {
  if (queryMetrics.size > MAX_METRICS_SIZE) {
    // Evict half of oldest entries (simple approach, not true LRU but safe)
    const entries = Array.from(queryMetrics.entries());
    queryMetrics.clear();
    // Keep most recent half
    entries.slice(-Math.floor(MAX_METRICS_SIZE / 2)).forEach(([k, v]) => {
      queryMetrics.set(k, v);
    });
  }
}

/**
 * Enforce size limit on logged patterns set
 */
function enforceLoggedPatternsLimit(): void {
  if (loggedMissingRedisPatterns.size > MAX_LOGGED_PATTERNS) {
    // Clear old entries (safe to reset this set, it's just for logging)
    const patterns = Array.from(loggedMissingRedisPatterns);
    loggedMissingRedisPatterns.clear();
    // Keep most recent half
    patterns.slice(-Math.floor(MAX_LOGGED_PATTERNS / 2)).forEach(p => {
      loggedMissingRedisPatterns.add(p);
    });
  }
}

/**
 * Measure execution time of an async function
 */
export async function measureTime<T>(
  label: string,
  fn: () => Promise<T>,
  logToDebug: boolean = true
): Promise<{ result: T; duration: number }> {
  const start = performance.now();
  
  try {
    const result = await fn();
    const duration = performance.now() - start;
    
    // Track metrics
    const existing = queryMetrics.get(label) || { count: 0, totalTime: 0, avgTime: 0, maxTime: 0 };
    existing.count++;
    existing.totalTime += duration;
    existing.avgTime = existing.totalTime / existing.count;
    existing.maxTime = Math.max(existing.maxTime, duration);
    queryMetrics.set(label, existing);
    
    // Enforce memory limits to prevent DoS
    enforceMetricsLimit();
    
    // Log slow queries (>1 second)
    if (duration > 1000 && logToDebug) {
      console.warn(`[PERF] Slow query detected: ${label} took ${duration.toFixed(2)}ms`);
    }
    
    return { result, duration };
  } catch (error) {
    const duration = performance.now() - start;
    throw error;
  }
}

/**
 * Get performance metrics for all tracked queries
 */
export function getPerformanceMetrics() {
  return Array.from(queryMetrics.entries()).map(([label, metrics]) => ({
    label,
    ...metrics,
  })).sort((a, b) => b.avgTime - a.avgTime);
}

/**
 * Clear performance metrics
 */
export function clearPerformanceMetrics() {
  queryMetrics.clear();
}

/**
 * Enhanced caching wrapper with TTL and invalidation support
 */
export async function withCache<T>(
  key: ScopedCacheKey,
  producer: () => Promise<T>,
  options: {
    ttl?: number; // Time to live in seconds (default: 300 = 5 minutes)
    tags?: string[]; // Cache tags for invalidation
    skipCache?: boolean; // Skip cache (force refresh)
  } = {}
): Promise<T> {
  // A private cache entry without an explicit tenant namespace is a data-leak
  // risk. Fail safely to the producer rather than accepting legacy/raw keys.
  if (!hasValidCacheNamespace(key)) {
    console.warn(`[CACHE] Unscoped cache key rejected: ${logSafeKey(key)}`);
    return producer();
  }

  // Validate and sanitize inputs
  let sanitizedKey: string;
  try {
    sanitizedKey = sanitizeCacheKey(key);
  } catch (error: any) {
    // If key validation fails, log and fall back to producer (don't break existing code)
    console.warn(`[CACHE] Invalid cache key, skipping cache: ${logSafeKey(key)}`, error?.message);
    return producer();
  }
  
  // Validate and sanitize options
  const { skipCache = false } = options;
  let { ttl = 300, tags = [] } = options;
  
  // Validate TTL
  if (typeof ttl !== 'number' || ttl < 1) {
    ttl = 300; // Use default if invalid
  } else {
    ttl = Math.min(Math.max(1, Math.floor(ttl)), MAX_TTL); // Clamp between 1 and MAX_TTL
  }
  
  // Validate tags
  if (!Array.isArray(tags)) {
    tags = [];
  }
  if (tags.length > MAX_TAGS) {
    // Log warning but truncate instead of rejecting (preserve backward compatibility)
    console.warn(`[CACHE] Too many tags (${tags.length}), truncating to ${MAX_TAGS}`);
    tags = tags.slice(0, MAX_TAGS);
  }
  
  // Validate tag contents (sanitize each tag)
  tags = tags.map(tag => {
    if (typeof tag !== 'string') {
      return String(tag).replace(/[^\w:._-]/g, '_');
    }
    return tag.replace(/[^\w:._-]/g, '_').substring(0, 100); // Limit tag length
  });
  
  if (skipCache) {
    return producer();
  }
  
  const redis = getRedis();
  
  // If Redis is not available or not ready, skip cache and go directly to producer
  if (!redis || redis.status !== 'ready') {
    // Connection not ready (might be connecting, closed, or error)
    // Log once per key pattern to avoid spam
    const keyPattern = key.split(':').slice(0, 2).join(':');
    if (!loggedMissingRedisPatterns.has(keyPattern)) {
      loggedMissingRedisPatterns.add(keyPattern);
      enforceLoggedPatternsLimit(); // Enforce size limit
      const status = redis?.status || 'null';
      if (process.env.NODE_ENV !== "test") {
        console.warn(`[CACHE] Redis unavailable (status: ${status}), falling back to producer for key pattern: ${logSafeKey(keyPattern)}`);
      }
    }
    return producer();
  }
  
  try {
    // Try to get from cache with timeout (use sanitized key)
    // Increased timeout from 100ms to 2000ms to allow for slower Redis connections
    // Still fast enough to not block UI, but gives Redis time to respond
    const cached = await Promise.race([
      redis.get(sanitizedKey),
      new Promise<string | null>((resolve) => {
        setTimeout(() => resolve(null), 2000); // 2 seconds timeout for cache read (was 100ms)
      }),
    ]) as string | null;
    
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        return parsed as T;
      } catch (parseError) {
        // Invalid cache, continue to producer
        console.warn(`[CACHE] Invalid cache data for key: ${logSafeKey(sanitizedKey)}`, parseError);
      }
    }
    
    // Cache miss - execute producer
    const value = await producer();
    
    // Validate cache value size before storing
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_CACHE_VALUE_SIZE) {
      // Value too large - skip cache but still return value
      console.warn(`[CACHE] Value too large (${serialized.length} bytes), skipping cache for key: ${logSafeKey(sanitizedKey)}`);
      return value;
    }
    
    // Store in cache (fire and forget - don't block response)
    Promise.race([
      (async () => {
        try {
          await redis.setex(sanitizedKey, ttl, serialized);
          
          // Store tags for invalidation (use sanitized key)
          if (tags.length > 0) {
            const tagKey = `cache:tags:${sanitizedKey}`;
            await redis.setex(tagKey, ttl, JSON.stringify(tags));
          }
        } catch (writeError) {
          // Cache write failed, but return value anyway
          console.warn(`[CACHE] Failed to write cache for key: ${logSafeKey(sanitizedKey)}`, writeError);
        }
      })(),
      new Promise((resolve) => {
        setTimeout(() => resolve(null), 500); // 500ms timeout for cache write
      }),
    ]).catch(() => {
      // Ignore cache write errors
    });
    
    return value;
  } catch (error: any) {
    // Redis unavailable or error - fallback to producer
    const errorMsg = error?.message || 'Unknown error';
    // Filter out common connection errors to reduce noise (these are expected during connection)
    if (!errorMsg.includes('ECONNREFUSED') && 
        !errorMsg.includes('ENOTFOUND') && 
        !errorMsg.includes('Connection is closed') &&
        !errorMsg.includes('Stream isn\'t writeable')) {
      // Only log unexpected errors (not connection errors which are already logged)
      console.warn(`[CACHE] Cache error for key: ${logSafeKey(sanitizedKey)}`, errorMsg);
    }
    return producer();
  }
}

/**
 * Invalidate cache by key pattern
 * Includes timeout and iteration limits to prevent DoS
 */
export async function invalidateCache(pattern: string): Promise<void> {
  try {
    // Validate and sanitize pattern
    if (!pattern || typeof pattern !== 'string') {
      console.warn(`[CACHE] Invalid pattern for invalidation: ${logSafeKey(pattern || '<empty>')}`);
      return;
    }
    
    // Sanitize pattern to prevent injection
    const sanitizedPattern = pattern.replace(/[^\w:.*_-]/g, '_');
    
    const redis = getRedis();
    if (!redis || redis.status !== 'ready') {
      // Redis not available - silently skip invalidation
      return;
    }
    
    // TypeScript type narrowing - redis is guaranteed to be non-null and ready at this point
    const redisClient = redis;
    const stream = redisClient.scanStream({ match: sanitizedPattern, count: 100 });
    const keys: string[] = [];
    let iterations = 0;
    
    // Add timeout and iteration limit to prevent DoS
    const scanPromise = new Promise<void>((resolve, reject) => {
      stream.on("data", (k: string[]) => {
        keys.push(...k);
        iterations++;
        // Limit iterations to prevent DoS
        if (iterations > MAX_SCAN_ITERATIONS) {
          stream.removeAllListeners();
          resolve(); // Resolve early if limit reached
        }
      });
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    
    // Race against timeout
    await Promise.race([
      scanPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error('SCAN timeout')), SCAN_TIMEOUT);
      }),
    ]);
    
    if (keys.length > 0) {
      // Delete in batches to avoid overwhelming Redis
      const batchSize = 100;
      for (let i = 0; i < keys.length; i += batchSize) {
        const batch = keys.slice(i, i + batchSize);
        await redisClient.del(...batch);
      }
    }
  } catch (error: any) {
    // Silently handle invalidation errors - cache invalidation is best effort
    const errorMsg = error?.message || 'Unknown error';
    if (!errorMsg.includes('ECONNREFUSED') && 
        !errorMsg.includes('ENOTFOUND') &&
        !errorMsg.includes('SCAN timeout')) {
      console.warn(`[CACHE] Failed to invalidate cache pattern: ${logSafeKey(pattern)}`, errorMsg);
    }
  }
}

/**
 * Invalidate cache by tags
 * Includes timeout and iteration limits to prevent DoS
 */
export async function invalidateByTags(tags: string[]): Promise<void> {
  try {
    // Validate tags input
    if (!Array.isArray(tags) || tags.length === 0) {
      return;
    }
    
    // Limit number of tags to prevent DoS
    const validTags = tags.slice(0, MAX_TAGS).map(tag => {
      if (typeof tag !== 'string') {
        return String(tag).replace(/[^\w:._-]/g, '_');
      }
      return tag.replace(/[^\w:._-]/g, '_');
    });
    
    const redis = getRedis();
    if (!redis || redis.status !== 'ready') {
      // Redis not available - silently skip invalidation
      return;
    }
    
    // TypeScript type narrowing - redis is guaranteed to be non-null and ready at this point
    const redisClient = redis;
    
    for (const tag of validTags) {
      const pattern = `cache:tags:*`;
      const stream = redisClient.scanStream({ match: pattern, count: 100 });
      const keys: string[] = [];
      let iterations = 0;
      
      // Add timeout and iteration limit
      const scanPromise = new Promise<void>((resolve, reject) => {
        stream.on("data", (k: string[]) => {
          keys.push(...k);
          iterations++;
          // Limit iterations to prevent DoS
          if (iterations > MAX_SCAN_ITERATIONS) {
            stream.removeAllListeners();
            resolve(); // Resolve early if limit reached
          }
        });
        stream.on("end", () => resolve());
        stream.on("error", reject);
      });
      
      // Race against timeout
      try {
        await Promise.race([
          scanPromise,
          new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error('SCAN timeout')), SCAN_TIMEOUT);
          }),
        ]);
      } catch (timeoutError) {
        // Timeout - continue with next tag
        stream.removeAllListeners();
        continue;
      }
      
      // Process keys in batches to avoid overwhelming Redis
      for (let i = 0; i < keys.length; i += 50) {
        const batch = keys.slice(i, i + 50);
        
        for (const tagKey of batch) {
          const cachedTags = await redisClient.get(tagKey).catch(() => null);
          if (cachedTags) {
            try {
              const parsedTags = JSON.parse(cachedTags);
              if (Array.isArray(parsedTags) && parsedTags.includes(tag)) {
                // Extract the actual cache key from tag key
                const actualKey = tagKey.replace('cache:tags:', '');
                await redisClient.del(actualKey, tagKey).catch(() => {
                  // Ignore delete errors
                });
              }
            } catch {
              // Invalid tag data, skip
            }
          }
        }
      }
    }
  } catch (error: any) {
    // Silently handle invalidation errors - cache invalidation is best effort
    const errorMsg = error?.message || 'Unknown error';
    if (!errorMsg.includes('ECONNREFUSED') && 
        !errorMsg.includes('ENOTFOUND') &&
        !errorMsg.includes('SCAN timeout')) {
      const tagList = Array.isArray(tags) ? tags.slice(0, 5).join(',') : '<invalid>';
      console.warn(`[CACHE] Failed to invalidate by tags: ${tagList}`, errorMsg);
    }
  }
}

/**
 * Prisma query wrapper with automatic performance monitoring
 */
export function prismaWithMetrics<T>(
  label: string,
  query: () => Promise<T>
): Promise<T> {
  return measureTime(`db:${label}`, query, true).then(({ result }) => result);
}

/**
 * Common cache key generators
 * All keys are automatically sanitized when used in withCache()
 */
export const cacheKeys = {
  property: (id: number) => {
    if (!Number.isFinite(id) || id < 0) {
      throw new Error(`Invalid property ID: ${id}`);
    }
    return publicCacheKey("property", { id });
  },
  propertyList: (params: Record<string, any>) => {
    // Sanitize params before JSON.stringify to prevent injection
    const sanitized: Record<string, any> = {};
    for (const [key, value] of Object.entries(params || {})) {
      // Include safe primitive values and arrays of primitives so filter-based
      // cache keys (e.g. types, amenities) do not collide with unfiltered queries.
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
        const safeKey = String(key).replace(/[^\w]/g, '_').substring(0, 50);
        sanitized[safeKey] = value;
      } else if (Array.isArray(value)) {
        const safeKey = String(key).replace(/[^\w]/g, '_').substring(0, 50);
        const safeArray = value
          .filter((item) => item === null || typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean')
          .map((item) => (typeof item === 'string' ? item.trim() : item));
        sanitized[safeKey] = safeArray;
      }
    }
    return publicCacheKey("properties-list", sanitized);
  },
  adminSummary: () => adminCacheKey("summary"),
  adminPerformanceHighlights: (days: number) => {
    const d = Number(days);
    if (!Number.isFinite(d) || d <= 0 || d > 3650) {
      throw new Error(`Invalid days: ${days}`);
    }
    return adminCacheKey("performance-highlights", { days: Math.round(d) });
  },
  propertyCount: (status: string) => {
    if (!status || typeof status !== 'string') {
      throw new Error(`Invalid status: ${status}`);
    }
    const safeStatus = status.replace(/[^\w]/g, '_').substring(0, 50);
    return adminCacheKey("property-count", { status: safeStatus });
  },
  bookingCount: (status: string) => {
    if (!status || typeof status !== 'string') {
      throw new Error(`Invalid status: ${status}`);
    }
    const safeStatus = status.replace(/[^\w]/g, '_').substring(0, 50);
    return adminCacheKey("booking-count", { status: safeStatus });
  },
};

/**
 * Cache tags for invalidation
 */
export const cacheTags = {
  property: (id: number) => `property:${id}`,
  propertyList: 'property:list',
  user: (id: number) => `user:${id}`,
  booking: (id: number) => `booking:${id}`,
  adminSummary: 'admin:summary',
  adminPerformanceHighlights: 'admin:performance:highlights',
};

