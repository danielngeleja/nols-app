// Socket.io authentication middleware
import { Socket } from "socket.io";
import type { Server as SocketServer } from "socket.io";
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
      /** Raw database role used for TTL policy lookup (CUSTOMER stays CUSTOMER). */
      sessionRole?: string;
      /** JWT issuance time used for dynamic policy enforcement. */
      sessionIssuedAtSec?: number;
      /** Exact revocable server-side session bound to this socket JWT. */
      sessionId?: string;
    };
  };
}

/** Shape of the JWT payload this app issues. */
interface JwtSocketPayload {
  sub: string | number;
  iat?: number;
  exp?: number;
  sid?: string;
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

export async function verifyToken(
  token: string,
): Promise<NonNullable<AuthenticatedSocket["data"]["user"]> | null> {
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

    const userId = Number(decoded.sub);
    const sessionId = typeof decoded.sid === "string" ? decoded.sid.trim() : "";
    if (!Number.isSafeInteger(userId) || userId <= 0 || !sessionId) return null;

    // Bind the socket JWT to its exact active session, mirroring HTTP auth.
    // Another active device must never keep this device's revoked token alive.
    const activeSession = await (prisma.session as any).findFirst({
      where: { id: sessionId, userId, revokedAt: null },
      select: {
        id: true,
        user: {
          select: {
            id: true, role: true, email: true, suspendedAt: true,
            isDisabled: true, tokensValidAfter: true,
            agentProfile: { select: { status: true } },
          },
        },
      },
    });
    const user = activeSession?.user;
    if (!user) return null;

    // Deny suspended users
    if (user.suspendedAt) {
      return null;
    }
    if (user.isDisabled) return null;
    if (String(user.role || "").toUpperCase() === "AGENT" && String(user.agentProfile?.status || "").toUpperCase() !== "ACTIVE") return null;

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

    // Map role - ensure it's a string and handle CUSTOMER -> USER mapping
    const role = (user.role?.toUpperCase() || 'USER');
    const mappedRole = role === 'CUSTOMER' ? 'USER' : role;

    // Enforce dynamic per-role TTL based on token issuance time
    const issuedAtSec = typeof decoded.iat === 'number' ? decoded.iat : Number(decoded.iat);
    if (Number.isFinite(issuedAtSec) && issuedAtSec > 0) {
      const maxMinutes = await getRoleSessionMaxMinutes(role);
      const ageSec = Math.floor(Date.now() / 1000) - issuedAtSec;
      if (ageSec > maxMinutes * 60) {
        return null;
      }
    }

    return {
      id: user.id,
      role: mappedRole,
      email: user.email || null,
      sessionRole: role,
      sessionIssuedAtSec: Number.isFinite(issuedAtSec) ? issuedAtSec : undefined,
      sessionId,
    };
  } catch (error) {
    return null;
  }
}

const socketPolicyTimers = new WeakMap<Socket, ReturnType<typeof setInterval>>();
const SOCKET_POLICY_RECHECK_MS = Math.max(
  5_000,
  Number(process.env.SOCKET_SESSION_POLICY_RECHECK_MS ?? 30_000) || 30_000,
);

type SocketAuthorizationFailure = "SESSION_EXPIRED" | "SESSION_REVOKED";

async function currentSocketAuthorizationFailure(socket: AuthenticatedSocket): Promise<SocketAuthorizationFailure | null> {
  const user = socket.data.user;
  const issuedAtSec = Number(user?.sessionIssuedAtSec);
  if (!user || !user.sessionId || !Number.isFinite(issuedAtSec) || issuedAtSec <= 0) return "SESSION_REVOKED";

  const activeSession = await (prisma.session as any).findFirst({
    where: { id: user.sessionId, userId: user.id, revokedAt: null },
    select: {
      user: {
        select: {
          role: true, suspendedAt: true, isDisabled: true, tokensValidAfter: true,
          agentProfile: { select: { status: true } },
        },
      },
    },
  });
  const current = activeSession?.user;
  if (!current || current.suspendedAt || current.isDisabled) return "SESSION_REVOKED";

  const rawRole = String(current.role || "USER").toUpperCase();
  if (rawRole === "AGENT" && String(current.agentProfile?.status || "").toUpperCase() !== "ACTIVE") return "SESSION_REVOKED";
  const mappedRole = rawRole === "CUSTOMER" ? "USER" : rawRole;
  if (rawRole !== user.sessionRole || mappedRole !== user.role) return "SESSION_REVOKED";

  const tokensValidAfter = current.tokensValidAfter as Date | string | null | undefined;
  if (tokensValidAfter) {
    const validAfterSec = Math.floor(new Date(tokensValidAfter).getTime() / 1000);
    if (issuedAtSec < validAfterSec) return "SESSION_REVOKED";
  }

  const maxMinutes = await getRoleSessionMaxMinutes(rawRole);
  return Math.floor(Date.now() / 1000) - issuedAtSec > maxMinutes * 60 ? "SESSION_EXPIRED" : null;
}

async function expireSocketIfNeeded(socket: AuthenticatedSocket): Promise<boolean> {
  const failure = await currentSocketAuthorizationFailure(socket);
  if (!failure) return false;
  socket.data.user = undefined;
  try {
    socket.emit("session:expired", {
      code: failure,
      message: failure === "SESSION_EXPIRED" ? "Session expired" : "Session revoked",
    });
  } catch {}
  try {
    socket.disconnect(true);
  } catch {}
  return true;
}

/** Re-arm continuous TTL enforcement after handshake or late authentication. */
export function monitorSocketSessionPolicy(socket: AuthenticatedSocket): void {
  const existing = socketPolicyTimers.get(socket);
  if (existing) clearInterval(existing);
  if (!socket.data.user?.sessionIssuedAtSec) return;

  const timer = setInterval(() => {
    void expireSocketIfNeeded(socket).catch(() => {});
  }, SOCKET_POLICY_RECHECK_MS);
  timer.unref?.();
  socketPolicyTimers.set(socket, timer);
  socket.once("disconnect", () => {
    clearInterval(timer);
    if (socketPolicyTimers.get(socket) === timer) socketPolicyTimers.delete(socket);
  });
}

/**
 * Apply a changed session policy to every currently connected socket. With the
 * Redis adapter, fetchSockets also reaches sockets owned by other API workers.
 */
export async function enforceSocketSessionPolicy(io: SocketServer): Promise<number> {
  const sockets = await io.fetchSockets();
  let expired = 0;
  await Promise.all(sockets.map(async (socket: any) => {
    if (await expireSocketIfNeeded(socket as AuthenticatedSocket)) expired += 1;
  }));
  return expired;
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
      monitorSocketSessionPolicy(socket);
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
