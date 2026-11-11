import { Router } from 'express';
import { prisma } from '@nolsaf/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { sanitizeText } from '../lib/sanitize.js';
import { ADMIN_NOTIFICATION_RETENTION_DAYS, adminKindOf, rowRequiresAction } from '../lib/adminNotificationKinds.js';
import { sweepAutoSettle } from '../lib/adminNotificationSettle.js';

// Close alerts whose matter was decided elsewhere before showing the inbox.
// At most once a minute per server, so opening the drawer stays fast.
let lastSettleAt = 0;
async function settleBeforeReading() {
  if (Date.now() - lastSettleAt < 60_000) return;
  lastSettleAt = Date.now();
  await sweepAutoSettle().catch((err: any) => console.error('[admin-notifications] auto-settle failed:', err?.message || err));
}

const router = Router();
const db = prisma as any;

// The admin inbox holds only what is addressed to admins: platform rows with no
// recipient (system, chatbot, operator-to-admin) and rows sent to this admin.
// Messages addressed to owners, operators, drivers or travellers belong to their
// own inboxes; reading them here would mark them read for the person they were
// meant for.
//
// It is NoLSAF's communication desk (lib/adminNotificationKinds.ts): nobody
// deletes an alert here. An alert that asks for action stays until an admin
// resolves it; read and resolved alerts clear automatically after 7 days.
const adminScope = (req: any) => ({
  OR: [{ userId: null, ownerId: null }, ...(req.user?.id ? [{ userId: Number(req.user.id) }] : [])],
});
// Note: requireAuth and requireRole are already applied in index.ts at route registration
// We keep it here as well for safety (double protection)
router.use(requireAuth as any, requireRole('ADMIN') as any);

/** Where an alert stands: new, seen but still needing someone, or done. */
export function lifecycleState(row: { unread: boolean; resolvedAt: Date | null; type?: string | null; meta?: unknown; requiresAction?: boolean | null }) {
  if (row.unread) return 'unread' as const;
  if (rowRequiresAction(row) && !row.resolvedAt) return 'open' as const;
  return 'resolved' as const;
}

/** Fields that mark a row read by this admin, and resolved too when it only informs. */
function readData(row: { readById?: number | null; resolvedAt?: Date | null; type?: string | null; meta?: unknown; requiresAction?: boolean | null }, adminId: number, now: Date) {
  const data: Record<string, unknown> = { unread: false, readAt: now };
  if (!row.readById) data.readById = adminId;
  if (!rowRequiresAction(row) && !row.resolvedAt) {
    data.resolvedAt = now;
    data.resolvedById = adminId;
  }
  return data;
}

// GET /api/admin/notifications?tab=unread|viewed|open&page=1&pageSize=20
router.get('/', asyncHandler(async (req, res) => {
  // Set Content-Type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  try {
    await settleBeforeReading();
    const tab = req.query.tab === 'viewed' ? 'viewed' : req.query.tab === 'open' ? 'open' : 'unread';
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 20)));

    const where: any = { ...adminScope(req) };
    if (tab === 'unread') {
      where.unread = true;
    } else if (tab === 'open') {
      // Seen, asks for action, not yet resolved. Rows from before the action
      // column are judged by their kind after the fetch.
      where.unread = false;
      where.resolvedAt = null;
    } else {
      where.unread = false;
    }

    const [rawItems, rawTotal, totalUnread] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: tab === 'open' ? 0 : (page - 1) * pageSize,
        take: tab === 'open' ? 500 : pageSize,
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      }),
      db.notification.count({ where }),
      db.notification.count({ where: { ...adminScope(req), unread: true } }),
    ]);
    const openItems = tab === 'open' ? rawItems.filter((row: any) => lifecycleState(row) === 'open') : rawItems;
    const items = tab === 'open' ? openItems.slice((page - 1) * pageSize, page * pageSize) : openItems;
    const total = tab === 'open' ? openItems.length : rawTotal;

    const propertyIds = Array.from(
      new Set(
        items
          .map((i: any) => {
            const propertyId = i.meta && typeof i.meta === 'object' ? Number((i.meta as any).propertyId) : NaN;
            return Number.isFinite(propertyId) ? propertyId : null;
          })
          .filter((id: number | null): id is number => id != null)
      )
    );
    const adminIds = Array.from(new Set(items.flatMap((i: any) => [i.readById, i.resolvedById]).filter((id: unknown): id is number => Number.isInteger(id))));
    const [properties, admins] = await Promise.all([
      propertyIds.length
        ? prisma.property.findMany({
            where: { id: { in: propertyIds as number[] } },
            select: {
              id: true,
              title: true,
              ownerId: true,
              owner: { select: { id: true, name: true, email: true } },
            },
          })
        : [],
      adminIds.length ? prisma.user.findMany({ where: { id: { in: adminIds as number[] } }, select: { id: true, name: true, fullName: true } as any }) : [],
    ]);
    const propertyById = new Map((properties as any[]).map((property) => [property.id, property]));
    const adminName = new Map((admins as any[]).map((a) => [a.id, a.fullName || a.name || `Admin #${a.id}`]));

    // Enrich notifications with property and owner info if available.
    const dto = items.map((i: any) => {
      const kind = adminKindOf(i);
      const baseDto: any = {
        id: i.id,
        type: i.type,
        title: i.title,
        body: i.body,
        createdAt: i.createdAt,
        unread: !!i.unread,
        meta: i.meta ?? null,
        kind: kind.key,
        severity: kind.severity,
        category: kind.category,
        priority: kind.severity === 'critical' ? 'urgent' : 'normal',
        requiresAction: rowRequiresAction(i),
        state: lifecycleState(i),
        readAt: i.readAt ?? null,
        readBy: i.readById ? adminName.get(i.readById) ?? null : null,
        resolvedAt: i.resolvedAt ?? null,
        resolvedBy: i.resolvedById ? adminName.get(i.resolvedById) ?? null : null,
        // Closed by the system because the matter was decided elsewhere.
        autoResolved: (i.meta as any)?.autoResolved ?? null,
        // When a settled alert will be cleared, so the inbox can say so.
        clearsAt: lifecycleState(i) === 'resolved' && (i.resolvedAt ?? i.readAt)
          ? new Date(new Date(i.resolvedAt ?? i.readAt).getTime() + ADMIN_NOTIFICATION_RETENTION_DAYS * 86_400_000)
          : null,
      };

      // If meta contains propertyId, fetch property details
      if (i.meta && typeof i.meta === 'object' && (i.meta as any).propertyId) {
        const propertyId = Number((i.meta as any).propertyId);
        const property = Number.isFinite(propertyId) ? propertyById.get(propertyId) : null;

        if (property) {
          // Enhance meta with property and owner info
          baseDto.meta = {
            ...(i.meta as any),
            propertyTitle: property.title,
            propertyId: property.id,
            ownerId: property.ownerId,
            ownerName: property.owner?.name || null,
            ownerEmail: property.owner?.email || null,
          };
        }
      }

      // If ownerId exists but not in meta, add owner info
      if (i.ownerId && (!baseDto.meta || !baseDto.meta.ownerName)) {
        if (i.owner) {
          baseDto.meta = {
            ...(baseDto.meta || {}),
            ownerId: i.ownerId,
            ownerName: i.owner.name || null,
            ownerEmail: i.owner.email || null,
          };
        }
      }

      return baseDto;
    });

    res.json({ items: dto, total, totalUnread, retentionDays: ADMIN_NOTIFICATION_RETENTION_DAYS });
  } catch (err: any) {
    console.error('GET /api/admin/notifications failed:', err?.message || err);
    console.error('Error stack:', err?.stack);

    // Check if it's a Prisma schema/table error
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2021' || err.code === 'P2022') {
        console.warn('Notification table may not exist or schema mismatch');
        return res.json({ items: [], total: 0, totalUnread: 0 });
      }
    }

    // Fail-open with empty list to avoid breaking admin UI
    res.json({ items: [], total: 0, totalUnread: 0 });
  }
}));

// POST /api/admin/notifications/mark-all-read
// Every unread alert in this admin's inbox, not just the ones on screen. Alerts
// that ask for action become "open" (still to resolve); the rest are settled.
router.post('/mark-all-read', asyncHandler(async (req: any, res) => {
  const adminId = Number(req.user.id);
  const now = new Date();
  const rows = await db.notification.findMany({
    where: { ...adminScope(req), unread: true },
    select: { id: true, type: true, meta: true, requiresAction: true, readById: true, resolvedAt: true },
    take: 2000,
  });
  const actionIds = rows.filter((r: any) => rowRequiresAction(r)).map((r: any) => r.id);
  const infoIds = rows.filter((r: any) => !rowRequiresAction(r)).map((r: any) => r.id);
  let marked = 0;
  if (actionIds.length) {
    marked += (await db.notification.updateMany({ where: { id: { in: actionIds }, unread: true }, data: { unread: false, readAt: now, readById: adminId } })).count;
  }
  if (infoIds.length) {
    marked += (await db.notification.updateMany({
      where: { id: { in: infoIds }, unread: true },
      data: { unread: false, readAt: now, readById: adminId, resolvedAt: now, resolvedById: adminId },
    })).count;
  }
  return res.json({ ok: true, marked, stillOpen: actionIds.length });
}));

// POST /api/admin/notifications/:id/mark-read
router.post('/:id/mark-read', asyncHandler(async (req: any, res) => {
  // Set Content-Type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid_id' });
    const row = await db.notification.findFirst({
      where: { id, ...adminScope(req) },
      select: { id: true, unread: true, type: true, meta: true, requiresAction: true, readById: true, resolvedAt: true },
    });
    if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
    if (row.unread) {
      await db.notification.updateMany({ where: { id, unread: true }, data: readData(row, Number(req.user.id), new Date()) });
    }
    return res.json({ ok: true, state: lifecycleState({ ...row, unread: false, resolvedAt: row.resolvedAt ?? (rowRequiresAction(row) ? null : new Date()) }) });
  } catch (err: any) {
    console.error('POST /api/admin/notifications/:id/mark-read failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}));

// POST /api/admin/notifications/:id/resolve  { note? }
// The action this alert asked for is done. Records who and when; the alert
// then clears automatically after the retention period.
router.post('/:id/resolve', asyncHandler(async (req: any, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ ok: false, error: 'invalid_id' });
  const rawNote = typeof req.body?.note === 'string' ? sanitizeText(req.body.note.trim()).slice(0, 300) : '';
  const row = await db.notification.findFirst({
    where: { id, ...adminScope(req) },
    select: { id: true, unread: true, type: true, meta: true, requiresAction: true, readById: true, resolvedAt: true },
  });
  if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
  if (row.resolvedAt) return res.json({ ok: true, state: 'resolved', alreadyResolved: true });
  const adminId = Number(req.user.id);
  const now = new Date();
  const meta = row.meta && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  const resolved = await db.notification.updateMany({
    where: { id, resolvedAt: null },
    data: {
      unread: false,
      ...(row.unread ? { readAt: now } : {}),
      ...(row.readById ? {} : { readById: adminId }),
      resolvedAt: now,
      resolvedById: adminId,
      ...(rawNote ? { meta: { ...meta, resolutionNote: rawNote } } : {}),
    },
  });
  return res.json({ ok: true, state: 'resolved', changed: resolved.count === 1 });
}));

// DELETE /api/admin/notifications/:id: refused. Admin alerts are NoLSAF's record
// of what needed handling; they clear themselves once read and resolved.
router.delete('/:id', (_req, res) => {
  res.status(405).json({
    ok: false,
    error: 'admin_notifications_not_deletable',
    message: `Admin notifications cannot be deleted. Resolve it instead; read and resolved notifications clear automatically after ${ADMIN_NOTIFICATION_RETENTION_DAYS} days.`,
  });
});

export default router;
