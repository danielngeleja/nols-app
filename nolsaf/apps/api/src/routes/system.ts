import express, { type Express, type Request, type Response } from "express";
import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { limitCodeSearch } from "../middleware/rateLimit.js";
import { healthRouter } from "./health";

// Tight limiter for unknown-route probes (scanner / recon traffic).
// An IP hitting more than 20 unknown routes per minute is almost certainly a bot.
const unknownRouteLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests." },
  skipSuccessfulRequests: false,
});

export function registerEarlyRoutes(app: Express): void {
  // Health check endpoints must stay before other routes for load balancer/probe access.
  app.use("/", healthRouter);

  app.post("/codes/search", limitCodeSearch, async (_req, res) => {
    // TODO: implement actual search logic; keep a simple placeholder response to avoid runtime errors.
    res.status(200).json({ message: "Codes search endpoint" });
  });
}

export function registerRouteBodyParsers(app: Express): void {
  // AzamPay signs the exact callback bytes. This must be registered before the
  // global JSON parser; the raw parser inside the payment router is mounted too
  // late to recover bytes that express.json() has already consumed.
  app.use(
    "/webhooks/azampay",
    express.raw({ type: ["application/json", "text/plain"], limit: "1mb" }),
  );
  // Expedia webhook signatures cover the exact bytes received. Keep this
  // route raw and tightly bounded before the global JSON parser runs.
  app.use("/webhooks/expedia", express.raw({ type: "application/json", limit: "256kb" }));
  // Meta signs the exact Instagram/WhatsApp request bytes.
  app.use("/webhooks/meta", express.raw({ type: "application/json", limit: "512kb" }));
  // Apply larger body size limit for property routes BEFORE global middleware.
  app.use("/owner/properties", express.json({ limit: "25mb", strict: true }));
  app.use("/owner/properties", express.urlencoded({ extended: true, limit: "25mb", parameterLimit: 200 }));
  app.use("/api/owner/properties", express.json({ limit: "25mb", strict: true }));
  app.use("/api/owner/properties", express.urlencoded({ extended: true, limit: "25mb", parameterLimit: 200 }));
}

export function registerFallbackHandlers(app: Express): void {
  app.use(unknownRouteLimiter, (req: Request, res: Response) => {
    res.setHeader("Content-Type", "application/json");
    res.status(404).json({ error: "Not found" });
  });

  app.use(errorHandler);
}
