import "./env";
import express from "express";
import http from "http";
import morgan from "morgan";
import { adminOriginGuard } from "./middleware/adminOriginGuard.js";
import { csrfProtection, csrfTokenHeader } from "./middleware/csrf.js";
import { performanceMiddleware } from "./middleware/performance.js";
import { requestIdMiddleware } from "./middleware/requestId.js";
import { getRedis } from "./lib/redis.js";
import { redactSensitiveUrl } from "./lib/safeAccessLog.js";
import {
  registerApiRoutes,
  registerEarlyRoutes,
  registerFallbackHandlers,
  registerRouteBodyParsers,
} from "./routes";
import { configureSecurity } from "./security";
import { createSocketServer } from "./sockets";
import { startBackgroundWorkers } from "./workers";

export { emitReferralNotification, emitReferralUpdate } from "./sockets";

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function shouldStartSocketServer(): boolean {
  const configured = process.env.SOCKET_SERVER_ENABLED ?? process.env.RUN_SOCKET_SERVER;
  if (configured == null || String(configured).trim() === "") {
    return process.env.NODE_ENV !== "test";
  }
  return isEnabled(configured);
}

const app = express();

morgan.token("safe-url", (req) =>
  redactSensitiveUrl((req as express.Request).originalUrl || req.url),
);

// Do not advertise the application framework in every response.
app.disable("x-powered-by");

app.use(requestIdMiddleware);
registerEarlyRoutes(app);

// ─── MAINTENANCE MODE ───
// Set MAINTENANCE_MODE=true in environment to block all non-health traffic.
if (process.env.MAINTENANCE_MODE === "true") {
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    // Allow health checks through so load balancers stay happy
    if (req.path === "/health" || req.path === "/api/health") return next();
    res.status(503).json({
      error: "maintenance",
      message: "NoLSAF is currently undergoing scheduled maintenance. Please try again shortly.",
    });
  });
}
// ────

const server = http.createServer(app);
const io = shouldStartSocketServer() ? createSocketServer(server, app) : null;

if (io) {
  startBackgroundWorkers(io);
} else if (process.env.NODE_ENV !== "test") {
  console.log("[socket] Socket server disabled for this process.");
  if (String(process.env.RUN_BACKGROUND_WORKERS || "").trim().toLowerCase() === "true") {
    console.warn("[workers] RUN_BACKGROUND_WORKERS=true but socket server is disabled, so background workers were not started.");
  }
}

// Global security middleware (CSP, CORS, HPP, rate limit).
configureSecurity(app);

// Admin CSRF mitigation (production): block cross-site state-changing requests.
app.use(adminOriginGuard as express.RequestHandler);
// Compatibility-safe CSRF layer: emits tokens on GET and blocks explicit cross-site
// cookie-auth mutations while existing same-site app requests continue to work.
app.use(csrfTokenHeader as express.RequestHandler);
app.use(csrfProtection as express.RequestHandler);

registerRouteBodyParsers(app);

// JSON parser with size limits for security (applied after route-specific limits).
app.use(express.json({
  limit: "100kb",
  strict: true,
}));
app.use(express.urlencoded({
  extended: true,
  limit: "100kb",
  parameterLimit: 50,
}));
app.use(
  process.env.NODE_ENV === "production"
    ? morgan(':remote-addr :method :safe-url :status :res[content-length] - :response-time ms', {
        skip: (_req, res) => res.statusCode < 400,
      })
    : morgan("dev")
);
// Performance monitoring middleware should be early to capture all requests.
app.use(performanceMiddleware);

// Generic rate limit is already applied via configureSecurity; route-specific
// limits are kept inside the mounted routers/route registrar.
registerApiRoutes(app);
registerFallbackHandlers(app);

export { app, server };

// Start server (skip during tests so Vitest can import this module safely).
if (process.env.NODE_ENV !== "test") {
  // Eagerly initialize Redis so the client reaches "ready" before the first
  // request; otherwise lazyConnect keeps it at "wait" and cache checks are bypassed.
  getRedis();

  const PORT = Number(process.env.PORT) || 4000;
  const HOST = process.env.HOST;

  if (HOST) {
    server.listen(PORT, HOST, () => {
      console.log(`Server listening on http://${HOST}:${PORT}`);
    });
  } else {
    server.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  }

  server.on("error", (err) => {
    console.error("HTTP server error:", err);
  });
}
