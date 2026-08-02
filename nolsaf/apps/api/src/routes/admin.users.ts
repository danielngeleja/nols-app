import { Router, RequestHandler } from 'express';
import { prisma } from '@nolsaf/prisma';
import { Prisma } from '@prisma/client';
import { requireAuth, requireRole, blockImpersonated } from '../middleware/auth.js';
import { hasFinanceGrant, hasNrmsFinanceRole } from '../middleware/financeGrant.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { audit } from '../lib/audit.js';
import { sendMail } from '../lib/mailer.js';
import { sendSms } from '../lib/sms.js';
import { getAdminRevocationEmail, getAdminRevocationSms } from '../lib/adminEmailTemplates.js';
import { revokeUserAuthorization } from '../lib/authorizationInvalidation.js';

export const router = Router();
router.use(requireAuth as RequestHandler, requireRole('ADMIN') as RequestHandler, blockImpersonated as RequestHandler);

function sendJsonSafe(res: any, payload: unknown, status = 200) {
  try {
    // Ensure Content-Type is set
    res.setHeader('Content-Type', 'application/json');
    res.status(status);
    
    // Handle BigInt (JSON.stringify throws on BigInt)
    // Use a replacer function to convert BigInt to string
    const jsonString = JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'bigint') {
        return value.toString();
      }
      // Handle other non-serializable values
      if (value === undefined) {
        return null;
      }
      return value;
    });
    
    // Use res.send() with the stringified JSON
    return res.send(jsonString);
  } catch (err: any) {
    // Fallback: try to send error as JSON
    if (!res.headersSent) {
      res.status(500).setHeader('Content-Type', 'application/json').json({ error: 'Failed to serialize response', message: err?.message });
    } else {
      // If headers already sent, we can't send a proper error response
      console.error('Cannot send error response - headers already sent');
    }
    throw err;
  }
}

function buildPhoneVariants(phoneRaw: string | null | undefined): string[] {
  const raw = String(phoneRaw ?? '').trim();
  if (!raw) return [];

  const compact = raw.replace(/\s+/g, '').replace(/-/g, '');
  const noPlus = compact.replace(/^\+/, '');
  const digitsOnly = noPlus.replace(/\D+/g, '');

  const variants = new Set<string>([raw, compact, noPlus]);

  // Tanzania-friendly normalization: 0XXXXXXXXX <-> 255XXXXXXXXX
  if (digitsOnly.length === 9) {
    variants.add('0' + digitsOnly);
    variants.add('255' + digitsOnly);
    variants.add('+255' + digitsOnly);
  }

  if (digitsOnly.startsWith('0') && digitsOnly.length === 10) {
    const t = '255' + digitsOnly.slice(1);
    variants.add(t);
    variants.add('+' + t);
  }

  if (digitsOnly.startsWith('255') && digitsOnly.length === 12) {
    variants.add(digitsOnly);
    variants.add('+' + digitsOnly);
    variants.add('0' + digitsOnly.slice(3));
  }

  return Array.from(variants).filter(Boolean);
}

function buildBookingWhereForUser(user: { id: number; phone?: string | null; email?: string | null }) {
  const or: any[] = [{ userId: user.id }];

  const phoneVariants = buildPhoneVariants(user.phone);
  if (phoneVariants.length) {
    or.push({ userId: null, guestPhone: { in: phoneVariants } });
  }

  // Note: guestEmail field doesn't exist in Booking model, only guestPhone and guestName
  // If we need to match by email, we would need to match via userId instead

  return { OR: or };
}

/*
 * GET /admin/users
 * Query: { page?: string, perPage?: string, q?: string, role?: string, status?: "ACTIVE"|"SUSPENDED" }
 */
router.get('/', async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const { page = '1', perPage = '25', q, role, status } = req.query as any;
    const p = Math.max(1, Number(page) || 1);
    const pp = Math.max(1, Math.min(200, Number(perPage) || 25));

    // Base where (used for role counts too). Role filter is applied separately.
    const baseWhere: any = {};
    if (status === 'ACTIVE') {
      baseWhere.AND = [
        ...(baseWhere.AND ?? []),
        { suspendedAt: null },
        { OR: [{ isDisabled: null }, { isDisabled: false }] },
      ];
    }
    if (status === 'SUSPENDED') {
      baseWhere.AND = [
        ...(baseWhere.AND ?? []),
        { OR: [{ suspendedAt: { not: null } }, { isDisabled: true }] },
      ];
    }
    if (q) {
      const search = String(q).trim().slice(0, 120);
      if (search) {
        baseWhere.OR = [
          { name: { contains: search } },
          { email: { contains: search } },
          { phone: { contains: search } },
        ];
      }
    }

    const where: any = { ...baseWhere };
    if (role) where.role = String(role);

    const [total, users, roleCountsRaw] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip: (p - 1) * pp,
        take: pp,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          nrmsFinanceRole: true,
          createdAt: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          twoFactorEnabled: true,
          suspendedAt: true,
          isDisabled: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      }),
      prisma.user.groupBy({
        by: ['role'],
        where: baseWhere,
        _count: { _all: true },
      }),
    ]);

    const countsByRole: Record<string, number> = {};
    for (const row of roleCountsRaw as Array<{ role: any; _count: { _all: number } }>) {
      const r = row?.role;
      if (!r) continue;
      countsByRole[String(r)] = Number(row._count?._all || 0);
    }

    // For customers, get booking stats
    const usersWithStats = await Promise.all(users.map(async (user: typeof users[0]) => {
      if (user.role !== 'CUSTOMER') {
        return { ...user, bookingCount: 0, totalSpent: 0, lastBookingDate: null };
      }

      const bookingWhere = buildBookingWhereForUser({ id: user.id, phone: user.phone, email: user.email });

      const bookingCount = await prisma.booking.count({
        where: bookingWhere,
      });

      // Total spent should reflect what the customer paid on bookings.
      // In some environments an Invoice may not exist for a booking, so we sum Booking.totalAmount.
      const totalSpentAgg = await prisma.booking.aggregate({
        where: {
          ...(bookingWhere as any),
          status: { not: 'CANCELED' },
        },
        _sum: { totalAmount: true },
      });

      const lastBooking = await prisma.booking.findFirst({
        where: bookingWhere,
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      });

      return {
        ...user,
        bookingCount,
        totalSpent: Number((totalSpentAgg as any)?._sum?.totalAmount || 0),
        lastBookingDate: lastBooking?.createdAt || null,
      };
    }));

    return res.json({ meta: { page: p, perPage: pp, total, countsByRole }, data: usersWithStats });
  } catch (err: any) {
    console.error('Error in GET /admin/users:', err);
    res.setHeader('Content-Type', 'application/json');
    return res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

/**
 * GET /admin/users/summary - Customer-focused statistics
 * IMPORTANT: This route must come before /:id to avoid matching "summary" as an ID
 */
router.get('/summary', async (req, res) => {
  try {
    // Total customers only
    const totalCustomers = await prisma.user.count({ where: { role: "CUSTOMER" } });

    // Customers with verified email
    const verifiedEmailCount = await prisma.user.count({
      where: { role: "CUSTOMER", emailVerifiedAt: { not: null } },
    });

    // Customers with verified phone
    const verifiedPhoneCount = await prisma.user.count({
      where: { role: "CUSTOMER", phoneVerifiedAt: { not: null } },
    });

    // Customers with 2FA enabled
    const twoFactorEnabledCount = await prisma.user.count({
      where: { role: "CUSTOMER", twoFactorEnabled: true },
    });

    // Recent customers (last 5)
    const recentCustomers = await prisma.user.findMany({
      where: { role: "CUSTOMER" },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        emailVerifiedAt: true,
        phoneVerifiedAt: true,
        twoFactorEnabled: true,
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    });

    // Customers created in the last 7 days
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const newCustomersLast7Days = await prisma.user.count({
      where: { role: "CUSTOMER", createdAt: { gte: sevenDaysAgo } },
    });

    // Customers created in the last 30 days
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newCustomersLast30Days = await prisma.user.count({
      where: { role: "CUSTOMER", createdAt: { gte: thirtyDaysAgo } },
    });

    // Customer bookings statistics
    const totalBookings = await prisma.booking.count({
      where: { userId: { not: null } },
    });

    const confirmedBookings = await prisma.booking.count({
      where: { userId: { not: null }, status: "CONFIRMED" },
    });

    const checkedInBookings = await prisma.booking.count({
      where: { userId: { not: null }, status: "CHECKED_IN" },
    });

    const completedBookings = await prisma.booking.count({
      where: { userId: { not: null }, status: "CHECKED_OUT" },
    });

    // Total revenue from customer bookings (via invoices)
    const revenueResult = await prisma.invoice.aggregate({
      where: {
        booking: { userId: { not: null } },
        status: { in: ["APPROVED", "PAID"] },
      },
      _sum: { total: true },
    });
    const totalRevenue = revenueResult._sum.total || 0;

    // Customers who have made bookings
    const customersWithBookings = await prisma.user.count({
      where: {
        role: "CUSTOMER",
        bookings: { some: {} },
      },
    });

    // Group bookings by customers
    const totalGroupBookings = await (prisma as any).groupBooking.count({
      where: { userId: { not: null } },
    }).catch(() => 0);

    // Transportation requests in group bookings
    const transportationRequests = await (prisma as any).groupBooking.count({
      where: { userId: { not: null }, arrTransport: true },
    }).catch(() => 0);

    // Active customers (made at least one booking)
    const activeCustomers = customersWithBookings;

    // Average bookings per customer
    const avgBookingsPerCustomer = activeCustomers > 0
      ? Math.round((totalBookings + totalGroupBookings) / activeCustomers)
      : 0;

    res.json({
      totalCustomers,
      verifiedEmailCount,
      verifiedPhoneCount,
      twoFactorEnabledCount,
      newCustomersLast7Days,
      newCustomersLast30Days,
      recentCustomers,
      totalBookings,
      confirmedBookings,
      checkedInBookings,
      completedBookings,
      totalRevenue: Number(totalRevenue),
      customersWithBookings,
      activeCustomers,
      totalGroupBookings,
      transportationRequests,
      avgBookingsPerCustomer,
    });
  } catch (err) {
    console.error("admin.users.summary error", err);
    res.status(500).json({ error: "failed" });
  }
});

/**
 * GET /admin/users/:id
 * Returns detailed user information including bookings, stats, etc.
 */
router.get('/:id', asyncHandler(async (req, res) => {
  let stage = 'start';
  const id = Number(req.params.id);

  try {
    stage = 'parse_id';
    if (!id) {
      return sendJsonSafe(res, { error: 'invalid id' }, 400);
    }

    // Fail-soft: some environments may not have all newer columns yet.
    // If Prisma throws due to missing columns, retry with a minimal select.
    let user: any = null;
    try {
      stage = 'user_select_full';
      user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
          emailVerifiedAt: true,
          phoneVerifiedAt: true,
          twoFactorEnabled: true,
          suspendedAt: true,
          isDisabled: true,
          _count: {
            select: {
              bookings: true,
            },
          },
        },
      });
    } catch (e) {
      console.warn('GET /admin/users/:id user select failed; retrying minimal select', e);
      stage = 'user_select_minimal';
      user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });
      if (user) {
        user.emailVerifiedAt = null;
        user.phoneVerifiedAt = null;
        user.twoFactorEnabled = false;
        user.suspendedAt = null;
        user.isDisabled = null;
        user._count = { bookings: 0 };
      }
    }

    if (!user) {
      return sendJsonSafe(res, { error: 'user not found' }, 404);
    }

    // NOTE: bookingWhere may reference legacy columns (guestPhone/guestEmail).
    // If an environment is missing those columns, Prisma will throw at runtime.
    stage = 'build_booking_where';
    const bookingWhere = buildBookingWhereForUser({ id, phone: user.phone, email: user.email });

    // Get bookings for this user
    let bookings: any[] = [];
    try {
      stage = 'booking_query_full';
      bookings = await prisma.booking.findMany({
        where: bookingWhere,
        include: {
          property: {
            select: {
              id: true,
              title: true,
              type: true,
              regionName: true,
              city: true,
              district: true,
            },
          },
          code: {
            select: {
              id: true,
              status: true,
              codeVisible: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
    } catch (e1) {
      console.warn('GET /admin/users/:id booking query failed; retrying without code include', e1);
      try {
        stage = 'booking_query_no_code';
        bookings = await prisma.booking.findMany({
          where: bookingWhere,
          include: {
            property: {
              select: {
                id: true,
                title: true,
                type: true,
                regionName: true,
                city: true,
                district: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        });
        bookings = bookings.map((b) => ({ ...b, code: null }));
      } catch (e2) {
        console.warn('GET /admin/users/:id booking where failed; retrying userId-only', e2);
        try {
          stage = 'booking_query_userid_only';
          bookings = await prisma.booking.findMany({
            where: { userId: id },
            include: {
              property: {
                select: {
                  id: true,
                  title: true,
                  type: true,
                  regionName: true,
                  city: true,
                  district: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
          });
          bookings = bookings.map((b) => ({ ...b, code: null }));
        } catch (e3) {
          console.warn('GET /admin/users/:id booking userId-only fallback failed; returning empty list', e3);
          bookings = [];
        }
      }
    }

    // Get booking stats
    stage = 'compute_stats';
    const bookingStats = {
      total: bookings.length,
      confirmed: bookings.filter((b: typeof bookings[0]) => b.status === 'CONFIRMED').length,
      checkedIn: bookings.filter((b: typeof bookings[0]) => b.status === 'CHECKED_IN').length,
      checkedOut: bookings.filter((b: typeof bookings[0]) => b.status === 'CHECKED_OUT').length,
      canceled: bookings.filter((b: typeof bookings[0]) => b.status === 'CANCELED').length,
    };

    // Get revenue stats from invoices (based on the bookings we associate to this user)
    const bookingIds = bookings.map((b: any) => b.id);
    let revenueResult: any = { _sum: { total: 0 }, _count: { _all: 0 } };
    if (bookingIds.length) {
      try {
        stage = 'invoice_aggregate';
        revenueResult = await prisma.invoice.aggregate({
          where: {
            bookingId: { in: bookingIds },
            status: { in: ['APPROVED', 'PAID'] },
          },
          _sum: { total: true },
          _count: { _all: true },
        });
      } catch (e) {
        console.warn('GET /admin/users/:id invoice aggregate failed; defaulting revenue to 0', e);
        revenueResult = { _sum: { total: 0 }, _count: { _all: 0 } };
      }
    }

    const lastBooking = bookings.length > 0 ? bookings[0] : null;

    stage = 'respond';
    
    // Build response payload
    const responsePayload = {
      user,
      bookings,
      stats: {
        booking: bookingStats,
        revenue: {
          total: Number(revenueResult._sum.total || 0),
          invoiceCount: (revenueResult as any)._count?._all ?? 0,
        },
        lastBooking: lastBooking
          ? {
              id: lastBooking.id,
              createdAt: lastBooking.createdAt,
              status: lastBooking.status,
            }
          : null,
      },
    };
    
    try {
      sendJsonSafe(res, responsePayload);
      return;
    } catch (sendError: any) {
      throw sendError;
    }
  } catch (err) {
    const isProd = process.env.NODE_ENV === 'production';
    console.error('GET /admin/users/:id error:', { stage, err });

    // Fail-open: return a minimal shape so the admin page can still render.
    // This avoids the dev proxy turning upstream failures into non-JSON/HTML.
    let fallbackUser: any = null;
    try {
      stage = stage === 'parse_id' ? 'fallback_user_select' : stage;
      fallbackUser = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          role: true,
          createdAt: true,
        },
      });
    } catch {
      fallbackUser = null;
    }

    return sendJsonSafe(
      res,
      {
        user: fallbackUser,
        bookings: [],
        stats: {
          booking: { total: 0, confirmed: 0, checkedIn: 0, checkedOut: 0, canceled: 0 },
          revenue: { total: 0, invoiceCount: 0 },
          lastBooking: null,
        },
        _error: {
          error: 'failed',
          stage,
          ...(isProd
            ? {}
            : {
                message: (err as any)?.message,
                name: (err as any)?.name,
                code: (err as any)?.code,
              }),
        },
      },
      200,
    );
  }
}));

/**
 * POST /admin/users/:id/suspend
 * Body: { reason?: string }
 */
router.post('/:id/suspend', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const reason = String(req.body?.reason ?? "");
    const me = (req.user as any)?.id;

    const user = await prisma.user.update({
      where: { id },
      data: { suspendedAt: new Date() },
      select: { id: true, name: true, email: true, suspendedAt: true }
    });

    // Create audit log
    if (me) {
      await prisma.adminAudit.create({
        data: { adminId: me, targetUserId: id, action: "SUSPEND_USER", details: reason },
      });
    }

    await revokeUserAuthorization(id);

    res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /admin/users/:id/suspend error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

/**
 * POST /admin/users/:id/unsuspend
 * Body: { notification?: string }
 */
router.post('/:id/unsuspend', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });
    const notification = String(req.body?.notification ?? "");
    const me = (req.user as any)?.id;

    const user = await prisma.user.update({
      where: { id },
      data: { suspendedAt: null },
      select: { id: true, name: true, email: true, suspendedAt: true }
    });

    // Create audit log with notification
    if (me) {
      await prisma.adminAudit.create({
        data: { adminId: me, targetUserId: id, action: "UNSUSPEND_USER", details: notification },
      });
    }

    res.json({ ok: true, user });
  } catch (err) {
    console.error('POST /admin/users/:id/unsuspend error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

/**
 * PATCH /admin/users/:id
 * Body: { role?: 'ADMIN'|'OWNER'|'CUSTOMER', reset2FA?: boolean, disable?: boolean }
 * Note: 'disable' requires an isDisabled column; if absent, return 400 with migration instructions.
 */
/**
 * GET /admin/users/:id/audit
 * Returns recent AdminAudit entries for this user.
 */
router.get('/:id/audit', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const limitRaw = Number(req.query?.limit ?? 25);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 25;

    const rows = await prisma.adminAudit.findMany({
      where: {
        targetUserId: id,
        action: { in: ['DISABLE_USER', 'ENABLE_USER', 'RESET_2FA'] },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        details: true,
        createdAt: true,
        admin: { select: { id: true, name: true, email: true } },
      },
    });

    return res.json({ data: rows });
  } catch (err) {
    console.error('GET /admin/users/:id/audit error:', err);
    return res.status(500).json({ error: 'failed' });
  }
});

/**
 * POST /admin/users/:id/promote-admin
 * Body: { confirm: true }
 * Promotes an existing user to ADMIN. No public admin signup is allowed.
 */
router.post(
  '/:id/promote-admin',
  asyncHandler(async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const confirm = Boolean(req.body?.confirm);
    if (!confirm) {
      return res.status(400).json({
        error: 'confirm_required',
        message: 'Set { confirm: true } to promote this user to ADMIN.',
      });
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true, phone: true, name: true, suspendedAt: true, isDisabled: true },
    });
    if (!target) return res.status(404).json({ error: 'user_not_found' });

    const before = { role: target.role };
    const currentRole = String(target.role ?? '').toUpperCase();
    if (currentRole === 'ADMIN') {
      return res.json({
        ok: true,
        data: { ...target, role: target.role },
        message: 'User is already an ADMIN.',
      });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: 'ADMIN' as any },
      select: { id: true, role: true, email: true, phone: true, name: true, suspendedAt: true, isDisabled: true },
    });

    await revokeUserAuthorization(id);

    try {
      await audit(req, 'ADMIN_USER_PROMOTED_TO_ADMIN', `user:${id}`, before, { role: updated.role });
    } catch {
      // ignore audit failures
    }

    return res.json({
      ok: true,
      data: updated,
      message: 'User promoted to ADMIN. Ensure they enable 2FA and verify email/phone.',
    });
  })
);

/**
 * POST /admin/users/:id/revoke-admin
 * Body: { confirm: true, reason?: string }
 * Revokes ADMIN privileges from a user (demotes to CUSTOMER).
 */
router.post(
  '/:id/revoke-admin',
  asyncHandler(async (req: any, res: any) => {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const confirm = Boolean(req.body?.confirm);
    if (!confirm) {
      return res.status(400).json({
        error: 'confirm_required',
        message: 'Set { confirm: true } to revoke ADMIN privileges from this user.',
      });
    }

    const reason = req.body?.reason ? String(req.body.reason).trim() : null;
    const revokedBy = req.user?.name || req.user?.email || 'System Administrator';

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, email: true, phone: true, name: true, suspendedAt: true, isDisabled: true },
    });
    if (!target) return res.status(404).json({ error: 'user_not_found' });

    const before = { role: target.role };
    const currentRole = String(target.role ?? '').toUpperCase();
    if (currentRole !== 'ADMIN') {
      return res.json({
        ok: true,
        data: { ...target, role: target.role },
        message: 'User is not an ADMIN.',
      });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role: 'CUSTOMER' as any },
      select: { id: true, role: true, email: true, phone: true, name: true, suspendedAt: true, isDisabled: true },
    });

    await revokeUserAuthorization(id);

    // Create audit log
    try {
      await audit(req, 'ADMIN_USER_DEMOTED_FROM_ADMIN', `user:${id}`, before, { 
        role: updated.role,
        reason: reason || 'No reason provided',
        revokedBy,
      });
    } catch {
      // ignore audit failures
    }

    // Send revocation notifications
    const adminName = target.name || 'Admin';
    const effectiveDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const referenceCode = `REV-${id}-${Date.now().toString(36).toUpperCase()}`;

    // Send SMS notification
    if (target.phone) {
      try {
        const smsMessage = getAdminRevocationSms({ name: adminName, referenceCode });
        await sendSms(target.phone, smsMessage);
        console.log(`📱 Admin revocation SMS sent to ${target.phone}`);
      } catch (err) {
        console.warn(`⚠️  Failed to send revocation SMS: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Send email notification
    try {
      const { subject, html } = getAdminRevocationEmail({
        name: adminName,
        email: target.email,
        referenceCode,
      });
      await sendMail(target.email, subject, html);
      console.log(`📧 Admin revocation email sent to ${target.email}`);
    } catch (err) {
      console.warn(`⚠️  Failed to send revocation email: ${err instanceof Error ? err.message : String(err)}`);
    }

    return res.json({
      ok: true,
      data: updated,
      message: 'ADMIN privileges revoked. User demoted to CUSTOMER. Notifications sent.',
    });
  })
);

router.patch('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'invalid id' });

    const { role, reset2FA, disable, nrmsFinanceRole } = req.body as any;
    const me = (req.user as any)?.id;

    const update: any = {};
    // Role changes are not permitted via this endpoint.
    if (typeof role !== 'undefined') {
      return res.status(403).json({ error: 'role changes are not permitted' });
    }

    if (typeof nrmsFinanceRole !== 'undefined') {
      if (!['NONE', 'OPERATOR', 'APPROVER'].includes(String(nrmsFinanceRole).toUpperCase())) {
        return res.status(400).json({ error: 'invalid NRMS finance role' });
      }
      if (!hasNrmsFinanceRole(req as any, 'APPROVER')) {
        return res.status(403).json({ error: 'Only an NRMS finance approver can assign finance permissions' });
      }
      if (!(await hasFinanceGrant(req))) {
        return res.status(403).json({ error: 'OTP required', require2fa: true });
      }
      update.nrmsFinanceRole = String(nrmsFinanceRole).toUpperCase();
    }

    if (reset2FA === true) {
      update.twoFactorEnabled = false;
      update.twoFactorSecret = null;
    }

    if (typeof disable !== 'undefined') {
      if (typeof disable !== 'boolean') {
        return res.status(400).json({ error: 'invalid disable value' });
      }
      update.isDisabled = disable;
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'no changes provided' });
    }

    const auditEvents: Array<{ action: string; details?: any }> = [];
    if (reset2FA === true) {
      auditEvents.push({ action: 'RESET_2FA', details: { reset2FA: true } });
    }
    if (typeof disable === 'boolean') {
      auditEvents.push({ action: disable ? 'DISABLE_USER' : 'ENABLE_USER', details: { disable } });
    }
    if (typeof nrmsFinanceRole !== 'undefined') {
      auditEvents.push({ action: 'NRMS_FINANCE_ROLE_CHANGE', details: { nrmsFinanceRole: update.nrmsFinanceRole } });
    }

    const ops: any[] = [
      prisma.user.update({
        where: { id },
        data: update,
        select: { id: true, name: true, email: true, phone: true, role: true, nrmsFinanceRole: true, twoFactorEnabled: true, isDisabled: true } as any,
      }),
    ];

    if (me && auditEvents.length) {
      for (const ev of auditEvents) {
        ops.push(
          prisma.adminAudit.create({
            data: {
              adminId: me,
              targetUserId: id,
              action: ev.action,
              details: ev.details,
            },
          })
        );
      }
    }

    const result = await prisma.$transaction(ops);
    const user = result[0] as any;
    if (disable === true || reset2FA === true || typeof nrmsFinanceRole !== 'undefined') {
      await revokeUserAuthorization(id);
    }
    res.json({ data: user });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      // P2022: Column does not exist in the current database.
      if (err.code === 'P2022') {
        return res.status(400).json({ error: 'disable not supported - add isDisabled column via migration' });
      }
    }
    console.error('PATCH /admin/users/:id error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
