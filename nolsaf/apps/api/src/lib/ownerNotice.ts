import { prisma } from "@nolsaf/prisma";

/**
 * Puts a notice in an owner's in-app inbox and pushes it to their open
 * sessions only. Returns whether the inbox row was written, so callers can
 * tell the admin the truth instead of assuming delivery.
 *
 * Never broadcast owner messages with io.emit: that reaches every connected
 * client, guests and other owners included.
 */
export async function deliverOwnerNotice(
  ownerId: number,
  notice: { title: string; body: string; type?: string; meta?: Record<string, unknown> },
): Promise<boolean> {
  try {
    const created = await prisma.notification.create({
      data: {
        ownerId,
        userId: ownerId,
        title: notice.title.slice(0, 200),
        body: notice.body,
        unread: true,
        type: (notice.type ?? "admin").slice(0, 50),
        meta: (notice.meta ?? {}) as any,
      },
    });
    try {
      const io = (global as any).io;
      if (io && typeof io.to === "function") {
        const payload = { id: created.id, ownerId, type: created.type, title: created.title, body: created.body, createdAt: created.createdAt };
        io.to(`owner:${ownerId}`).emit("notification:new", payload);
        io.to(`user:${ownerId}`).emit("notification:new", { ...payload, userId: ownerId });
      }
    } catch {
      // The inbox row is the delivery; the push is best effort.
    }
    return true;
  } catch (err: any) {
    console.error("[ownerNotice] could not deliver", ownerId, err?.message || err);
    return false;
  }
}

/** An owner who can still receive messages: exists, is an owner, not deleted or disabled. */
export async function findReachableOwner(ownerId: number) {
  if (!Number.isInteger(ownerId) || ownerId <= 0) return null;
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true, email: true, role: true, deletedAt: true, isDisabled: true },
  });
  if (!owner || owner.role !== "OWNER" || owner.deletedAt || owner.isDisabled) return null;
  return owner;
}
