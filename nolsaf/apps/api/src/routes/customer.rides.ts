import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { customerRecordReference } from "../lib/customerBookingReference.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

/**
 * GET /api/customer/rides
 * Get all transportation/ride bookings for the authenticated customer
 * Query params: status, page, pageSize
 */
router.get("/", async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user!.id;
    const { status, page = "1", pageSize = "20" } = req.query as any;
    
    // Note: This assumes you have a TransportBooking or similar model
    // Adjust based on your actual schema
    const where: any = { userId };
    if (status) {
      where.status = String(status);
    }

    const pageNum = Number(page);
    const pageSizeNum = Number(pageSize);
    const skip = (pageNum - 1) * pageSizeNum;

    // Fetch transport bookings
    let rides: any[] = [];
    let total = 0;

    try {
      const [items, count] = await Promise.all([
        prisma.transportBooking.findMany({
          where,
          select: {
            id: true,
            scheduledDate: true,
            pickupTime: true,
            dropoffTime: true,
            fromRegion: true,
            fromDistrict: true,
            fromWard: true,
            fromAddress: true,
            toRegion: true,
            toDistrict: true,
            toWard: true,
            toAddress: true,
            status: true,
            amount: true,
            rating: true,
            createdAt: true,
            driver: {
              select: {
                id: true,
                name: true,
                phone: true,
                email: true,
              },
            },
            property: {
              select: {
                id: true,
                title: true,
                regionName: true,
                district: true,
                city: true,
              },
            },
          },
          orderBy: { scheduledDate: "desc" },
          skip,
          take: pageSizeNum,
        }),
        prisma.transportBooking.count({ where }),
      ]);

      rides = items.map((ride: any) => {
        const scheduledDate = new Date(ride.scheduledDate || ride.createdAt);
        const now = new Date();
        const isValid = scheduledDate >= now && ride.status !== "CANCELED" && ride.status !== "COMPLETED";

        return {
          id: ride.id,
          rideReference: customerRecordReference("ride", ride.id),
          scheduledDate: ride.scheduledDate || ride.createdAt,
          pickupTime: ride.pickupTime || null,
          dropoffTime: ride.dropoffTime || null,
          fromRegion: ride.fromRegion || null,
          fromDistrict: ride.fromDistrict || null,
          fromWard: ride.fromWard || null,
          fromAddress: ride.fromAddress || null,
          toRegion: ride.toRegion || ride.property?.regionName || null,
          toDistrict: ride.toDistrict || ride.property?.district || null,
          toWard: ride.toWard || null,
          toAddress: ride.toAddress || ride.property?.title || null,
          driver: ride.driver,
          property: ride.property,
          status: ride.status,
          amount: ride.amount || null,
          rating: ride.rating || null,
          isValid,
          createdAt: ride.createdAt,
        };
      });

      total = count;
    } catch (error: any) {
      console.error("Failed to fetch transport bookings:", error);
      // Return empty results on error
    }

    return res.json({
      items: rides,
      total,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /customer/rides error:", error);
    return res.status(500).json({ error: "Failed to fetch rides" });
  }
});

export default router;
