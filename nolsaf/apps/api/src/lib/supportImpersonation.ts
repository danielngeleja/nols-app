import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { getRoleSessionMaxMinutes, getSessionIdleMinutes } from "./securitySettings.js";
import { getImpersonationHandoffHandle } from "./sessionManager.js";
import type { AuthedUser } from "../middleware/auth.js";

const SUPPORT_TTL_SECONDS = 10 * 60;

function hashHandle(handle: string): string {
  return crypto.createHash("sha256").update(handle).digest("hex");
}

export async function createSupportHandoff(
  adminToken: string,
  admin: AuthedUser,
  supportToken: string,
  supportRole: "OWNER" | "AGENT",
): Promise<string> {
  const adminClaims = jwt.decode(adminToken) as jwt.JwtPayload | null;
  const supportClaims = jwt.decode(supportToken) as jwt.JwtPayload | null;
  const adminMfa = adminClaims?.amr;
  const adminIssuedAt = adminClaims?.iat;
  const adminExpiresAt = adminClaims?.exp;
  const supportSessionId = supportClaims?.sid;
  const supportUserId = Number(supportClaims?.sub);
  if (
    admin.role !== "ADMIN" || !admin.sessionId ||
    (adminMfa !== "passkey" && adminMfa !== "totp") ||
    !Number.isInteger(adminIssuedAt) || !Number.isInteger(adminExpiresAt) ||
    typeof supportSessionId !== "string" || !supportSessionId ||
    !Number.isSafeInteger(supportUserId) || supportUserId <= 0 ||
    supportClaims?.imp !== true || supportClaims?.act !== admin.id
  ) throw new Error("Invalid support handoff session");

  const handle = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Math.min(
    Date.now() + SUPPORT_TTL_SECONDS * 1000,
    Number(adminExpiresAt) * 1000,
    Number(supportClaims.exp || 0) * 1000,
  ));
  if (expiresAt.getTime() <= Date.now()) throw new Error("Support handoff has expired");
  await prisma.supportImpersonationHandoff.create({
    data: {
      handleHash: hashHandle(handle),
      adminId: admin.id,
      adminSessionId: admin.sessionId,
      adminIssuedAt: Number(adminIssuedAt),
      adminExpiresAt: Number(adminExpiresAt),
      adminMfa,
      supportUserId,
      supportSessionId,
      supportRole,
      expiresAt,
    },
  });
  return handle;
}

async function activeAdmin(handoff: {
  adminId: number;
  adminSessionId: string;
  adminIssuedAt: number;
  adminExpiresAt: number;
  adminMfa: string;
}) {
  if (handoff.adminMfa !== "passkey" && handoff.adminMfa !== "totp") return false;
  const now = Date.now();
  if (handoff.adminExpiresAt * 1000 <= now) return false;
  const maxMinutes = await getRoleSessionMaxMinutes("ADMIN");
  if (now - handoff.adminIssuedAt * 1000 > maxMinutes * 60_000) return false;
  const session = await prisma.session.findFirst({
    where: { id: handoff.adminSessionId, userId: handoff.adminId, revokedAt: null },
    select: {
      lastSeenAt: true,
      user: { select: { role: true, suspendedAt: true, isDisabled: true, tokensValidAfter: true } },
    },
  });
  const user = session?.user;
  if (!session || !user || user.role !== "ADMIN" || user.suspendedAt || user.isDisabled) return false;
  if (user.tokensValidAfter && handoff.adminIssuedAt < Math.floor(user.tokensValidAfter.getTime() / 1000)) return false;
  const idleMinutes = await getSessionIdleMinutes();
  return now - session.lastSeenAt.getTime() <= Math.max(1, idleMinutes) * 60_000;
}

export async function getActiveSupportHandoff(cookieHeader: string | undefined) {
  const handle = getImpersonationHandoffHandle(cookieHeader);
  if (!handle || !/^[A-Za-z0-9_-]{43}$/.test(handle)) return null;
  const handoff = await prisma.supportImpersonationHandoff.findUnique({ where: { handleHash: hashHandle(handle) } });
  if (!handoff || handoff.usedAt || handoff.expiresAt.getTime() <= Date.now()) return null;
  if (!(await activeAdmin(handoff))) return null;
  return handoff;
}

export function supportHandoffMatchesUser(
  handoff: { adminId: number; supportUserId: number; supportSessionId: string; supportRole: string },
  current: AuthedUser | undefined,
): boolean {
  return Boolean(current?.imp
    && current.sessionId === handoff.supportSessionId
    && current.id === handoff.supportUserId
    && current.role === handoff.supportRole
    && current.impersonatorId === handoff.adminId);
}

export async function consumeSupportHandoff(handleHash: string): Promise<boolean> {
  const result = await prisma.supportImpersonationHandoff.updateMany({
    where: { handleHash, usedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  });
  return result.count === 1;
}
