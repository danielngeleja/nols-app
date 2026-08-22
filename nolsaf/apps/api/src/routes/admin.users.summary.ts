import { Router } from "express";
import type { RequestHandler } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "@nolsaf/prisma";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

const RECENT_CUSTOMERS_LIMIT = 5;

/** GET /admin/users/summary - Customer-focused statistics */
router.get("/", async (_req, res) => {
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

    // A customer verified through both channels is still one verified customer.
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
        registrationStatus: true,
        registrationSource: true,
      },
      orderBy: { createdAt: "desc" },
      take: RECENT_CUSTOMERS_LIMIT,
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

    const [totalTourBookings, totalTransportBookings] = await Promise.all([
      prisma.tourBooking.count({ where: { customerId: { not: null } } }).catch(() => 0),
      prisma.transportBooking.count({ where: { userId: { not: null } } }).catch(() => 0),
    ]);

    // Active means activity in any customer-facing product, not only stays.
    const activeCustomers = await prisma.user.count({
      where: {
        role: "CUSTOMER",
        OR: [
          { bookings: { some: {} } },
          { groupBookings: { some: {} } },
          { tourBookings: { some: {} } },
          { transportBookingsAsCustomer: { some: {} } },
        ],
      },
    });

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

export default router;

