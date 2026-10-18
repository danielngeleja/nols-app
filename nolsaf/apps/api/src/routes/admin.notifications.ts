import { Router } from 'express';
import { prisma } from '@nolsaf/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();

// The admin inbox holds only what is addressed to admins: platform rows with no
// recipient (system, chatbot, operator-to-admin) and rows sent to this admin.
// Messages addressed to owners, operators, drivers or travellers belong to their
// own inboxes; reading or deleting them here would mark them read for, or remove
// them from, the person they were meant for.
const adminScope = (req: any) => ({
  OR: [{ userId: null, ownerId: null }, ...(req.user?.id ? [{ userId: Number(req.user.id) }] : [])],
});
// Note: requireAuth and requireRole are already applied in index.ts at route registration
// We keep it here as well for safety (double protection)
router.use(requireAuth as any, requireRole('ADMIN') as any);

// GET /api/admin/notifications?tab=unread|viewed&page=1&pageSize=20
router.get('/', asyncHandler(async (req, res) => {
  // Set Content-Type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  try {
    const tab = req.query.tab === 'viewed' ? 'viewed' : 'unread';
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.pageSize || 20);

    const where: any = { ...adminScope(req) };
    if (tab === 'unread') {
      where.unread = true;
    } else {
      where.unread = false;
    }

    const [items, total, totalUnread] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          owner: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { ...adminScope(req), unread: true } }),
    ]);

    const propertyIds = Array.from(
      new Set(
        items
          .map((i: typeof items[number]) => {
            const propertyId = i.meta && typeof i.meta === 'object' ? Number((i.meta as any).propertyId) : NaN;
            return Number.isFinite(propertyId) ? propertyId : null;
          })
          .filter((id): id is number => id != null)
      )
    );
    const properties = propertyIds.length
      ? await prisma.property.findMany({
          where: { id: { in: propertyIds } },
          select: {
            id: true,
            title: true,
            ownerId: true,
            owner: { select: { id: true, name: true, email: true } },
          },
        })
      : [];
    const propertyById = new Map((properties as any[]).map((property) => [property.id, property]));

    // Enrich notifications with property and owner info if available.
    const dto = items.map((i: typeof items[number]) => {
      const baseDto: any = {
        id: i.id,
        type: i.type,
        title: i.title,
        body: i.body,
        createdAt: i.createdAt,
        unread: !!i.unread,
        meta: i.meta ?? null,
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

    res.json({ items: dto, total, totalUnread });
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

// POST /api/admin/notifications/:id/mark-read
router.post('/:id/mark-read', asyncHandler(async (req, res) => {
  // Set Content-Type early to ensure JSON response
  res.setHeader('Content-Type', 'application/json');
  try {
    const { id } = req.params;
    const result = await prisma.notification.updateMany({
      where: { id: Number(id), ...adminScope(req) },
      data: { unread: false, readAt: new Date() },
    });
    
    if (result.count === 0) {
      return res.status(404).json({ ok: false, error: 'not_found' });
    }
    
    return res.json({ ok: true });
  } catch (err: any) {
    console.error('POST /api/admin/notifications/:id/mark-read failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}));

// DELETE /api/admin/notifications/:id - read notifications only
router.delete('/:id', asyncHandler(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'invalid_id' });
    }

    const result = await prisma.notification.deleteMany({
      where: { id, unread: false, ...adminScope(req) },
    });

    if (result.count === 0) {
      return res.status(404).json({ ok: false, error: 'not_found_or_unread' });
    }

    return res.json({ ok: true });
  } catch (err: any) {
    console.error('DELETE /api/admin/notifications/:id failed:', err?.message || err);
    return res.status(500).json({ ok: false, error: String(err?.message || err) });
  }
}));

export default router;
