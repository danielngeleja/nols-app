// Centralized error handler middleware
// Prevents stack trace leaks in production
import { Request, Response, NextFunction } from 'express';
import { prisma } from "@nolsaf/prisma";
import { buildErrorDiagnostic } from "../lib/errorDiagnostics.js";
import { maskIpAddress, normalizeRoute } from "../lib/observability.js";

export interface AppError extends Error {
  status?: number;
  statusCode?: number;
  code?: string;
}

/**
 * Centralized error handler middleware
 * Should be used as the last middleware in the Express app
 */
export function errorHandler(
  err: AppError,
  req: Request,
  res: Response,
  next: NextFunction
) {
  // Log error details
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    timestamp: new Date().toISOString(),
  });

  const isProduction = process.env.NODE_ENV === 'production';

  // Determine status code
  const statusCode = err.status || err.statusCode || 500;

  if (statusCode >= 500) {
    (req as any).exceptionCaptured = true;
    const requestId = String((req as any).requestId || "") || null;
    const release = process.env.GIT_COMMIT_SHA
      || process.env.RAILWAY_GIT_COMMIT_SHA
      || process.env.VERCEL_GIT_COMMIT_SHA
      || process.env.APP_VERSION
      || null;

    void buildErrorDiagnostic({
      service: "api",
      message: err.message,
      stack: err.stack,
      source: "api",
      release,
    }).then((diagnostic) => prisma.auditLog.create({
      data: {
        actorId: (req as any).user?.id ?? null,
        actorRole: (req as any).user?.role ?? null,
        action: "SERVER_EXCEPTION",
        entity: "OBSERVABILITY",
        entityId: null,
        ip: maskIpAddress(req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || null),
        ua: req.headers["user-agent"]?.toString()?.slice(0, 255) || null,
        beforeJson: null,
        afterJson: {
          message: err.message?.slice(0, 500) || "Internal server error",
          name: err.name || "Error",
          code: err.code || null,
          stack: err.stack?.slice(0, 12_000) || null,
          method: req.method,
          path: req.path,
          route: normalizeRoute(req.path),
          statusCode,
          requestId,
          release,
          diagnostic,
          timestamp: new Date().toISOString(),
        },
      },
    })).catch((captureError: any) => {
      console.warn("[observability] failed to capture server exception", captureError?.message || captureError);
    });
  }

  // Prepare error response. Routes that deliberately throw a status < 500
  // (e.g. `throw new HttpError(404, "Group stay not found")`) are relayed
  // verbatim — that message was written to be shown to the client. A 500+ is
  // by definition an *unexpected* failure (an unhandled exception, a driver
  // error, ...), so its raw message may contain internals (hostnames, stack
  // fragments) that must never reach the client. The full message is still
  // captured above for SERVER_EXCEPTION audits, so nothing is lost, only kept
  // out of the response body.
  const clientSafeMessage = statusCode < 500
    ? (err.message || 'Request failed')
    : 'Internal server error. Our team has been notified.';

  const errorResponse: any = {
    error: clientSafeMessage,
    requestId: String((req as any).requestId || "") || undefined,
  };

  // Only include stack trace and detailed error in development
  if (!isProduction) {
    errorResponse.stack = err.stack;
    errorResponse.details = err;
    if (statusCode >= 500) errorResponse.devMessage = err.message;
  }

  // Add status code to response
  res.status(statusCode).json(errorResponse);
}

/**
 * Async error wrapper - wraps async route handlers to catch errors
 * Usage: router.get('/route', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

