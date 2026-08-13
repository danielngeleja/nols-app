import type { Express } from "express";
import type { Server as HttpServer } from "http";
import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import Redis from "ioredis";
import { prisma } from "@nolsaf/prisma";
import { monitorSocketSessionPolicy, socketAuthMiddleware, verifyToken, type AuthenticatedSocket } from "../middleware/socketAuth.js";
import { touchActiveUser } from "../lib/activePresence.js";
import {
  getProtectedDriverAccessDenial,
  getProtectedDriverState,
  isDriverApprovedForProtectedAccess,
} from "../lib/driverAccess.js";

type SocketUser = NonNullable<AuthenticatedSocket["data"]["user"]>;

/**
 * Joins the rooms an authenticated socket needs so server-side emits reach it:
 * the per-user room (notifications/inbox) and, for drivers, the driver room and
 * the available-drivers room (derived from persisted availability). Safe to call
 * more than once — Socket.IO room joins are idempotent.
 */
async function joinAuthenticatedRooms(socket: AuthenticatedSocket, user: SocketUser): Promise<void> {
  try { socket.join(`user:${user.id}`); } catch {}
  if (user.role !== "DRIVER") return;

  try { socket.join(`driver:${user.id}`); } catch {}
  // Best-effort: join/leave the available-drivers room from DB state on connect.
  try {
    const driverState = await getProtectedDriverState(user.id);
    let isAvailable = false;
    try {
      if ((prisma as any).driverAvailability) {
        const row = await (prisma as any).driverAvailability.findUnique({
          where: { driverId: user.id },
          select: { available: true },
        });
        isAvailable = Boolean(row?.available);
      } else {
        const row = await prisma.user.findUnique({ where: { id: user.id }, select: { available: true } });
        isAvailable = Boolean(row?.available ?? false);
      }
    } catch {
      isAvailable = false;
    }
    if (isAvailable && isDriverApprovedForProtectedAccess(driverState)) socket.join("drivers:available");
    else socket.leave("drivers:available");
  } catch {
    // ignore
  }
}

let ioRef: SocketServer | null = null;
let warnedAboutMissingIo = false;
function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on", "redis"].includes(String(value || "").trim().toLowerCase());
}

function buildSocketAllowedOrigins(): string[] {
  const localOrigins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3001",
  ];

  const envOrigins = [
    process.env.WEB_ORIGIN || "",
    process.env.APP_ORIGIN || "",
    ...(process.env.CORS_ORIGIN || "").split(",").map((s) => s.trim()),
  ].filter(Boolean);

  const defaultOrigins = process.env.NODE_ENV === "production" ? [] : localOrigins;
  return Array.from(new Set([...defaultOrigins, ...envOrigins]));
}

function isSocketOriginAllowed(origin: string | null | undefined, allowedOrigins: string[]): boolean {
  if (!origin) return true;
  if (allowedOrigins.includes(origin)) return true;
  if (process.env.NODE_ENV === "production") return false;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function shouldUseSocketRedisAdapter(): boolean {
  return isEnabled(process.env.SOCKET_IO_REDIS_ADAPTER) || isEnabled(process.env.SOCKET_IO_ADAPTER);
}

function getSocketRedisUrl(): string | null {
  return process.env.SOCKET_IO_REDIS_URL || process.env.REDIS_URL || null;
}

async function configureSocketRedisAdapter(io: SocketServer): Promise<void> {
  if (!shouldUseSocketRedisAdapter()) return;

  const redisUrl = getSocketRedisUrl();
  if (!redisUrl) {
    console.warn("[SOCKET] Redis adapter requested but SOCKET_IO_REDIS_URL/REDIS_URL is not configured.");
    return;
  }

  const pubClient = new Redis(redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: null,
  });
  const subClient = pubClient.duplicate();

  const onError = (label: string) => (err: Error) => {
    console.error(`[SOCKET] Redis ${label} error:`, err.message);
  };

  pubClient.on("error", onError("pub"));
  subClient.on("error", onError("sub"));

  try {
    await Promise.all([pubClient.connect(), subClient.connect()]);
    io.adapter(createAdapter(pubClient, subClient));
    console.log("[SOCKET] Redis adapter enabled for multi-instance Socket.IO.");
  } catch (err: any) {
    console.error("[SOCKET] Redis adapter failed to start; using local in-memory Socket.IO adapter.", err?.message || err);
    try { pubClient.disconnect(); } catch {}
    try { subClient.disconnect(); } catch {}
  }
}

export function createSocketServer(server: HttpServer, app: Express): SocketServer {
  const socketAllowedOrigins = buildSocketAllowedOrigins();
  const io = new SocketServer(server, {
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        return callback(null, isSocketOriginAllowed(origin, socketAllowedOrigins));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  ioRef = io;
  (global as any).io = io;
  app.set("io", io);

  io.use(socketAuthMiddleware);
  void configureSocketRedisAdapter(io);
  registerSocketHandlers(io);

  return io;
}

function registerSocketHandlers(io: SocketServer): void {
  io.on("connection", (socket: AuthenticatedSocket) => {
    // `user` is reassigned by the `authenticate` recovery handler below, so every
    // event handler in this closure reads the latest value (not a connect-time snapshot).
    let user = socket.data.user;
    console.log("Socket connected", socket.id, user ? `(user: ${user.id}, role: ${user.role})` : "(unauthenticated)");

    // Auto-join basic rooms for authenticated users so server-side emits can be scoped safely.
    // This avoids relying on every client to explicitly call join events.
    if (user?.id) {
      void joinAuthenticatedRooms(socket, user);
    }

    // Late authentication recovery.
    //
    // Clients that read their token asynchronously (e.g. the native app reading
    // SecureStore) may connect before the token is available, so the handshake
    // arrives without it and the socket is unauthenticated. Such a client can emit
    // `authenticate` once the token is ready to upgrade this same connection and
    // join its rooms — no reconnect needed.
    socket.on("authenticate", async (data: string | { token?: string } | undefined, callback?: (response: any) => void) => {
      try {
        const token = typeof data === "string" ? data : data?.token;
        if (!token) {
          if (callback) callback({ error: "token_required" });
          return;
        }
        const verified = await verifyToken(token);
        if (!verified) {
          if (callback) callback({ error: "invalid_token" });
          return;
        }
        socket.data.user = verified;
        user = verified;
        monitorSocketSessionPolicy(socket);
        try { touchActiveUser(verified.id, verified.role); } catch {}
        await joinAuthenticatedRooms(socket, verified);
        if (callback) callback({ status: "ok", userId: verified.id, role: verified.role });
      } catch {
        if (callback) callback({ error: "failed" });
      }
    });

    // Driver availability (socket): persists + updates room membership for offer broadcasts.
    // Payload: { available: boolean }
    socket.on("driver:availability:set", async (data: { available: boolean }, callback?: (response: any) => void) => {
      try {
        if (!user || user.role !== "DRIVER") {
          if (callback) callback({ error: "Unauthorized" });
          return;
        }
        const driverState = await getProtectedDriverState(user.id);
        const denial = getProtectedDriverAccessDenial(driverState);
        if (denial) {
          try {
            socket.leave("drivers:available");
          } catch {
            // ignore
          }
          if (callback) callback({ error: denial.code, message: denial.message });
          return;
        }
        const available = (data as any)?.available;
        if (typeof available !== "boolean") {
          if (callback) callback({ error: "available must be boolean" });
          return;
        }

        // Best-effort persistence.
        try {
          if ((prisma as any).driverAvailability) {
            await (prisma as any).driverAvailability.upsert({
              where: { driverId: user.id },
              update: { available, updatedAt: new Date() },
              create: { driverId: user.id, available, updatedAt: new Date() },
            });
          } else {
            try {
              await prisma.user.update({ where: { id: user.id }, data: { available } as any });
            } catch {
              // ignore
            }
          }
        } catch {
          // ignore persistence errors
        }

        // Maintain room membership used for offer broadcasts.
        if (available) socket.join("drivers:available");
        else socket.leave("drivers:available");

        // Notify interested clients (maps/admin dashboards).
        try {
          io.emit("driver:availability:update", { driverId: user.id, available });
        } catch {
          // ignore
        }

        if (callback) callback({ status: "ok", available });
      } catch (e) {
        if (callback) callback({ error: "failed" });
      }
    });

    // Handle driver room joining for referral updates
    socket.on("join-driver-room", async (data: { driverId: string | number }, callback?: (response: any) => void) => {
      if (!data.driverId) {
        if (callback) callback({ error: "driverId required" });
        return;
      }

      const driverId = Number(data.driverId);
      // Verify user is the driver or an admin
      if (!user || (user.id !== driverId && user.role !== "ADMIN")) {
        if (callback) callback({ error: "Unauthorized" });
        return;
      }

      const room = `driver:${driverId}`;
      socket.join(room);
      console.log(`Driver ${driverId} joined room ${room}`);
      if (callback) callback({ status: "ok", room });
    });

    // Handle driver room leaving
    socket.on("leave-driver-room", (data: { driverId: string | number }, callback?: (response: any) => void) => {
      if (!data.driverId) {
        if (callback) callback({ error: "driverId required" });
        return;
      }

      const room = `driver:${data.driverId}`;
      socket.leave(room);
      if (callback) callback({ status: "ok" });
    });

    // Transport booking room: used for route-stage and linked driver-location events.
    socket.on("join-transport-booking", async (data: { bookingId: string | number }, callback?: (response: any) => void) => {
      try {
        if (!data.bookingId) {
          if (callback) callback({ error: "bookingId required" });
          return;
        }

        const bookingId = Number(data.bookingId);
        if (!Number.isFinite(bookingId)) {
          if (callback) callback({ error: "Invalid bookingId" });
          return;
        }
        if (!user) {
          if (callback) callback({ error: "Unauthorized" });
          return;
        }

        const booking = await prisma.transportBooking.findUnique({
          where: { id: bookingId },
          select: { id: true, userId: true, driverId: true },
        });
        if (!booking) {
          if (callback) callback({ error: "not_found" });
          return;
        }

        const role = String(user.role || "").toUpperCase();
        const allowed =
          role === "ADMIN" ||
          Number(booking.userId) === Number(user.id) ||
          (booking.driverId !== null && Number(booking.driverId) === Number(user.id));

        if (!allowed) {
          if (callback) callback({ error: "Unauthorized" });
          return;
        }

        const room = `transport:${booking.id}`;
        socket.join(room);
        if (callback) callback({ status: "ok", room });
      } catch {
        if (callback) callback({ error: "failed" });
      }
    });

    socket.on("leave-transport-booking", (data: { bookingId: string | number }, callback?: (response: any) => void) => {
      if (!data.bookingId) {
        if (callback) callback({ error: "bookingId required" });
        return;
      }

      const bookingId = Number(data.bookingId);
      if (!Number.isFinite(bookingId)) {
        if (callback) callback({ error: "Invalid bookingId" });
        return;
      }

      socket.leave(`transport:${bookingId}`);
      if (callback) callback({ status: "ok" });
    });

    // Handle property availability room joining (for real-time updates)
    socket.on("join-property-availability", async (data: { propertyId: string | number }, callback?: (response: any) => void) => {
      if (!data.propertyId) {
        if (callback) callback({ error: "propertyId required" });
        return;
      }

      const propertyId = Number(data.propertyId);
      if (isNaN(propertyId)) {
        if (callback) callback({ error: "Invalid propertyId" });
        return;
      }

      // Verify user is owner of property or admin
      if (user) {
        if (user.role === "ADMIN") {
          const room = `property:${propertyId}:availability`;
          socket.join(room);
          console.log(`User ${user.id} (${user.role}) joined property availability room ${room}`);
          if (callback) callback({ status: "ok", room });
          return;
        }

        if (user.role === "OWNER") {
          const property = await prisma.property.findFirst({
            where: {
              id: propertyId,
              ownerId: user.id,
            },
            select: { id: true },
          });

          if (property) {
            const room = `property:${propertyId}:availability`;
            socket.join(room);
            console.log(`Owner ${user.id} joined property availability room ${room}`);
            if (callback) callback({ status: "ok", room });
            return;
          }
        }
      }

      // Allow public connections to property availability (for real-time checking)
      const room = `property:${propertyId}:availability:public`;
      socket.join(room);
      console.log(`Public user joined property availability room ${room}`);
      if (callback) callback({ status: "ok", room, public: true });
    });

    // Handle property availability room leaving
    socket.on("leave-property-availability", (data: { propertyId: string | number }, callback?: (response: any) => void) => {
      if (!data.propertyId) {
        if (callback) callback({ error: "propertyId required" });
        return;
      }

      const propertyId = Number(data.propertyId);
      if (isNaN(propertyId)) {
        if (callback) callback({ error: "Invalid propertyId" });
        return;
      }

      const room = `property:${propertyId}:availability`;
      const publicRoom = `property:${propertyId}:availability:public`;
      socket.leave(room);
      socket.leave(publicRoom);
      if (callback) callback({ status: "ok" });
    });

    // Generic user room (customers/owners can join for inbox messages + notifications)
    socket.on("join-user-room", (data: { userId: string | number }, callback?: (response: any) => void) => {
      if (!data.userId) {
        if (callback) callback({ error: "userId required" });
        return;
      }

      const userId = Number(data.userId);
      // Verify user is joining their own room or is an admin
      if (!user || (user.id !== userId && user.role !== "ADMIN")) {
        if (callback) callback({ error: "Unauthorized" });
        return;
      }

      const room = `user:${userId}`;
      socket.join(room);
      console.log(`User ${userId} joined room ${room}`);
      if (callback) callback({ status: "ok", room });
    });

    socket.on("leave-user-room", (data: { userId: string | number }, callback?: (response: any) => void) => {
      if (!data.userId) {
        if (callback) callback({ error: "userId required" });
        return;
      }

      const userId = Number(data.userId);
      // Verify user is leaving their own room or is an admin
      if (!user || (user.id !== userId && user.role !== "ADMIN")) {
        if (callback) callback({ error: "Unauthorized" });
        return;
      }

      const room = `user:${userId}`;
      socket.leave(room);
      console.log(`User ${userId} left room ${room}`);
      if (callback) callback({ status: "ok" });
    });

    // Owner room (legacy convenience; also join user room)
    socket.on("join-owner-room", (data: { ownerId: string | number }, callback?: (response: any) => void) => {
      if (!data.ownerId) {
        if (callback) callback({ error: "ownerId required" });
        return;
      }

      const ownerId = Number(data.ownerId);
      // Verify user is the owner or is an admin
      if (!user || (user.id !== ownerId && user.role !== "ADMIN")) {
        if (callback) callback({ error: "Unauthorized" });
        return;
      }

      const room = `owner:${ownerId}`;
      socket.join(room);
      socket.join(`user:${ownerId}`);
      console.log(`Owner ${ownerId} joined room ${room}`);
      if (callback) callback({ status: "ok", room });
    });

    socket.on("leave-owner-room", (data: { ownerId: string | number }, callback?: (response: any) => void) => {
      if (!data.ownerId) {
        if (callback) callback({ error: "ownerId required" });
        return;
      }

      const ownerId = Number(data.ownerId);
      // Verify user is the owner or is an admin
      if (!user || (user.id !== ownerId && user.role !== "ADMIN")) {
        if (callback) callback({ error: "Unauthorized" });
        return;
      }

      const room = `owner:${ownerId}`;
      socket.leave(room);
      socket.leave(`user:${ownerId}`);
      console.log(`Owner ${ownerId} left room ${room}`);
      if (callback) callback({ status: "ok" });
    });

    // Handle admin room joining
    socket.on("join-admin-room", async (callback?: (response: any) => void) => {
      if (!user || user.role !== "ADMIN") {
        if (callback) callback({ error: "Unauthorized: Admin access required" });
        return;
      }

      socket.join("admin");
      console.log(`Admin ${user.id} joined admin room`);
      if (callback) callback({ status: "ok", room: "admin" });
    });

    // Handle admin room leaving
    socket.on("leave-admin-room", (callback?: (response: any) => void) => {
      if (!user || user.role !== "ADMIN") {
        if (callback) callback({ error: "Unauthorized: Admin access required" });
        return;
      }

      socket.leave("admin");
      console.log(`Admin ${user.id} left admin room`);
      if (callback) callback({ status: "ok" });
    });

    socket.on("disconnect", () => console.log("Socket disconnected", socket.id));
  });
}

function getIo(): SocketServer | null {
  return ioRef;
}

/**
 * Immediately terminate every live socket for an account whose authorization
 * changed. With the Redis adapter, fetchSockets reaches every API instance.
 * The periodic database recheck remains the fail-safe when no adapter exists.
 */
export async function disconnectUserSockets(
  userId: number,
  code = "AUTHORIZATION_CHANGED",
  message = "Account authorization changed. Sign in again.",
): Promise<number> {
  if (!Number.isSafeInteger(userId) || userId <= 0) return 0;
  const io = getIo();
  if (!io) return 0;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  await Promise.all(sockets.map(async (socket: any) => {
    try { socket.emit("session:expired", { code, message }); } catch {}
    try { socket.disconnect(true); } catch {}
  }));
  return sockets.length;
}

export function emitReferralUpdate(driverId: string | number, referralData: any): void {
  const io = getIo();
  if (!io) {
    if (!warnedAboutMissingIo && process.env.NODE_ENV !== "test") {
      warnedAboutMissingIo = true;
      console.warn("[socket] Referral emit skipped because Socket.IO is not enabled on this process.");
    }
    return;
  }
  io.to(`driver:${driverId}`).emit("referral-update", referralData);
}

export function emitReferralNotification(driverId: string | number, notification: {
  type: "new_referral" | "referral_active" | "credits_earned";
  message: string;
  referralData?: any;
}): void {
  const io = getIo();
  if (!io) {
    if (!warnedAboutMissingIo && process.env.NODE_ENV !== "test") {
      warnedAboutMissingIo = true;
      console.warn("[socket] Referral emit skipped because Socket.IO is not enabled on this process.");
    }
    return;
  }
  io.to(`driver:${driverId}`).emit("referral-notification", notification);
}
