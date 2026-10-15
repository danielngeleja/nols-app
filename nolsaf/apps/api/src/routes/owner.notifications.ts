import { Router } from 'express';
import { prisma } from '@nolsaf/prisma';
import { AuthedRequest, requireAuth, requireRole } from '../middleware/auth.js';
import { deleteReadNotification, deleteReadNotifications, fetchNotifications, markNotificationRead } from '../services/notifications';
import { customerBookingReference } from '../lib/customerBookingReference.js';
import { OWNER_BOOKING_NOTIFICATION_KINDS, presentOwnerBookingNotification } from '../lib/ownerNotificationPresentation.js';

const router = Router();
router.use(requireAuth as any, requireRole('OWNER') as any);

// GET /api/owner/notifications?tab=unread|viewed&page=1&pageSize=20
router.get('/', (async (req: AuthedRequest, res: any) => {
  const ownerId = req.user!.id;
  const tab = req.query.tab === 'viewed' ? 'viewed' : 'unread';
  const page = Number(req.query.page ?? '1');
  const pageSize = Number(req.query.pageSize ?? '20');

  const result = await fetchNotifications({ tab: tab as any, page, pageSize, ownerId });
  // Older merchant-decision notifications only stored the application ID and a
  // generic payments URL. Resolve the actual linked property at read time so
  // both existing and newly created notifications open the right application.
  const applicationIds = result.items
    .filter((item) => /^merchant_application_(return|reject|approve)$/.test(String(item.meta?.kind ?? '')))
    .map((item) => Number(item.meta?.applicationId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  if (applicationIds.length) {
    const applications = await prisma.merchantApplication.findMany({
      where: { id: { in: applicationIds }, merchant: { administeredById: ownerId } },
      select: { id: true, merchantId: true },
    });
    const merchantIds = [...new Set(applications.map((application) => application.merchantId))];
    const links = await prisma.merchantPropertyLink.findMany({
      where: { merchantId: { in: merchantIds }, effectiveTo: null, property: { ownerId } },
      select: { merchantId: true, propertyId: true },
      orderBy: { id: 'asc' },
    });
    const propertyByMerchant = new Map<number, number>();
    for (const link of links) {
      if (!propertyByMerchant.has(link.merchantId)) propertyByMerchant.set(link.merchantId, link.propertyId);
    }
    const propertyByApplication = new Map(applications.map((application) => [application.id, propertyByMerchant.get(application.merchantId)]));
    result.items = result.items.map((item) => {
      const applicationId = Number(item.meta?.applicationId);
      const propertyId = propertyByApplication.get(applicationId);
      return propertyId && /^merchant_application_(return|reject|approve)$/.test(String(item.meta?.kind ?? ''))
        ? { ...item, meta: { ...item.meta, relatedPropertyId: propertyId } }
        : item;
    });
  }
  const bookingIds = result.items
    .filter((item) => OWNER_BOOKING_NOTIFICATION_KINDS.has(String(item.meta?.notificationKind ?? item.meta?.kind ?? '')))
    .map((item) => Number(item.meta?.bookingId))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  const references = new Map<number, string>();
  if (bookingIds.length) {
    const bookings = await prisma.booking.findMany({
      where: { id: { in: bookingIds }, property: { ownerId } },
      select: { id: true },
    });
    for (const booking of bookings) references.set(booking.id, customerBookingReference(booking.id));
  }
  result.items = result.items.map((item) => {
    const kind = String(item.meta?.notificationKind ?? item.meta?.kind ?? '');
    if (!OWNER_BOOKING_NOTIFICATION_KINDS.has(kind)) return item;
    const reference = references.get(Number(item.meta?.bookingId));
    return presentOwnerBookingNotification(item, reference);
  });
  return res.json(result);
}) as any);

// POST /api/owner/notifications/mark-all-read
router.post('/mark-all-read', (async (req: AuthedRequest, res: any) => {
  const result = await prisma.notification.updateMany({
    where: { ownerId: req.user!.id, unread: true },
    data: { unread: false, readAt: new Date() },
  });
  return res.json({ ok: true, updated: result.count });
}) as any);

// POST /api/owner/notifications/:id/mark-read
router.post('/:id/mark-read', (async (req: AuthedRequest, res: any) => {
  const { id } = req.params;
  const ownerId = req.user!.id;
  const r = await markNotificationRead(id, ownerId);
  if (!r.ok) return res.status(404).json(r);
  return res.json(r);
}) as any);

// DELETE /api/owner/notifications/read - delete all read notifications for this owner
router.delete('/read', (async (req: AuthedRequest, res: any) => {
  const ownerId = req.user!.id;
  const r = await deleteReadNotifications({ ownerId });
  if (!r.ok) return res.status(500).json(r);
  return res.json(r);
}) as any);

// DELETE /api/owner/notifications/:id - delete a read notification for this owner
router.delete('/:id', (async (req: AuthedRequest, res: any) => {
  const { id } = req.params;
  const ownerId = req.user!.id;
  const r = await deleteReadNotification(id, ownerId);
  if (!r.ok) return res.status(404).json(r);
  return res.json(r);
}) as any);

export default router;
