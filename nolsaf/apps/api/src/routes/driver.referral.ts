import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, AuthedRequest } from "../middleware/auth.js";
import { referralCodeFor, storedReferralCodesFor } from "../lib/referralCode.js";

const router = Router();
router.use(requireAuth as unknown as RequestHandler);

/**
 * GET /driver/referral
 * Returns referral information for the authenticated driver
 */
const getDriverReferral: RequestHandler = async (req, res) => {
  try {
    const user = (req as AuthedRequest).user!;
    const driverId = user.id;

    // Opaque: derived from the driver id without exposing it (lib/referralCode.ts).
    const referralCode = referralCodeFor("DRIVER", driverId);
    const referralLink = `${process.env.FRONTEND_URL || process.env.WEB_ORIGIN || process.env.APP_ORIGIN || 'http://localhost:3000'}/register?ref=${encodeURIComponent(referralCode)}`;

    // Fetch referrals (users who signed up with this driver's referral code)
    let referrals: any[] = [];
    let totalReferrals = 0;
    let activeReferrals = 0;
    let totalCredits = 0;
    let pendingCredits = 0;

    try {
      // First, check if there's a dedicated Referral table
      if ((prisma as any).referral) {
        const referralRecords = await (prisma as any).referral.findMany({
          where: { referrerId: driverId },
          include: {
            referredUser: {
              select: {
                id: true,
                fullName: true,
                name: true,
                email: true,
                createdAt: true,
                region: true,
                district: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        if (referralRecords.length > 0) {
          // Check for platform usage to determine status
          for (const ref of referralRecords) {
            const referredUserId = ref.referredUser?.id || ref.referredUserId;
            let status = 'active' as 'active' | 'completed';
            let spend = 0;
            let creditsEarned = 0;
            const referredUser = ref.referredUser;
            const userRole = (referredUser as any)?.role;

            // Check if user has used the platform (active = used platform at least once)
            try {
              let hasUsedPlatform = false;

              // Check for OWNER: has listed properties
              if (userRole === 'OWNER') {
                if ((prisma as any).property) {
                  const propertyCount = await (prisma as any).property.count({
                    where: { ownerId: referredUserId },
                  });
                  hasUsedPlatform = propertyCount > 0;
                }
                // OWNER: spend = 0, credits = 0 (only counts for level/bonus)
                spend = 0;
                creditsEarned = 0;
              }
              // Check for DRIVER: has completed trips
              else if (userRole === 'DRIVER') {
                if ((prisma as any).booking) {
                  const tripCount = await (prisma as any).booking.count({
                    where: { driverId: referredUserId, status: 'COMPLETED' },
                  });
                  hasUsedPlatform = tripCount > 0;
                }
                // DRIVER: spend = 0, credits = 0 (only counts for level/bonus)
                spend = 0;
                creditsEarned = 0;
              }
              // Check for CUSTOMER/USER/TRAVELLER: has made bookings and calculate spend
              else if (userRole === 'CUSTOMER' || userRole === 'USER') {
                if ((prisma as any).booking) {
                  const bookings = await (prisma as any).booking.findMany({
                    where: { userId: referredUserId },
                    select: { price: true, total: true, fare: true, status: true },
                  });
                  hasUsedPlatform = bookings.length > 0;
                  
                  // Calculate total spend from completed bookings
                  const completedBookings = bookings.filter((b: any) => b.status === 'COMPLETED');
                  spend = completedBookings.reduce((sum: number, b: any) => sum + (Number(b.price || b.total || b.fare) || 0), 0);

                  // Calculate credits: 0.35% of each completed booking (continuous rewarding)
                  if (completedBookings.length > 0) {
                    creditsEarned = completedBookings.reduce((sum: number, b: any) => {
                      const bookingAmount = Number(b.price || b.total || b.fare) || 0;
                      return sum + Math.round(bookingAmount * 0.0035); // 0.35% per booking
                    }, 0);
                    
                    // Check for completed status (5+ completed bookings)
                    if (completedBookings.length >= 5) {
                      status = 'completed';
                    }
                  }
                }
              }

              // If user has used platform, they are active
              if (hasUsedPlatform) {
                status = 'active';
              }
            } catch (e) {
              console.warn('Failed to check platform usage', e);
              // Default to active if check fails
              status = 'active';
              if (userRole === 'CUSTOMER' || userRole === 'USER') {
                creditsEarned = 500;
              }
            }

            referrals.push({
              id: String(ref.referredUser?.id || ref.id),
              name: ref.referredUser?.fullName || 'N/A',
              email: ref.referredUser?.email || 'N/A',
              status,
              joinedAt: ref.referredUser?.createdAt || ref.createdAt || new Date().toISOString(),
              registeredAt: ref.referredUser?.createdAt || ref.createdAt || new Date().toISOString(),
              linkSharedAt: ref.createdAt || ref.sharedAt || new Date(ref.referredUser?.createdAt || Date.now()).toISOString(),
              region: ref.referredUser?.region || ref.region || null,
              district: ref.referredUser?.district || ref.district || null,
              spend,
              creditsEarned,
            });
          }

          totalReferrals = referrals.length;
          activeReferrals = referrals.filter((r: any) => r.status === 'active' || r.status === 'completed').length;
          totalCredits = referrals.reduce((sum: number, r: any) => sum + r.creditsEarned, 0);
          pendingCredits = 0; // No pending credits since all registered users who use platform are active
        }
      }

      // If no referral table, check user table for referredBy field
      if (referrals.length === 0 && (prisma as any).user) {
        const referredUsers = await (prisma as any).user.findMany({
          where: {
            OR: [
              { referredBy: driverId },
              { referralCode: { in: storedReferralCodesFor("DRIVER", driverId) } },
            ],
          },
          select: {
            id: true,
            fullName: true,
            name: true,
            email: true,
            createdAt: true,
            region: true,
            district: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
        });

        // Check each user's platform usage to determine status
        for (const ref of referredUsers) {
          let status = 'active' as 'active' | 'completed';
          let spend = 0;
          let creditsEarned = 0;
          const userRole = (ref as any).role;

          try {
            let hasUsedPlatform = false;

            // Check for OWNER: has listed properties
            if (userRole === 'OWNER') {
              if ((prisma as any).property) {
                const propertyCount = await (prisma as any).property.count({
                  where: { ownerId: ref.id },
                });
                hasUsedPlatform = propertyCount > 0;
              }
              // OWNER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }
            // Check for DRIVER: has completed trips
            else if (userRole === 'DRIVER') {
              if ((prisma as any).booking) {
                const tripCount = await (prisma as any).booking.count({
                  where: { driverId: ref.id, status: 'COMPLETED' },
                });
                hasUsedPlatform = tripCount > 0;
              }
              // DRIVER: spend = 0, credits = 0 (only counts for level/bonus)
              spend = 0;
              creditsEarned = 0;
            }
            // Check for CUSTOMER/USER/TRAVELLER: has made bookings and calculate spend
            else if (userRole === 'CUSTOMER' || userRole === 'USER') {
              if ((prisma as any).booking) {
                const bookings = await (prisma as any).booking.findMany({
                  where: { userId: ref.id },
                  select: { price: true, total: true, fare: true, status: true },
                });
                hasUsedPlatform = bookings.length > 0;
                
                // Calculate total spend from completed bookings
                const completedBookings = bookings.filter((b: any) => b.status === 'COMPLETED');
                spend = completedBookings.reduce((sum: number, b: any) => sum + (Number(b.price || b.total || b.fare) || 0), 0);

                // Calculate credits: 0.35% of each completed booking (continuous rewarding)
                if (completedBookings.length > 0) {
                  creditsEarned = completedBookings.reduce((sum: number, b: any) => {
                    const bookingAmount = Number(b.price || b.total || b.fare) || 0;
                    return sum + Math.round(bookingAmount * 0.0035); // 0.35% per booking
                  }, 0);
                  
                  // Check for completed status (5+ completed bookings)
                  if (completedBookings.length >= 5) {
                    status = 'completed';
                  }
                }
              }
            }

            // If user has used platform, they are active
            if (hasUsedPlatform) {
              status = 'active';
            }
          } catch (e) {
            console.warn('Failed to check platform usage for user', ref.id, e);
            // Default to active if check fails
            status = 'active';
            if (userRole === 'CUSTOMER' || userRole === 'USER') {
              creditsEarned = 0;
            }
          }

          referrals.push({
            id: String(ref.id),
            name: ref.fullName || 'N/A',
            email: ref.email || 'N/A',
            status,
            joinedAt: ref.createdAt || new Date().toISOString(),
            registeredAt: ref.createdAt || new Date().toISOString(),
            linkSharedAt: ref.referralSharedAt || ref.createdAt || new Date().toISOString(),
            region: ref.region || null,
            district: ref.district || null,
            spend,
            creditsEarned,
          });
        }

        totalReferrals = referrals.length;
        activeReferrals = referrals.filter((r: any) => r.status === 'active' || r.status === 'completed').length;
        totalCredits = referrals.reduce((sum: number, r: any) => sum + r.creditsEarned, 0);
        pendingCredits = 0; // No pending credits since all registered users who use platform are active
      }
    } catch (e) {
      console.warn('Failed to fetch referrals', e);
      // Continue with empty referrals array
    }

    return res.json({
      referralCode,
      referralLink,
      totalReferrals,
      activeReferrals,
      totalCredits,
      pendingCredits,
      referrals,
    });
  } catch (err: any) {
    console.error('Failed to fetch driver referral', err);
    return res.status(500).json({ error: 'Failed to fetch referral data' });
  }
};

router.get('/', getDriverReferral as unknown as RequestHandler);

export default router;

