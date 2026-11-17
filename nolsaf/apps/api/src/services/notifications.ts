import { prisma } from "@nolsaf/prisma";

export type NotificationDto = {
  id: number | string;
  title: string;
  body: string;
  createdAt: Date;
  unread: boolean;
  meta?: any;
  type?: string | null;
};

/**
 * Fetch notifications for a user (admin, owner, driver, or customer).
 * Supports both ownerId (legacy) and userId (for drivers and other users).
 */
export async function fetchNotifications(opts: { tab?: 'unread' | 'viewed', page?: number, pageSize?: number, ownerId?: number, userId?: number }) {
  const { tab = 'unread', page = 1, pageSize = 20, ownerId, userId } = opts as any;
  const types: string[] | undefined = Array.isArray((opts as any)?.types)
    ? (opts as any).types.filter((t: any) => typeof t === 'string' && t.trim())
    : undefined;

  try {
    // Read from prisma.notification
    // newest-first
    const where: any = {};
    if (tab === 'unread') where.unread = true;
    else where.unread = false;
    
    // Support both ownerId (legacy) and userId (for drivers)
    if (userId) {
      where.userId = Number(userId);
    } else if (ownerId) {
      where.ownerId = Number(ownerId);
    }

    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const items = await prisma.notification.findMany({ 
      where, 
      orderBy: { createdAt: 'desc' }, 
      skip: (page - 1) * pageSize, 
      take: pageSize 
    });
    const total = await prisma.notification.count({ where });
    
    const unreadWhere: any = { unread: true, ...(userId ? { userId: Number(userId) } : ownerId ? { ownerId: Number(ownerId) } : {}) };
    if (types && types.length > 0) {
      unreadWhere.type = { in: types };
    }
    const totalUnread = await prisma.notification.count({ where: unreadWhere });

    const dto: NotificationDto[] = items.map((i) => ({ 
      id: i.id, 
      title: i.title, 
      body: i.body, 
      createdAt: i.createdAt, 
      unread: !!i.unread,
      meta: i.meta ?? null,
      type: (i as any).type ?? null,
    }));
    return { items: dto, total, totalUnread };
  } catch (err: any) {
    // Fallback gracefully if there's an error
    console.warn('notifications service: falling back to empty list due to error', err?.message ?? err);
    return { items: [] as NotificationDto[], totalUnread: 0 };
  }
}

export async function markNotificationRead(id: number | string, ownerId?: number, userId?: number, opts?: { types?: string[] }) {
  try {
    // Support both ownerId (legacy) and userId (for drivers)
    const where: any = { id: Number(id) };
    if (userId) {
      where.userId = Number(userId);
    } else if (ownerId) {
      where.ownerId = Number(ownerId);
    }

    const types = Array.isArray(opts?.types) ? opts?.types.filter((t) => typeof t === 'string' && t.trim()) : undefined;
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const r = await prisma.notification.updateMany({ 
      where, 
      data: { unread: false, readAt: new Date() } 
    });
    if (!r || (typeof r.count === 'number' && r.count === 0)) return { ok: false, error: 'not_found' };
    return { ok: true };
  } catch (err: any) {
    console.warn('markNotificationRead failed', err?.message ?? err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function deleteReadNotification(id: number | string, ownerId?: number, userId?: number, opts?: { types?: string[] }) {
  try {
    const where: any = { id: Number(id), unread: false };
    if (userId) {
      where.userId = Number(userId);
    } else if (ownerId) {
      where.ownerId = Number(ownerId);
    }

    const types = Array.isArray(opts?.types) ? opts?.types.filter((t) => typeof t === 'string' && t.trim()) : undefined;
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const r = await prisma.notification.deleteMany({ where });
    if (!r || (typeof r.count === 'number' && r.count === 0)) return { ok: false, error: 'not_found' };
    return { ok: true, deleted: r.count };
  } catch (err: any) {
    console.warn('deleteReadNotification failed', err?.message ?? err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function deleteReadNotifications(opts: { ownerId?: number; userId?: number; types?: string[] }) {
  try {
    const where: any = { unread: false };
    if (opts.userId) {
      where.userId = Number(opts.userId);
    } else if (opts.ownerId) {
      where.ownerId = Number(opts.ownerId);
    }

    const types = Array.isArray(opts.types) ? opts.types.filter((t) => typeof t === 'string' && t.trim()) : undefined;
    if (types && types.length > 0) {
      where.type = { in: types };
    }

    const r = await prisma.notification.deleteMany({ where });
    return { ok: true, deleted: r.count };
  } catch (err: any) {
    console.warn('deleteReadNotifications failed', err?.message ?? err);
    return { ok: false, error: String(err?.message ?? err) };
  }
}
