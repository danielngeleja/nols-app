import { prisma } from "@nolsaf/prisma";
import { invalidateAuthSessionCacheForUser } from "./authSessionCache.js";
import { requireTenantId } from "./tenantIsolation.js";

async function disconnectLiveUserSockets(userId: number): Promise<void> {
  const io = (global as any).io;
  if (!io?.in) return;
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  await Promise.all(sockets.map(async (socket: any) => {
    try { socket.emit("session:expired", { code: "SESSION_REVOKED", message: "Account authorization changed. Sign in again." }); } catch {}
    try { socket.disconnect(true); } catch {}
  }));
}

/**
 * Revoke every HTTP and Socket.IO session after a security-sensitive account
 * change. Current database state is still checked on every request, so this is
 * defense in depth and also forces clients to obtain a token with the new role.
 */
export async function revokeUserAuthorization(userId: number): Promise<void> {
  const id = requireTenantId(userId, "userId");
  const now = new Date();
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { tokensValidAfter: now } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await invalidateAuthSessionCacheForUser(id).catch(() => {});
  await disconnectLiveUserSockets(id).catch(() => {});
}
