import { prisma } from "@nolsaf/prisma";
import { Request } from "express";

export async function audit(req: Request, action: string, resource?: string, beforeJson?: any, afterJson?: any, entityId?: number | null) {
  const actorId = (req as any).user?.id as number | undefined;
  let actorRole = (req as any).user?.role as string | undefined;
  // Actions taken through an admin impersonation token are attributed to the
  // impersonated user id, so tag the role to keep them distinguishable.
  if (actorRole && (req as any).user?.imp) actorRole = `${actorRole}:IMP`;
  const ip = req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket.remoteAddress || "";
  const ua = req.headers["user-agent"] || "";
  try {
    await prisma.auditLog.create({
      data: { 
        actorId: actorId ?? null, 
        actorRole: actorRole ?? null, 
        action, 
        entity: resource || "SYSTEM",
        entityId: Number.isInteger(entityId as number) ? (entityId as number) : null,
        ip: ip || null, 
        ua: ua || null, 
        beforeJson: beforeJson ?? null, 
        afterJson: afterJson ?? null 
      },
    });
  } catch {
    // swallow
  }
}

export async function auditLog(params: {
  actorId: number;
  actorRole: string;
  action: string;
  entity: "PROPERTY";
  entityId: number;
  before?: any;
  after?: any;
  ip?: string;
  ua?: string;
}) {
  try {
    // write to the general AuditLog model for structured change history
    const created = await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        beforeJson: params.before ?? null,
        afterJson: params.after ?? null,
        ip: params.ip ?? null,
        ua: params.ua ?? null,
      },
    });
    console.log(`[audit] Created audit log: ${params.action} for ${params.entity} #${params.entityId} by ${params.actorRole} #${params.actorId}`);
    return created;
  } catch (e: any) {
    console.error("[audit fail] Failed to create audit log:", {
      error: e?.message || String(e),
      stack: e?.stack,
      code: e?.code,
      params: {
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        actorId: params.actorId,
        actorRole: params.actorRole,
      }
    });
    // Don't throw - audit logging should not break the main operation
    return null;
  }
}
// swallow errors