import { Router, RequestHandler } from 'express';
import { prisma } from '@nolsaf/prisma';
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
 * Query: { page?: string, perPage?: string, q?: string, role?: string, status?: "ACTIVE"|"SUSPENDED", registrationStatus?: "COMPLETE"|"INCOMPLETE" }
 */
router.get('/', async (req, res) => {
  try {
    // Explicitly set Content-Type to JSON
    res.setHeader('Content-Type', 'application/json');
    
    const { page = '1', perPage = '25', q, role, status, registrationStatus } = req.query as any;
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
    if (registrationStatus === 'COMPLETE' || registrationStatus === 'INCOMPLETE') {
      baseWhere.registrationStatus = registrationStatus;
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
          registrationStatus: true,
          registrationSource: true,
          profileCompletedAt: true,
          twoFactorEnabled: true,
          suspendedAt: true,
          isDisabled: true,
          _count: {
            select: {
              bookings: true,
              tourBookings: true,
              groupBookings: true,
              transportBookingsAsCustomer: true,
              propertyReviews: true,
              savedProperties: true,
            },
          },
          bookings: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { guestName: true, createdAt: true },
          },
          tourBookings: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { guestName: true, createdAt: true },
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
      const bookingGuestName = String(user.bookings?.[0]?.guestName || user.tourBookings?.[0]?.guestName || '').trim() || null;
      const accountName = String(user.name || '').trim() || null;
      const displayName = accountName || bookingGuestName || 'Incomplete profile';
      const baseUser = {
        ...user,
        bookings: undefined,
        tourBookings: undefined,
        displayName,
        bookingGuestName,
        identityNameSource: accountName ? 'ACCOUNT' : bookingGuestName ? 'BOOKING' : 'MISSING',
        activityCounts: {
          accommodationBookings: user._count.bookings,
          tourBookings: user._count.tourBookings,
          groupBookings: user._count.groupBookings,
          transportBookings: user._count.transportBookingsAsCustomer,
          reviews: user._count.propertyReviews,
          savedProperties: user._count.savedProperties,
        },
      };
      if (user.role !== 'CUSTOMER') {
        return { ...baseUser, bookingCount: 0, activityCount: 0, totalSpent: 0, lastBookingDate: null };
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

      const accommodationBookingCount = Math.max(user._count.bookings, bookingCount);

      return {
        ...baseUser,
        bookingCount:
          accommodationBookingCount +
          user._count.tourBookings +
          user._count.groupBookings +
          user._count.transportBookingsAsCustomer,
        activityCount:
          accommodationBookingCount +
          user._count.tourBookings +
          user._count.groupBookings +
          user._count.transportBookingsAsCustomer +
          user._count.propertyReviews +
          user._count.savedProperties,
        totalSpent: Number((totalSpentAgg as any)?._sum?.totalAmount || 0),
        lastBookingDate: [
          lastBooking?.createdAt,
          user.bookings?.[0]?.createdAt,
          user.tourBookings?.[0]?.createdAt,
        ].filter(Boolean).sort((a: any, b: any) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
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
    const verifiedCustomerCount = await prisma.user.count({
      where: {
        role: "CUSTOMER",
        OR: [{ emailVerifiedAt: { not: null } }, { phoneVerifiedAt: { not: null } }],
      },
    });
    const incompleteRegistrationCount = await prisma.user.count({
      where: { role: "CUSTOMER", registrationStatus: "INCOMPLETE" },
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
    const [totalTourBookings, totalTransportBookings, activeCustomers] = await Promise.all([
      prisma.tourBooking.count({ where: { customerId: { not: null } } }).catch(() => 0),
      prisma.transportBooking.count({ where: { userId: { not: null } } }).catch(() => 0),
      prisma.user.count({
        where: {
          role: "CUSTOMER",
          OR: [
            { bookings: { some: {} } },
            { groupBookings: { some: {} } },
            { tourBookings: { some: {} } },
            { transportBookingsAsCustomer: { some: {} } },
          ],
        },
      }),
    ]);

    // Average bookings per customer
    const avgBookingsPerCustomer = activeCustomers > 0
      ? Math.round((totalBookings + totalGroupBookings + totalTourBookings + totalTransportBookings) / activeCustomers)
      : 0;

    res.json({
      totalCustomers,
      verifiedEmailCount,
      verifiedPhoneCount,
      verifiedCustomerCount,
      incompleteRegistrationCount,
      twoFactorEnabledCount,
      newCustomersLast7Days,
      newCustomersLast30Days,
      recentCustomers,
      totalBookings: totalBookings + totalGroupBookings + totalTourBookings + totalTransportBookings,
      totalAccommodationBookings: totalBookings,
      totalTourBookings,
      totalTransportBookings,
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
 * Transport route description.
 *
 * A ride is defined by the point the passenger picked on the map and the
 * dropoff, which is normally a registered property. `fromRegion`/`toRegion` are
 * optional administrative fields that real bookings often leave null, so they
 * are the last text fallback rather than the definition of the trip.
 */
function formatCoordinates(lat: unknown, lng: unknown): string | null {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude === 0 && longitude === 0) return null;
  return `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
}

function describeTransportPoint(item: any, side: 'from' | 'to'): string | null {
  if (side === 'to' && item.property?.title) return item.property.title;
  if (side === 'from' && item.pickupLocation) return String(item.pickupLocation);

  const address = side === 'from' ? item.fromAddress : item.toAddress;
  if (address) return String(address);

  const parts = side === 'from'
    ? [item.fromWard, item.fromDistrict, item.fromRegion]
    : [item.toWard, item.toDistrict, item.toRegion];
  const label = parts.filter(Boolean).join(', ');
  if (label) return label;

  return side === 'from'
    ? formatCoordinates(item.fromLatitude, item.fromLongitude)
    : formatCoordinates(item.toLatitude, item.toLongitude);
}

/**
 * Who is driving this ride, and how they got it.
 *
 * A driver is attached either by accepting an auto-dispatch offer or by
 * claiming the ride for an admin to approve. When `driverId` is set but neither
 * record exists, the assignment was made directly by an admin. An unassigned
 * ride says so rather than rendering an empty row.
 */
function describeDriverAssignment(item: any): {
  driverName: string;
  driverPhone: string | null;
  assignedVia: string;
  assignedAt: Date | null;
} {
  const acceptedOffer = item.offers?.[0] ?? null;
  const acceptedClaim = item.claims?.[0] ?? null;

  if (!item.driver) {
    return {
      driverName: 'Not assigned yet',
      driverPhone: null,
      assignedVia: acceptedOffer || acceptedClaim ? 'Awaiting confirmation' : 'No driver assigned',
      assignedAt: null,
    };
  }

  let assignedVia = 'Assigned by admin';
  let assignedAt: Date | null = null;
  if (acceptedOffer) {
    assignedVia = 'Auto dispatch offer accepted';
    assignedAt = acceptedOffer.respondedAt ?? acceptedOffer.offeredAt ?? null;
  } else if (acceptedClaim) {
    assignedVia = 'Driver claim approved';
    assignedAt = acceptedClaim.reviewedAt ?? acceptedClaim.createdAt ?? null;
  }

  return {
    driverName: String(item.driver.name || '').trim() || `Driver #${item.driver.id}`,
    driverPhone: item.driver.phone ?? null,
    assignedVia,
    assignedAt,
  };
}

function describeTransportRoute(item: any): string {
  const pickup = describeTransportPoint(item, 'from');
  const dropoff = describeTransportPoint(item, 'to');
  if (pickup && dropoff) return `${pickup} → ${dropoff}`;
  if (dropoff) return `Ride to ${dropoff}`;
  if (pickup) return `Ride from ${pickup}`;
  return `Transport booking #${item.id}`;
}

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
          registrationStatus: true,
          registrationSource: true,
          profileCompletedAt: true,
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
        user.registrationStatus = 'INCOMPLETE';
        user.registrationSource = 'UNKNOWN';
        user.profileCompletedAt = null;
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

    // Customer activity used to be fragmented across independent Admin modules.
    // Load each product fail-soft so one optional module cannot hide the user.
    const [tourBookings, transportBookings, groupBookings, reviews, savedProperties, cancellationRequests] = await Promise.all([
      prisma.tourBooking.findMany({ where: { customerId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, bookingCode: true, title: true, destination: true, status: true, paymentStatus: true, grossAmount: true, currency: true, fxTzsPerUnit: true, guestName: true, createdAt: true } }).catch(() => []),
      // A ride is defined by the pickup point the passenger picked and the
      // dropoff, which is usually a registered property. Regions are frequently
      // null on real bookings, so they are only the last text fallback.
      prisma.transportBooking.findMany({
        where: { userId: id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true, tripCode: true, status: true, vehicleType: true, amount: true, currency: true,
          scheduledDate: true, createdAt: true, numberOfPassengers: true, pickupLocation: true,
          fromAddress: true, fromWard: true, fromDistrict: true, fromRegion: true,
          fromLatitude: true, fromLongitude: true,
          toAddress: true, toWard: true, toDistrict: true, toRegion: true,
          toLatitude: true, toLongitude: true,
          property: { select: { id: true, title: true } },
          driver: { select: { id: true, name: true, phone: true } },
          // A driver arrives one of two ways: they accept an auto-dispatch offer,
          // or they claim the ride and an admin approves it. Both carry the
          // timestamp that answers "when was this assigned".
          offers: {
            where: { status: 'ACCEPTED' },
            select: { respondedAt: true, offeredAt: true },
            orderBy: { respondedAt: 'desc' },
            take: 1,
          },
          claims: {
            where: { status: 'ACCEPTED' },
            select: { reviewedAt: true, createdAt: true },
            orderBy: { reviewedAt: 'desc' },
            take: 1,
          },
        },
      }).catch(() => []),
      prisma.groupBooking.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, status: true, groupType: true, toRegion: true, headcount: true, totalAmount: true, currency: true, createdAt: true } }).catch(() => []),
      prisma.propertyReview.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, rating: true, title: true, isPublished: true, isHidden: true, createdAt: true, property: { select: { id: true, title: true } } } }).catch(() => []),
      prisma.savedProperty.findMany({ where: { userId: id }, orderBy: { savedAt: 'desc' }, take: 50, select: { id: true, savedAt: true, sharedAt: true, property: { select: { id: true, title: true } } } }).catch(() => []),
      prisma.cancellationRequest.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, bookingCode: true, status: true, reason: true, createdAt: true } }).catch(() => []),
    ]);

    // Each activity carries `reference` (the code an admin quotes back to a
    // customer) and a `meta` bag of product-specific fields, so the Admin user
    // profile can render one product-shaped table per tab instead of a single
    // flattened feed.
    const activities = [
      ...bookings.map((item: any) => ({
        type: 'ACCOMMODATION_BOOKING',
        id: item.id,
        reference: item.code?.codeVisible || null,
        title: item.property?.title || 'Property not available',
        status: item.status,
        amount: Number(item.totalAmount || 0),
        currency: 'TZS',
        createdAt: item.createdAt,
        meta: {
          propertyId: item.property?.id ?? null,
          location: [item.property?.regionName, item.property?.city, item.property?.district].filter(Boolean).join(' • ') || null,
          checkIn: item.checkIn ?? null,
          checkOut: item.checkOut ?? null,
        },
      })),
      ...tourBookings.map((item: any) => ({
        type: 'TOUR_BOOKING',
        id: item.id,
        reference: item.bookingCode || null,
        title: item.title || item.bookingCode || 'Tour details not available',
        status: item.status,
        amount: Number(item.grossAmount || 0),
        currency: item.currency || 'TZS',
        createdAt: item.createdAt,
        meta: {
          destination: item.destination ?? null,
          guestName: item.guestName ?? null,
          paymentStatus: item.paymentStatus ?? null,
        },
      })),
      ...transportBookings.map((item: any) => ({
        type: 'TRANSPORT_BOOKING',
        id: item.id,
        reference: item.tripCode || null,
        title: describeTransportRoute(item),
        status: item.status,
        amount: Number(item.amount || 0),
        currency: item.currency || 'TZS',
        createdAt: item.createdAt,
        meta: (() => {
          const pickup = describeTransportPoint(item, 'from');
          const dropoff = describeTransportPoint(item, 'to');
          const pickupCoordinates = formatCoordinates(item.fromLatitude, item.fromLongitude);
          const dropoffCoordinates = formatCoordinates(item.toLatitude, item.toLongitude);
          const assignment = describeDriverAssignment(item);
          return {
            pickup,
            dropoff,
            // Only worth a row when it adds something the label above did not
            // already say.
            pickupCoordinates: pickupCoordinates === pickup ? null : pickupCoordinates,
            dropoffCoordinates: dropoffCoordinates === dropoff ? null : dropoffCoordinates,
            destinationProperty: item.property?.title && item.property.title !== dropoff ? item.property.title : null,
            driver: assignment.driverName,
            driverPhone: assignment.driverPhone,
            assignedVia: assignment.assignedVia,
            assignedAt: assignment.assignedAt,
            vehicleType: item.vehicleType ?? null,
            passengers: item.numberOfPassengers ?? null,
            scheduledDate: item.scheduledDate ?? null,
          };
        })(),
      })),
      ...groupBookings.map((item: any) => ({
        type: 'GROUP_BOOKING',
        id: item.id,
        reference: null,
        title: `${item.groupType || 'Group'} trip to ${item.toRegion}`,
        status: item.status,
        amount: Number(item.totalAmount || 0),
        currency: 'TZS',
        createdAt: item.createdAt,
        meta: {
          groupType: item.groupType ?? null,
          toRegion: item.toRegion ?? null,
          headcount: item.headcount ?? null,
        },
      })),
      ...reviews.map((item: any) => ({
        type: 'PROPERTY_REVIEW',
        id: item.id,
        reference: null,
        title: item.property?.title || item.title || 'Property review',
        status: item.isHidden ? 'HIDDEN' : item.isPublished ? 'PUBLISHED' : 'PENDING',
        rating: item.rating,
        createdAt: item.createdAt,
        meta: {
          propertyId: item.property?.id ?? null,
          reviewTitle: item.title ?? null,
        },
      })),
      ...savedProperties.map((item: any) => ({
        type: 'SAVED_PROPERTY',
        id: item.id,
        reference: null,
        title: item.property?.title || 'Saved property',
        status: item.sharedAt ? 'SAVED_AND_SHARED' : 'SAVED',
        createdAt: item.savedAt,
        meta: {
          propertyId: item.property?.id ?? null,
          sharedAt: item.sharedAt ?? null,
        },
      })),
      ...cancellationRequests.map((item: any) => ({
        type: 'CANCELLATION_REQUEST',
        id: item.id,
        reference: item.bookingCode || null,
        title: `Cancellation for ${item.bookingCode}`,
        status: item.status,
        createdAt: item.createdAt,
        meta: {
          bookingCode: item.bookingCode ?? null,
          reason: item.reason ?? null,
        },
      })),
    ].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const accountName = String(user.name || '').trim() || null;
    const bookingGuestName = String(bookings.find((item: any) => item.guestName)?.guestName || tourBookings.find((item: any) => item.guestName)?.guestName || '').trim() || null;
    user.displayName = accountName || bookingGuestName || 'Incomplete profile';
    user.bookingGuestName = bookingGuestName;
    user.identityNameSource = accountName ? 'ACCOUNT' : bookingGuestName ? 'BOOKING' : 'MISSING';

    // Get booking stats
    stage = 'compute_stats';
    const bookingStats = {
      total: bookings.length,
      confirmed: bookings.filter((b: typeof bookings[0]) => b.status === 'CONFIRMED').length,
      checkedIn: bookings.filter((b: typeof bookings[0]) => b.status === 'CHECKED_IN').length,
      checkedOut: bookings.filter((b: typeof bookings[0]) => b.status === 'CHECKED_OUT').length,
      canceled: bookings.filter((b: typeof bookings[0]) => b.status === 'CANCELED').length,
    };

    /**
     * Unified activity totals across every product the customer used.
     *
     * TZS is the money of record. Tour rows carry `fxTzsPerUnit`, the rate
     * frozen at booking time, so a closed period cannot be restated later. Any
     * non-TZS amount without a frozen rate is deliberately NOT converted with a
     * guessed rate: it is reported in its own currency and named as
     * unconverted, so the headline TZS figure is never quietly wrong.
     */
    const SETTLED_STATUS = /CONFIRM|PAID|COMPLET|CHECKED_IN|CHECKED_OUT|IN_PROGRESS/i;
    const CANCELED_STATUS = /CANCEL|REFUND|REJECT/i;

    const activityRecords: {
      product: string;
      status: string;
      amount: number;
      currency: string;
      fxTzsPerUnit: number | null;
    }[] = [
      ...bookings.map((row: any) => ({
        product: 'stays',
        status: String(row.status || ''),
        amount: Number(row.totalAmount || 0),
        currency: 'TZS',
        fxTzsPerUnit: null,
      })),
      ...tourBookings.map((row: any) => ({
        product: 'tours',
        status: String(row.status || ''),
        amount: Number(row.grossAmount || 0),
        currency: String(row.currency || 'TZS').toUpperCase(),
        fxTzsPerUnit: row.fxTzsPerUnit == null ? null : Number(row.fxTzsPerUnit),
      })),
      ...transportBookings.map((row: any) => ({
        product: 'transport',
        status: String(row.status || ''),
        amount: Number(row.amount || 0),
        currency: String(row.currency || 'TZS').toUpperCase(),
        fxTzsPerUnit: null,
      })),
      ...groupBookings.map((row: any) => ({
        product: 'groups',
        status: String(row.status || ''),
        amount: Number(row.totalAmount || 0),
        currency: String(row.currency || 'TZS').toUpperCase(),
        fxTzsPerUnit: null,
      })),
    ];

    // Per currency the split matters: a foreign amount with a frozen rate IS
    // part of the TZS headline, one without it is NOT. Reporting both under a
    // single "includes" line would misstate the total in one direction or the
    // other, so each currency carries what was folded in and what was left out.
    const nativeTotals = new Map<
      string,
      { amount: number; records: number; convertedTzs: number; unconvertedAmount: number }
    >();
    const unconverted = new Set<string>();
    let valueTzs = 0;

    for (const row of activityRecords) {
      const bucket = nativeTotals.get(row.currency) || {
        amount: 0,
        records: 0,
        convertedTzs: 0,
        unconvertedAmount: 0,
      };
      bucket.amount += row.amount;
      bucket.records += 1;

      if (row.currency === 'TZS') {
        bucket.convertedTzs += row.amount;
        valueTzs += row.amount;
      } else if (row.fxTzsPerUnit && Number.isFinite(row.fxTzsPerUnit)) {
        const converted = row.amount * row.fxTzsPerUnit;
        bucket.convertedTzs += converted;
        valueTzs += converted;
      } else if (row.amount > 0) {
        bucket.unconvertedAmount += row.amount;
        unconverted.add(row.currency);
      }

      nativeTotals.set(row.currency, bucket);
    }

    const activityStats = {
      totalRecords: activityRecords.length,
      settled: activityRecords.filter((row) => SETTLED_STATUS.test(row.status)).length,
      canceled: activityRecords.filter((row) => CANCELED_STATUS.test(row.status)).length,
      valueTzs: Math.round(valueTzs),
      byCurrency: [...nativeTotals.entries()]
        .map(([currency, bucket]) => ({
          currency,
          amount: Math.round(bucket.amount),
          records: bucket.records,
          /** Native amount folded into valueTzs at the rate frozen at booking. */
          convertedAmount: Math.round(bucket.amount - bucket.unconvertedAmount),
          convertedTzs: Math.round(bucket.convertedTzs),
          /** Native amount deliberately left out of valueTzs: no frozen rate. */
          unconvertedAmount: Math.round(bucket.unconvertedAmount),
        }))
        .sort((a, b) => b.convertedTzs - a.convertedTzs || b.amount - a.amount),
      unconvertedCurrencies: [...unconverted],
      byProduct: [
        { key: 'stays', label: 'Stays', records: bookings.length },
        { key: 'tours', label: 'Tours', records: tourBookings.length },
        { key: 'transport', label: 'Transport', records: transportBookings.length },
        { key: 'groups', label: 'Group stays', records: groupBookings.length },
      ],
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
      activities,
      activityCounts: {
        accommodationBookings: bookings.length,
        tourBookings: tourBookings.length,
        transportBookings: transportBookings.length,
        groupBookings: groupBookings.length,
        reviews: reviews.length,
        savedProperties: savedProperties.length,
        cancellationRequests: cancellationRequests.length,
      },
      stats: {
        booking: bookingStats,
        activity: activityStats,
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
        activities: [],
        activityCounts: {
          accommodationBookings: 0,
          tourBookings: 0,
          transportBookings: 0,
          groupBookings: 0,
          reviews: 0,
          savedProperties: 0,
          cancellationRequests: 0,
        },
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
 * GET /admin/users/:id/behaviour
 *
 * Behavioural profile for one customer: engagement over time, product
 * preference, drop-off funnels, and conduct signals.
 *
 * Everything here is derived from records the platform already writes. There is
 * no browsing telemetry (no page views, searches, or session replay), so the
 * funnels start at "created a booking", never at "opened the app". Each conduct
 * signal carries the threshold that produced its severity so an admin can see
 * why the band says what it says before acting on it.
 */
const BEHAVIOUR_WINDOW_MONTHS = 12;
const BEHAVIOUR_RECENT_DAYS = 90;

type BehaviourSeverity = 'CLEAN' | 'WATCH' | 'ACTION';

function severityRank(value: BehaviourSeverity): number {
  return value === 'ACTION' ? 2 : value === 'WATCH' ? 1 : 0;
}

function gradeSignal(value: number, watchAt: number, actionAt: number): BehaviourSeverity {
  if (value >= actionAt) return 'ACTION';
  if (value >= watchAt) return 'WATCH';
  return 'CLEAN';
}

function monthKey(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isCanceled(status: unknown): boolean {
  return /CANCEL|REFUND|REJECT/i.test(String(status || ''));
}

router.get('/:id/behaviour', asyncHandler(async (req: any, res: any) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, role: true, createdAt: true, suspendedAt: true, isDisabled: true, referredBy: true, referralCode: true },
  });
  if (!user) return res.status(404).json({ error: 'not found' });

  // ── Filters ────────────────────────────────────────────────────────────
  // months / from / to scope every panel. products narrows which streams are
  // counted, including the conduct rates, so the response reports back what was
  // applied and the UI can say the view is scoped.
  const clampInt = (raw: unknown, min: number, max: number, fallback: number) => {
    const value = Number(raw);
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.round(value)));
  };
  const parseDate = (raw: unknown): Date | null => {
    if (!raw) return null;
    const value = new Date(String(raw));
    return Number.isNaN(value.getTime()) ? null : value;
  };

  const now = new Date();
  const requestedMonths = clampInt(req.query?.months, 1, 36, BEHAVIOUR_WINDOW_MONTHS);
  const recentDays = clampInt(req.query?.recentDays, 7, 365, BEHAVIOUR_RECENT_DAYS);

  const customFrom = parseDate(req.query?.from);
  const customTo = parseDate(req.query?.to);

  let windowStart: Date;
  let windowEnd: Date;
  if (customFrom || customTo) {
    windowStart = customFrom ?? new Date(0);
    windowEnd = customTo ?? now;
    windowStart.setHours(0, 0, 0, 0);
    windowEnd.setHours(23, 59, 59, 999);
    if (windowStart > windowEnd) {
      return res.status(400).json({ error: 'from must be before to' });
    }
  } else {
    windowEnd = now;
    windowStart = new Date(now);
    windowStart.setMonth(windowStart.getMonth() - (requestedMonths - 1));
    windowStart.setDate(1);
    windowStart.setHours(0, 0, 0, 0);
  }

  const ALL_PRODUCTS = ['stays', 'tours', 'transport', 'groups'] as const;
  type ProductKey = (typeof ALL_PRODUCTS)[number];
  const requestedProducts = String(req.query?.products || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ProductKey => (ALL_PRODUCTS as readonly string[]).includes(value));
  const products: ProductKey[] = requestedProducts.length ? requestedProducts : [...ALL_PRODUCTS];
  const wants = (key: ProductKey) => products.includes(key);

  const recentStart = new Date(Math.max(
    windowStart.getTime(),
    windowEnd.getTime() - recentDays * 24 * 60 * 60 * 1000,
  ));
  const createdInWindow = { gte: windowStart, lte: windowEnd };
  const isFiltered =
    products.length !== ALL_PRODUCTS.length ||
    requestedMonths !== BEHAVIOUR_WINDOW_MONTHS ||
    recentDays !== BEHAVIOUR_RECENT_DAYS ||
    Boolean(customFrom || customTo);

  // Each source is loaded fail-soft: one optional module must not blank the tab.
  const [
    bookings,
    tourBookings,
    transportBookings,
    groupBookings,
    reviews,
    savedProperties,
    cancellationRequests,
    sessions,
    auditRows,
    tripEstimates,
    restrictions,
  ] = await Promise.all([
    wants('stays') ? prisma.booking.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: {
        id: true, status: true, totalAmount: true, createdAt: true,
        property: { select: { regionName: true, city: true } },
        invoices: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    wants('tours') ? prisma.tourBooking.findMany({
      where: { customerId: id, createdAt: createdInWindow },
      select: { id: true, status: true, paymentStatus: true, grossAmount: true, destination: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    wants('transport') ? prisma.transportBooking.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: {
        id: true, status: true, paymentStatus: true, amount: true, createdAt: true,
        toAddress: true, toWard: true, toDistrict: true, toRegion: true,
        toLatitude: true, toLongitude: true,
        property: { select: { title: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    wants('groups') ? prisma.groupBooking.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: { id: true, status: true, depositPaid: true, totalAmount: true, toRegion: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]) : Promise.resolve([] as any[]),
    prisma.propertyReview.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: { id: true, rating: true, isHidden: true, isPublished: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]),
    prisma.savedProperty.findMany({
      where: { userId: id, savedAt: createdInWindow },
      select: { id: true, savedAt: true, property: { select: { regionName: true, city: true } } },
      orderBy: { savedAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]),
    prisma.cancellationRequest.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: { id: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }).catch(() => [] as any[]),
    prisma.session.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: { id: true, createdAt: true, lastSeenAt: true, revokedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }).catch(() => [] as any[]),
    prisma.auditLog.findMany({
      where: { actorId: id, createdAt: { gte: recentStart, lte: windowEnd } },
      select: { action: true, ip: true, ua: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    }).catch(() => [] as any[]),
    prisma.tripEstimate.findMany({
      where: { userId: id, createdAt: createdInWindow },
      select: { id: true, destination: true, totalCost: true, currency: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }).catch(() => [] as any[]),
    prisma.platformRestrictionCase.findMany({
      where: { targetId: id },
      select: { id: true, referenceCode: true, scope: true, status: true, reason: true, appliedAt: true, resolvedAt: true },
      orderBy: { appliedAt: 'desc' },
      take: 50,
    }).catch(() => [] as any[]),
  ]);

  // ── Engagement timeline ────────────────────────────────────────────────
  const months: string[] = [];
  const monthSpan = Math.max(1, Math.min(36,
    (windowEnd.getFullYear() - windowStart.getFullYear()) * 12 + (windowEnd.getMonth() - windowStart.getMonth()) + 1));
  for (let i = 0; i < monthSpan; i += 1) {
    const cursor = new Date(windowStart);
    cursor.setMonth(cursor.getMonth() + i);
    months.push(monthKey(cursor));
  }
  const emptyMonth = () => ({ stays: 0, tours: 0, transport: 0, groups: 0, other: 0, logins: 0 });
  const buckets = new Map(months.map((month) => [month, emptyMonth()]));
  const bump = (value: Date | string, field: keyof ReturnType<typeof emptyMonth>) => {
    const bucket = buckets.get(monthKey(value));
    if (bucket) bucket[field] += 1;
  };

  bookings.forEach((row: any) => bump(row.createdAt, 'stays'));
  tourBookings.forEach((row: any) => bump(row.createdAt, 'tours'));
  transportBookings.forEach((row: any) => bump(row.createdAt, 'transport'));
  groupBookings.forEach((row: any) => bump(row.createdAt, 'groups'));
  reviews.forEach((row: any) => bump(row.createdAt, 'other'));
  savedProperties.forEach((row: any) => bump(row.savedAt, 'other'));
  cancellationRequests.forEach((row: any) => bump(row.createdAt, 'other'));
  sessions.forEach((row: any) => bump(row.createdAt, 'logins'));

  const allActivityDates = [
    ...bookings.map((row: any) => row.createdAt),
    ...tourBookings.map((row: any) => row.createdAt),
    ...transportBookings.map((row: any) => row.createdAt),
    ...groupBookings.map((row: any) => row.createdAt),
    ...reviews.map((row: any) => row.createdAt),
    ...savedProperties.map((row: any) => row.savedAt),
    ...cancellationRequests.map((row: any) => row.createdAt),
  ]
    .map((value: any) => new Date(value).getTime())
    .filter((value: number) => Number.isFinite(value));

  const lastActivityAt = allActivityDates.length ? new Date(Math.max(...allActivityDates)) : null;
  const lastLoginAt = sessions.length ? new Date(sessions[0].createdAt) : null;
  const lastSeenAt = sessions.length
    ? new Date(Math.max(...sessions.map((row: any) => new Date(row.lastSeenAt).getTime())))
    : null;
  const recentLogins = sessions.filter((row: any) => new Date(row.createdAt) >= recentStart).length;

  // ── Product preference ─────────────────────────────────────────────────
  const sum = (rows: any[], field: string) =>
    rows.reduce((total, row) => total + Number(row[field] || 0), 0);

  const byProduct = [
    { key: 'stays', label: 'Stays', records: bookings.length, value: sum(bookings, 'totalAmount') },
    { key: 'tours', label: 'Tours', records: tourBookings.length, value: sum(tourBookings, 'grossAmount') },
    { key: 'transport', label: 'Transport', records: transportBookings.length, value: sum(transportBookings, 'amount') },
    { key: 'groups', label: 'Group stays', records: groupBookings.length, value: sum(groupBookings, 'totalAmount') },
  ];

  const destinationCounts = new Map<string, number>();
  const addDestination = (value: unknown) => {
    const name = String(value || '').trim();
    if (!name) return;
    destinationCounts.set(name, (destinationCounts.get(name) || 0) + 1);
  };
  bookings.forEach((row: any) => addDestination(row.property?.regionName || row.property?.city));
  tourBookings.forEach((row: any) => addDestination(row.destination));
  // Rides land on a property or an address far more often than on a region.
  transportBookings.forEach((row: any) => addDestination(describeTransportPoint(row, 'to')));
  groupBookings.forEach((row: any) => addDestination(row.toRegion));
  savedProperties.forEach((row: any) => addDestination(row.property?.regionName || row.property?.city));

  const topDestinations = [...destinationCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // ── Drop-off funnels ───────────────────────────────────────────────────
  /**
   * How this customer actually pays.
   *
   * PaymentEvent links to invoices, tour bookings, and group bookings. Transport
   * has no link on that model, so ride payments are outside this picture and the
   * response says so rather than implying full coverage.
   */
  const invoiceIds = bookings.flatMap((row: any) => (row.invoices || []).map((invoice: any) => invoice.id));
  const tourIds = tourBookings.map((row: any) => row.id);
  const groupIds = groupBookings.map((row: any) => row.id);

  const paymentEvents = invoiceIds.length || tourIds.length || groupIds.length
    ? await prisma.paymentEvent.findMany({
        where: {
          createdAt: createdInWindow,
          OR: [
            ...(invoiceIds.length ? [{ invoiceId: { in: invoiceIds } }] : []),
            ...(tourIds.length ? [{ tourBookingId: { in: tourIds } }] : []),
            ...(groupIds.length ? [{ groupBookingId: { in: groupIds } }] : []),
          ],
        },
        select: { id: true, provider: true, paymentChannel: true, status: true, amount: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }).catch(() => [] as any[])
    : ([] as any[]);

  // The complete set the payment code writes today: MNO (azampay, tour and
  // group MNO flows), BANK, CARD (azampay and coralcommerce), or null. NRMS
  // billing constrains its own channel to the same three via Zod.
  const CHANNEL_LABELS: Record<string, string> = {
    MNO: 'Mobile money',
    BANK: 'Bank transfer',
    CARD: 'Card',
  };

  /**
   * An unmapped channel is not the same as a missing one. Only a genuinely null
   * `paymentChannel` is "Not recorded"; a new value the platform starts writing
   * must show itself rather than hide as a gap in the data.
   */
  function channelLabel(key: string): string {
    if (CHANNEL_LABELS[key]) return CHANNEL_LABELS[key];
    if (key === 'UNKNOWN') return 'Not recorded';
    return key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
  }

  const channelTotals = new Map<string, { attempts: number; succeeded: number; failed: number }>();
  const providerTotals = new Map<string, { attempts: number; succeeded: number }>();

  for (const event of paymentEvents) {
    const status = String(event.status || '').toUpperCase();
    const succeeded = status === 'SUCCESS';
    const failed = status === 'FAILED';

    const channelKey = String(event.paymentChannel || '').toUpperCase() || 'UNKNOWN';
    const channel = channelTotals.get(channelKey) || { attempts: 0, succeeded: 0, failed: 0 };
    channel.attempts += 1;
    if (succeeded) channel.succeeded += 1;
    if (failed) channel.failed += 1;
    channelTotals.set(channelKey, channel);

    const providerKey = String(event.provider || 'Unknown').toUpperCase();
    const provider = providerTotals.get(providerKey) || { attempts: 0, succeeded: 0 };
    provider.attempts += 1;
    if (succeeded) provider.succeeded += 1;
    providerTotals.set(providerKey, provider);
  }

  const paymentChannels = [...channelTotals.entries()]
    .map(([key, totals]) => ({
      key,
      label: channelLabel(key),
      ...totals,
      // Anything neither confirmed nor rejected: the customer started a payment
      // that never resolved. Counting it as a failure would overstate rejection.
      pending: Math.max(0, totals.attempts - totals.succeeded - totals.failed),
      /** Share of successful payments. Zero for everyone when nothing ever succeeded. */
      share: 0,
      /** Share of attempts, which still describes preference when nothing succeeded. */
      attemptShare: 0,
    }))
    .sort((a, b) => b.attempts - a.attempts || b.succeeded - a.succeeded);

  const succeededTotal = paymentChannels.reduce((total, row) => total + row.succeeded, 0);
  const attemptedTotal = paymentChannels.reduce((total, row) => total + row.attempts, 0);
  paymentChannels.forEach((row) => {
    row.share = succeededTotal > 0 ? Math.round((row.succeeded / succeededTotal) * 100) : 0;
    row.attemptShare = attemptedTotal > 0 ? Math.round((row.attempts / attemptedTotal) * 100) : 0;
  });

  const paymentAttempts = paymentEvents.length;
  const paymentSucceeded = paymentEvents.filter((event: any) => String(event.status).toUpperCase() === 'SUCCESS').length;
  const paymentFailed = paymentEvents.filter((event: any) => String(event.status).toUpperCase() === 'FAILED').length;

  /**
   * Sharing and referrals.
   *
   * Two different things live under "sharing" and they are not equivalent:
   *
   * - A referral link carries `CUSTOMER-<id>` into registration, which writes
   *   `User.referredBy`. That is real attribution: we know exactly who joined
   *   through whom and when.
   * - A property share only stamps `SavedProperty.sharedAt`. There is no
   *   recipient, no token, and no way to know whether it led anywhere. It is
   *   reported as an activity count and explicitly not as attribution.
   */
  const [referrer, referredUsers, referralEarnings] = await Promise.all([
    user.referredBy
      ? prisma.user.findUnique({
          where: { id: user.referredBy },
          select: { id: true, name: true, email: true, role: true },
        }).catch(() => null)
      : Promise.resolve(null),
    prisma.user.findMany({
      where: { referredBy: id },
      select: { id: true, name: true, email: true, role: true, createdAt: true, registrationStatus: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }).catch(() => [] as any[]),
    prisma.referralEarning.findMany({
      where: { driverId: id },
      select: { id: true, amount: true, currency: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }).catch(() => [] as any[]),
  ]);

  // Tokenised shares. Fail-soft so the tab still renders on a deployment where
  // the expansion migration has not been applied yet.
  const propertyShares = await prisma.propertyShare.findMany({
    where: { sharerId: id, createdAt: createdInWindow },
    select: {
      id: true,
      channel: true,
      openCount: true,
      firstOpenedAt: true,
      registeredUserId: true,
      registeredAt: true,
      bookingId: true,
      convertedAt: true,
      createdAt: true,
      property: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  }).catch(() => [] as any[]);

  const sharedProperties = savedProperties.filter((row: any) => row.sharedAt).length;
  const referralCodeForUser = String(user.role || '').toUpperCase() === 'DRIVER'
    ? `DRIVER-${user.id}`
    : `CUSTOMER-${user.id}`;

  const earningsByStatus = new Map<string, { count: number; amount: number; currency: string }>();
  for (const earning of referralEarnings) {
    const key = String(earning.status || 'PENDING').toUpperCase();
    const bucket = earningsByStatus.get(key) || { count: 0, amount: 0, currency: String(earning.currency || 'TZS') };
    bucket.count += 1;
    bucket.amount += Number(earning.amount || 0);
    earningsByStatus.set(key, bucket);
  }

  const stayPaid = bookings.filter(
    (row: any) =>
      row.invoices?.some((invoice: any) => String(invoice.status).toUpperCase() === 'PAID') ||
      ['CHECKED_IN', 'CHECKED_OUT'].includes(String(row.status).toUpperCase()),
  ).length;
  const tourPaid = tourBookings.filter((row: any) => String(row.paymentStatus).toUpperCase() === 'PAID').length;
  const transportPaid = transportBookings.filter((row: any) => String(row.paymentStatus).toUpperCase() === 'PAID').length;
  const groupPaid = groupBookings.filter((row: any) => row.depositPaid === true).length;

  const funnel = [
    {
      key: 'stays',
      label: 'Stays',
      created: bookings.length,
      paid: stayPaid,
      completed: bookings.filter((row: any) => String(row.status).toUpperCase() === 'CHECKED_OUT').length,
      canceled: bookings.filter((row: any) => isCanceled(row.status)).length,
    },
    {
      key: 'tours',
      label: 'Tours',
      created: tourBookings.length,
      paid: tourPaid,
      completed: tourBookings.filter((row: any) => String(row.status).toUpperCase() === 'COMPLETED').length,
      canceled: tourBookings.filter((row: any) => isCanceled(row.status)).length,
    },
    {
      key: 'transport',
      label: 'Transport',
      created: transportBookings.length,
      paid: transportPaid,
      completed: transportBookings.filter((row: any) => String(row.status).toUpperCase() === 'COMPLETED').length,
      canceled: transportBookings.filter((row: any) => isCanceled(row.status)).length,
    },
    {
      key: 'groups',
      label: 'Group stays',
      created: groupBookings.length,
      paid: groupPaid,
      completed: groupBookings.filter((row: any) => String(row.status).toUpperCase() === 'COMPLETED').length,
      canceled: groupBookings.filter((row: any) => isCanceled(row.status)).length,
    },
  ].map((row) => ({
    ...row,
    // Created, never paid, never canceled: the customer walked away mid flow.
    abandoned: Math.max(0, row.created - row.paid - row.canceled),
  }));

  const totalCreated = funnel.reduce((total, row) => total + row.created, 0);
  const totalPaid = funnel.reduce((total, row) => total + row.paid, 0);
  const totalCanceled = funnel.reduce((total, row) => total + row.canceled, 0);
  const totalAbandoned = funnel.reduce((total, row) => total + row.abandoned, 0);

  // ── Conduct signals ────────────────────────────────────────────────────
  const failedOtp = auditRows.filter((row: any) => /OTP_VERIFY_FAILED/i.test(String(row.action))).length;
  const payoutMismatch = auditRows.filter((row: any) => /PAYOUT_LOOKUP_MISMATCH/i.test(String(row.action))).length;
  const credentialChanges = auditRows.filter((row: any) =>
    /PASSWORD_CHANGE|CONTACT_CHANGED|2FA_DISABLED/i.test(String(row.action)),
  ).length;
  const distinctIps = new Set(auditRows.map((row: any) => String(row.ip || '').trim()).filter(Boolean)).size;
  const distinctAgents = new Set(auditRows.map((row: any) => String(row.ua || '').trim()).filter(Boolean)).size;
  const hiddenReviews = reviews.filter((row: any) => row.isHidden === true).length;
  const openRestrictions = restrictions.filter((row: any) => String(row.status).toUpperCase() === 'OPEN').length;

  const cancellationRate = totalCreated > 0 ? totalCanceled / totalCreated : 0;
  const abandonmentRate = totalCreated > 0 ? totalAbandoned / totalCreated : 0;

  const signals = [
    {
      key: 'cancellationRate',
      label: 'Cancellation rate',
      value: `${Math.round(cancellationRate * 100)}%`,
      detail: `${totalCanceled} canceled of ${totalCreated} records`,
      threshold: 'Watch at 30%, action at 50%, once there are at least 3 records',
      severity: totalCreated >= 3 ? gradeSignal(cancellationRate, 0.3, 0.5) : ('CLEAN' as BehaviourSeverity),
    },
    {
      key: 'abandonmentRate',
      label: 'Payment abandonment',
      value: `${Math.round(abandonmentRate * 100)}%`,
      detail: `${totalAbandoned} created but never paid or canceled`,
      threshold: 'Watch at 50%, action at 80%, once there are at least 3 records',
      severity: totalCreated >= 3 ? gradeSignal(abandonmentRate, 0.5, 0.8) : ('CLEAN' as BehaviourSeverity),
    },
    {
      key: 'failedOtp',
      label: 'Failed OTP verifications',
      value: String(failedOtp),
      detail: `In the last ${recentDays} days`,
      threshold: 'Watch at 3, action at 10',
      severity: gradeSignal(failedOtp, 3, 10),
    },
    {
      key: 'payoutMismatch',
      label: 'Payout name mismatches',
      value: String(payoutMismatch),
      detail: 'Payout destination lookups that did not match the account holder',
      threshold: 'Watch at 1, action at 3',
      severity: gradeSignal(payoutMismatch, 1, 3),
    },
    {
      key: 'distinctIps',
      label: 'Distinct IP addresses',
      value: String(distinctIps),
      detail: `${distinctAgents} distinct devices in the last ${recentDays} days`,
      threshold: 'Watch at 5, action at 10',
      severity: gradeSignal(distinctIps, 5, 10),
    },
    {
      key: 'credentialChanges',
      label: 'Credential changes',
      value: String(credentialChanges),
      detail: 'Password, contact, or 2FA changes recorded',
      threshold: 'Watch at 3, action at 6',
      severity: gradeSignal(credentialChanges, 3, 6),
    },
    {
      key: 'hiddenReviews',
      label: 'Reviews hidden by moderation',
      value: String(hiddenReviews),
      detail: `${reviews.length} reviews written in total`,
      threshold: 'Watch at 1, action at 3',
      severity: gradeSignal(hiddenReviews, 1, 3),
    },
    {
      key: 'restrictions',
      label: 'Open restriction cases',
      value: String(openRestrictions),
      detail: `${restrictions.length} restriction cases on record`,
      threshold: 'Any open case is an action item',
      severity: openRestrictions > 0 ? ('ACTION' as BehaviourSeverity) : ('CLEAN' as BehaviourSeverity),
    },
  ];

  const accountSuspended = Boolean(user.suspendedAt) || user.isDisabled === true;
  const band: BehaviourSeverity = accountSuspended
    ? 'ACTION'
    : (signals.reduce<BehaviourSeverity>(
        (worst, signal) => (severityRank(signal.severity) > severityRank(worst) ? signal.severity : worst),
        'CLEAN',
      ));

  return res.json({
    window: { from: windowStart.toISOString(), to: windowEnd.toISOString(), recentDays },
    filters: { months: requestedMonths, recentDays, products, custom: Boolean(customFrom || customTo), isFiltered },
    engagement: {
      months,
      series: months.map((month) => ({ month, ...(buckets.get(month) || emptyMonth()) })),
      joinedAt: user.createdAt,
      lastActivityAt,
      lastLoginAt,
      lastSeenAt,
      totalLogins: sessions.length,
      recentLogins,
      activeSessions: sessions.filter((row: any) => !row.revokedAt).length,
    },
    preferences: {
      byProduct,
      topDestinations,
      savedProperties: savedProperties.length,
      tripEstimates: tripEstimates.length,
      reviewsWritten: reviews.length,
      averageRating: reviews.length
        ? Number((sum(reviews, 'rating') / reviews.length).toFixed(1))
        : null,
    },
    funnel: {
      byProduct: funnel,
      totals: { created: totalCreated, paid: totalPaid, canceled: totalCanceled, abandoned: totalAbandoned },
      // Trip estimates are intent without a booking: the step before the funnel.
      plannedNeverBooked: Math.max(0, tripEstimates.length - totalCreated),
    },
    sharing: {
      referralCode: referralCodeForUser,
      referralLink: `${process.env.WEB_ORIGIN || process.env.FRONTEND_URL || process.env.APP_ORIGIN || ''}/account/register?ref=${referralCodeForUser}`,
      referredBy: referrer
        ? { id: referrer.id, name: referrer.name, email: referrer.email, role: referrer.role, codeUsed: user.referralCode || null }
        : null,
      referredUsers: referredUsers.map((row: any) => ({
        id: row.id,
        name: row.name,
        email: row.email,
        role: row.role,
        registrationStatus: row.registrationStatus,
        createdAt: row.createdAt,
      })),
      referredCount: referredUsers.length,
      completedCount: referredUsers.filter((row: any) => String(row.registrationStatus).toUpperCase() === 'COMPLETE').length,
      earnings: [...earningsByStatus.entries()].map(([status, bucket]) => ({
        status,
        count: bucket.count,
        amount: Math.round(bucket.amount),
        currency: bucket.currency,
      })),
      propertiesShared: sharedProperties,
      // The tracked funnel. `legacyShares` are pre-token shares that can never
      // be attributed, reported separately so they are not mistaken for
      // tracked links that simply performed badly.
      shareFunnel: {
        shared: propertyShares.length,
        opened: propertyShares.filter((row: any) => row.openCount > 0).length,
        totalOpens: propertyShares.reduce((total: number, row: any) => total + Number(row.openCount || 0), 0),
        registered: propertyShares.filter((row: any) => row.registeredUserId).length,
        booked: propertyShares.filter((row: any) => row.bookingId).length,
        legacyShares: Math.max(0, sharedProperties - propertyShares.length),
      },
      shares: propertyShares.map((row: any) => ({
        id: row.id,
        propertyId: row.property?.id ?? null,
        propertyTitle: row.property?.title ?? null,
        channel: row.channel,
        openCount: row.openCount,
        firstOpenedAt: row.firstOpenedAt,
        registeredUserId: row.registeredUserId,
        registeredAt: row.registeredAt,
        bookingId: row.bookingId,
        convertedAt: row.convertedAt,
        createdAt: row.createdAt,
      })),
      shareAttributionNote:
        'Tracked shares carry a token and are attributable end to end. Shares sent before tokens existed record a timestamp only and can never be traced to a registration.',
    },
    payments: {
      attempts: paymentAttempts,
      succeeded: paymentSucceeded,
      failed: paymentFailed,
      successRate: paymentAttempts > 0 ? Math.round((paymentSucceeded / paymentAttempts) * 100) : null,
      channels: paymentChannels,
      providers: [...providerTotals.entries()]
        .map(([provider, totals]) => ({ provider, ...totals }))
        .sort((a, b) => b.succeeded - a.succeeded || b.attempts - a.attempts)
        .slice(0, 6),
      coverage: 'Stays, tours, and group stays. Ride payments are not recorded against payment events.',
    },
    conduct: {
      band,
      accountSuspended,
      signals,
      restrictions,
    },
    coverage: {
      note: 'Derived from booking, payment, session, and audit records. The platform does not record browsing, searches, or page views, so these funnels start at the first created booking.',
    },
  });
}));

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
    const errorCode =
      typeof err === 'object' && err !== null && 'code' in err
        ? String(err.code)
        : '';
    // P2022: Column does not exist in the current database.
    if (errorCode === 'P2022') {
      return res.status(400).json({ error: 'disable not supported - add isDisabled column via migration' });
    }
    console.error('PATCH /admin/users/:id error:', err);
    res.status(500).json({ error: 'failed' });
  }
});

export default router;
