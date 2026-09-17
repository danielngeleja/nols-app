import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { storedReferralCodesFor } from "../lib/referralCode.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("DRIVER") as unknown as RequestHandler);

/**
 * GET /api/driver/referral/performance
 * Returns referral performance metrics for the authenticated driver
 */
router.get("/", async (req, res) => {
  try {
    const user = (req as any).user;
    const driverId = user?.id;
    if (!driverId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    // Get referral data
    let totalReferrals = 0;
    let activeReferrals = 0;
    let completedReferrals = 0;
    let referrals: any[] = [];

    try {
      // Get referrals from User table
      const referredUsers = await prisma.user.findMany({
        where: {
          OR: [
            { referredBy: Number(driverId) },
            // Exact codes only. The old `contains` on the last digits of the id also
            // matched other people's codes (driver 2 matched CUSTOMER-12, DRIVER-20...).
            { referralCode: { in: storedReferralCodesFor("DRIVER", Number(driverId)) } },
          ],
        },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
        },
      });

      totalReferrals = referredUsers.length;

      // Check activity for each referral
      for (const user of referredUsers) {
        let isActive = false;
        let isCompleted = false;

        try {
          // Check if user has used platform
          if (user.role === "CUSTOMER" || user.role === "USER") {
            if ((prisma as any).booking) {
              const bookings = await (prisma as any).booking.findMany({
                where: { userId: user.id },
                select: { status: true },
              });
              isActive = bookings.length > 0;
              isCompleted = bookings.filter((b: any) => b.status === "COMPLETED").length >= 5;
            }
          } else if (user.role === "OWNER") {
            if ((prisma as any).property) {
              const properties = await (prisma as any).property.count({
                where: { ownerId: user.id },
              });
              isActive = properties > 0;
            }
          } else if (user.role === "DRIVER") {
            if ((prisma as any).booking) {
              const trips = await (prisma as any).booking.count({
                where: { driverId: user.id, status: "COMPLETED" },
              });
              isActive = trips > 0;
            }
          }
        } catch (e) {
          console.warn("Failed to check referral activity", e);
        }

        if (isActive || isCompleted) activeReferrals++;
        if (isCompleted) completedReferrals++;

        referrals.push({
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive,
          isCompleted,
          joinedAt: user.createdAt,
        });
      }
    } catch (e) {
      console.warn("Failed to fetch referrals", e);
    }

    // Get referral earnings
    let earningsSummary = {
      total: 0,
      pending: 0,
      availableForWithdrawal: 0,
      paidAsBonus: 0,
      withdrawn: 0,
    };

    let monthlyEarnings = 0;
    let yearlyEarnings = 0;
    let recentEarnings: any[] = [];

    try {
      if ((prisma as any).referralEarning) {
        // Get all earnings
        const allEarnings = await (prisma as any).referralEarning.findMany({
          where: { driverId: Number(driverId) },
          select: {
            id: true,
            amount: true,
            status: true,
            createdAt: true,
            referredUser: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: 10, // Recent 10
        });

        // Calculate summary
        allEarnings.forEach((earning: any) => {
          const amount = Number(earning.amount || 0);
          earningsSummary.total += amount;

          const earningDate = new Date(earning.createdAt);
          if (earningDate >= startOfMonth) monthlyEarnings += amount;
          if (earningDate >= startOfYear) yearlyEarnings += amount;

          switch (earning.status) {
            case "PENDING":
              earningsSummary.pending += amount;
              break;
            case "AVAILABLE_FOR_WITHDRAWAL":
              earningsSummary.availableForWithdrawal += amount;
              break;
            case "PAID_AS_BONUS":
              earningsSummary.paidAsBonus += amount;
              break;
            case "WITHDRAWN":
              earningsSummary.withdrawn += amount;
              break;
          }
        });

        recentEarnings = allEarnings.map((e: any) => ({
          id: e.id,
          amount: Number(e.amount || 0),
          status: e.status,
          createdAt: e.createdAt,
          referredUser: e.referredUser,
        }));
      }
    } catch (e) {
      console.warn("Failed to fetch referral earnings", e);
    }

    // Get withdrawal history
    let withdrawalsSummary = {
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      paid: 0,
    };

    let recentWithdrawals: any[] = [];

    try {
      if ((prisma as any).referralWithdrawal) {
        const withdrawals = await (prisma as any).referralWithdrawal.findMany({
          where: { driverId: Number(driverId) },
          orderBy: { createdAt: "desc" },
          take: 5, // Recent 5
        });

        withdrawals.forEach((w: any) => {
          const amount = Number(w.totalAmount || 0);
          withdrawalsSummary.total += amount;

          switch (w.status) {
            case "PENDING":
              withdrawalsSummary.pending += amount;
              break;
            case "APPROVED":
              withdrawalsSummary.approved += amount;
              break;
            case "REJECTED":
              withdrawalsSummary.rejected += amount;
              break;
            case "PAID":
              withdrawalsSummary.paid += amount;
              break;
          }
        });

        recentWithdrawals = withdrawals.map((w: any) => ({
          id: w.id,
          totalAmount: Number(w.totalAmount || 0),
          status: w.status,
          createdAt: w.createdAt,
          approvedAt: w.approvedAt,
          paidAt: w.paidAt,
        }));
      }
    } catch (e) {
      console.warn("Failed to fetch withdrawals", e);
    }

    // Calculate conversion rate
    const conversionRate = totalReferrals > 0 
      ? Math.round((activeReferrals / totalReferrals) * 100) 
      : 0;

    // Calculate average credits per referral
    const avgCreditsPerReferral = totalReferrals > 0
      ? Math.round(earningsSummary.total / totalReferrals)
      : 0;

    return res.json({
      driver: {
        id: Number(driverId),
      },
      referrals: {
        total: totalReferrals,
        active: activeReferrals,
        completed: completedReferrals,
        conversionRate,
        avgCreditsPerReferral,
        list: referrals,
      },
      earnings: {
        summary: earningsSummary,
        monthly: monthlyEarnings,
        yearly: yearlyEarnings,
        recent: recentEarnings,
      },
      withdrawals: {
        summary: withdrawalsSummary,
        recent: recentWithdrawals,
      },
      period: {
        current: now.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
        startOfMonth: startOfMonth.toISOString(),
        startOfYear: startOfYear.toISOString(),
      },
    });
  } catch (err: any) {
    console.error("Error fetching referral performance:", err);
    return res.status(500).json({ error: "Internal server error", message: err.message });
  }
});

export default router;

