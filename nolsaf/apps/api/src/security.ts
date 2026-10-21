// apps/api/src/security.ts
import type { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { rateLimitWithRedis as rateLimit } from "./lib/redisRateLimitStore.js";
import { dynamicRateLimiter } from "./lib/rateLimiter.js";
import hpp from "hpp";

export function configureTrustProxy(app: Express) {
  // Production Elastic Beanstalk: client -> ALB -> nginx -> Express.
  // Trust nginx and the ALB, then use the address the ALB appended. Trusting
  // only nginx reports the ALB's private address for every client; trusting
  // more than two hops would let a client-supplied X-Forwarded-For entry win.
  app.set("trust proxy", process.env.NODE_ENV === "production" ? 2 : 1);
}

export function configureSecurity(app: Express) {
  configureTrustProxy(app);
  const isProduction = process.env.NODE_ENV === "production";

  // Strict headers + basic CSP (adjust CONNECT/IMG src for your domains)
  // Compute local dev origins for CSP and CORS
  const localDevOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:4000",
    "http://127.0.0.1:4000",
  ];
  const envOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaultOrigins = isProduction ? [] : localDevOrigins;
  const allowOrigins = Array.from(new Set([...defaultOrigins, ...envOrigins]));

  app.use(
    helmet({
      crossOriginOpenerPolicy: { policy: "same-origin" },
      crossOriginResourcePolicy: { policy: "cross-origin" }, // allow Cloudinary images
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          // Allow images from self, data, blob (for file uploads), https and local dev API/Web origins
          imgSrc: ["'self'", "data:", "blob:", "https:", ...allowOrigins],
          connectSrc: (
            [
              "'self'",
              process.env.NEXT_PUBLIC_SOCKET_URL || "",
            ].concat(
              allowOrigins
            )
          ).filter(Boolean),
          frameAncestors: ["'none'"],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: [],
        },
      },
      // Additional security headers
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true,
      xssFilter: true,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      permittedCrossDomainPolicies: false,
    })
  );

  // CORS: allow local dev by default + any values from CORS_ORIGIN
  const allow = allowOrigins;

  const corsOptions: cors.CorsOptions = {
    origin(origin, cb) {
      if (!origin) return cb(null, true); // same-origin or non-browser (curl, server-to-server)
      if (allow.includes(origin)) return cb(null, true);
      if (!isProduction) {
        try {
          const m = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
          if (m) return cb(null, true);
        } catch {
          // ignore regex errors and treat as disallowed
        }
      }
      // deny by default
      return cb(null, false);
    },
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "X-Requested-With",
      ...(process.env.NODE_ENV !== "production" ? ["x-role", "x-user-id"] : []),
    ],
    credentials: true,
  };
  app.use(cors(corsOptions));
  app.options("*", cors(corsOptions));

  // Param pollution protection
  app.use(hpp());

  // Generic rate limit - now uses dynamic rate limiting from SystemSetting
  try {
    app.use(dynamicRateLimiter);
  } catch (err) {
    console.error('Failed to use dynamic rate limiter, falling back to default:', err);
    // Fallback to default if dynamic limiter fails to load
    app.use(
      rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 1000,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        message: { error: "Too many requests, slow down." },
      })
    );
  }
}

// Per-route stricter limit (e.g., OTP, login)
export const tightLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many attempts, try later." },
});
