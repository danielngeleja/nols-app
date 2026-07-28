// Socket.io authentication middleware
import { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { getRoleSessionMaxMinutes } from "../lib/securitySettings.js";
import { touchActiveUser } from "../lib/activePresence.js";

export interface AuthenticatedSocket extends Socket {
  data: {
    user?: {
      id: number;
      role: string;
      email?: string | null;
    };
  };
}

/** Shape of the JWT payload this app issues. */
interface JwtSocketPayload {
  sub: string | number;
  iat?: number;
  exp?: number;
}

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export async function verifyToken(token: string): Promise<{ id: number; role: string; email?: string | null } | null> {
  try {
    const secret =
      process.env.JWT_SECRET ||
      (process.env.NODE_ENV !== "production" ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret") : "");
    if (!secret) {
      return null;
    }

    const decoded = jwt.verify(token, secret) as JwtSocketPayload;
    if (!decoded || decoded.sub == null) {
      return null;
    }

    // Fetch user from DB to get current role (important for role changes)
    const userId = Number(decoded.sub);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true, suspendedAt: true, tokensValidAfter: true },
    });

    if (!user) {
      return null;
    }

    // Deny suspended users
    if (user.suspendedAt) {
      return null;
    }

    // Global revocation gate (mirrors HTTP auth): reject any token issued before
    // the user's tokensValidAfter cutoff.
    const issuedAtForCutoff = typeof decoded.iat === 'number' ? decoded.iat : Number(decoded.iat);
    const tokensValidAfter = (user as any).tokensValidAfter as Date | string | null | undefined;
    if (tokensValidAfter && Number.isFinite(issuedAtForCutoff)) {
      const validAfterSec = Math.floor(new Date(tokensValidAfter).getTime() / 1000);
      if (issuedAtForCutoff < validAfterSec) {
        return null;
      }
    }

    // Deny if all sessions have been explicitly revoked (e.g. admin demotion)
    const [totalSessions, activeSessions] = await Promise.all([
      (prisma.session as any).count({ where: { userId } }),
      (prisma.session as any).count({ where: { userId, revokedAt: null } }),
    ]);
    if (totalSessions > 0 && activeSessions === 0) {
      return null;
    }

    // Map role - ensure it's a string and handle CUSTOMER -> USER mapping
    const role = (user.role?.toUpperCase() || 'USER');
    const mappedRole = role === 'CUSTOMER' ? 'USER' : role;

    // Enforce dynamic per-role TTL based on token issuance time
    const issuedAtSec = typeof decoded.iat === 'number' ? decoded.iat : Number(decoded.iat);
    if (Number.isFinite(issuedAtSec) && issuedAtSec > 0) {
      const maxMinutes = await getRoleSessionMaxMinutes(mappedRole);
      const ageSec = Math.floor(Date.now() / 1000) - issuedAtSec;
      if (ageSec > maxMinutes * 60) {
        return null;
      }
    }

    return {
      id: user.id,
      role: mappedRole,
      email: user.email || null,
    };
  } catch (error) {
    return null;
  }
}

function getTokenFromSocket(socket: Socket): string | null {
  // Try Socket.IO auth payload (best for browsers)
  const authToken = (socket.handshake as any)?.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  // Try Authorization header first (if sent via handshake)
  const authHeader = socket.handshake.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  // Try cookies
  const cookies = parseCookies(socket.handshake.headers.cookie);
  return cookies["nolsaf_token"] || cookies["__Host-nolsaf_token"] || cookies["token"] || null;
}

/**
 * Socket.io authentication middleware
 * Validates JWT token from Authorization header or cookies
 * Allows unauthenticated connections but restricts their functionality
 */
export function socketAuthMiddleware(socket: AuthenticatedSocket, next: (err?: Error) => void) {
  const token = getTokenFromSocket(socket);

  // If no token, allow connection but mark as unauthenticated
  // The socket handlers should check socket.data.user before allowing sensitive operations
  if (!token) {
    socket.data.user = undefined;
    return next(); // Allow connection but without user data
  }

  verifyToken(token)
    .then((user) => {
      if (!user) {
        // Invalid token - allow connection but mark as unauthenticated
        socket.data.user = undefined;
        return next();
      }

      // Attach user to socket data
      socket.data.user = user;
      try {
        touchActiveUser(user.id, user.role);
      } catch {}
      next();
    })
    .catch(() => {
      // Token verification failed - allow connection but mark as unauthenticated
      socket.data.user = undefined;
      next();
    });
}

/**
 * Guard helper for socket event handlers.
 *
 * Call at the top of any handler that requires an authenticated user:
 *
 *   socket.on("some:event", (data) => {
 *     if (!requireSocketUser(socket)) return;
 *     // socket.data.user is guaranteed non-null here
 *   });
 *
 * Returns `true` when the user is present, emits an UNAUTHENTICATED error
 * and returns `false` otherwise — without disconnecting the socket so other
 * public listeners (e.g. driver-location tracking) keep working.
 */
export function requireSocketUser(
  socket: AuthenticatedSocket,
): socket is AuthenticatedSocket & { data: { user: NonNullable<AuthenticatedSocket["data"]["user"]> } } {
  if (socket.data.user) return true;
  socket.emit("error", { code: "UNAUTHENTICATED", message: "Authentication required" });
  return false;
}
