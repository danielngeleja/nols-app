import { rateLimitWithRedis as rateLimit } from "./redisRateLimitStore.js";
import { getApiRateLimitPerMinute } from "./securitySettings.js";

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_LIMIT = 100;
const PUBLIC_READ_LIMIT_PER_MINUTE = 900;

// Pre-create all rate limiters at module init time (required by express-rate-limit v7+)
const publicReadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: PUBLIC_READ_LIMIT_PER_MINUTE,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

const defaultLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: DEFAULT_LIMIT,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later." },
});

// Active limiter reference — swapped in background, never inside a request handler
let activeLimiter: ReturnType<typeof rateLimit> = defaultLimiter;

// Pool of pre-created limiters for known DB-driven values
const limiterPool = new Map<number, ReturnType<typeof rateLimit>>();

function getOrCreateLimiter(limit: number): ReturnType<typeof rateLimit> {
  if (!limiterPool.has(limit)) {
    if (limiterPool.size > 20) limiterPool.clear();
    limiterPool.set(limit, rateLimit({
      windowMs: 60 * 1000,
      limit,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: { error: "Too many requests, please try again later." },
    }));
  }
  return limiterPool.get(limit)!;
}

let lastRefresh = 0;

function isLoopbackDevelopmentRequest(req: any): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const remoteAddress = String(req.socket?.remoteAddress || "").toLowerCase();
  return remoteAddress === "::1" || remoteAddress === "127.0.0.1" || remoteAddress === "::ffff:127.0.0.1";
}

async function refreshActiveLimiter(): Promise<void> {
  const now = Date.now();
  if (now - lastRefresh < CACHE_TTL_MS) return;
  lastRefresh = now;
  try {
    const limit = await getApiRateLimitPerMinute();
    activeLimiter = getOrCreateLimiter(limit);
  } catch (err) {
    console.error("Failed to refresh rate limit from settings:", err);
  }
}

// Warm up on module load
refreshActiveLimiter().catch(() => {});

function isPublicReadRequest(req: any): boolean {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") return false;
  const path = String(req.path || req.originalUrl || "");
  return (
    path.startsWith("/api/public/properties") ||
    path.startsWith("/api/public/updates") ||
    path.startsWith("/api/public/agents") ||
    path.startsWith("/api/public/tourism-sites") ||
    path.startsWith("/api/public/podcasts") ||
    path.startsWith("/api/public/support") ||
    path.startsWith("/api/public/availability")
  );
}

export function dynamicRateLimiter(req: any, res: any, next: any) {
  // Local Next.js development proxies every browser request through one loopback
  // address. HMR and dashboard polling must not exhaust the shared production
  // IP bucket while developing; staging and production remain rate-limited.
  if (isLoopbackDevelopmentRequest(req)) return next();

  if (isPublicReadRequest(req)) {
    return publicReadLimiter(req, res, next);
  }

  // Refresh in background — never blocks, never creates a limiter inline
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
    const path = String(req.path || req.originalUrl || "");
    if (
      path.startsWith("/api/admin/drivers/trips") ||
      path.startsWith("/admin/drivers/trips") ||
      path.startsWith("/api/driver/trips")
    ) {
      return next();
    }
  }

  refreshActiveLimiter().catch(() => {});

  return activeLimiter(req, res, next);
}

