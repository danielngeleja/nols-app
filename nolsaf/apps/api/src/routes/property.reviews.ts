// apps/api/src/routes/property.reviews.ts
import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { z } from "zod";
import { averageCategoryRatings } from "../lib/nrmsReviewCategories.js";
import { StayReviewError, createStayReview, findFinishedStay, finishedStayWhere } from "../lib/stayReviews.js";

const router = Router();

/** "Amina Kassim Juma" becomes "Amina J."; a single name stays as is. */
export function publicGuestName(raw: string | null | undefined): string {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "Guest";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// Schema for creating a review
const createReviewSchema = z.object({
  propertyId: z.number().int().positive(),
  rating: z.number().int().min(1).max(5),
  title: z.string().max(200).transform((v) => v.replace(/<[^>]*>/g, "")).optional().nullable(),
  comment: z.string().max(5000).transform((v) => v.replace(/<[^>]*>/g, "")).optional().nullable(),
  // Keys come from the shared registry (customerCare, security, reality,
  // comfort, ...); unknown keys and skipped (null) categories are dropped.
  categoryRatings: z.record(z.string(), z.unknown()).optional().nullable(),
  bookingId: z.number().int().positive().optional().nullable(),
});

/**
 * GET /property-reviews/:propertyId
 * Get all published reviews for a property
 */
router.get("/:propertyId", async (req, res) => {
  try {
    const propertyId = Number(req.params.propertyId);
    if (!propertyId || isNaN(propertyId)) {
      return res.status(400).json({ error: "Invalid property ID" });
    }

    const rows = await prisma.propertyReview.findMany({
      where: {
        propertyId,
        isPublished: true,
        isHidden: false,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 50, // Limit to 50 most recent reviews
      select: {
        id: true,
        rating: true,
        title: true,
        comment: true,
        categoryRatings: true,
        isVerified: true,
        ownerResponse: true,
        ownerResponseAt: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            fullName: true,
            // Don't expose email/phone for privacy
          },
        },
      },
    });

    // Public page: first name and last initial only ("Amina K."), never a full name.
    const reviews = rows.map(({ user, ...rest }: any) => ({
      ...rest,
      user: user ? { id: user.id, name: publicGuestName(user.fullName || user.name) } : null,
    }));

    // Calculate aggregate statistics
    const stats = {
      totalReviews: reviews.length,
      averageRating: reviews.length > 0
        ? reviews.reduce((sum: number, r: any) => sum + r.rating, 0) / reviews.length
        : 0,
      ratingDistribution: {
        5: reviews.filter((r: any) => r.rating === 5).length,
        4: reviews.filter((r: any) => r.rating === 4).length,
        3: reviews.filter((r: any) => r.rating === 3).length,
        2: reviews.filter((r: any) => r.rating === 2).length,
        1: reviews.filter((r: any) => r.rating === 1).length,
      },
      // Averages over the reviews that rated each category; categories nobody rated are left out.
      categoryAverages: (() => {
        const averages = averageCategoryRatings(reviews as Array<{ categoryRatings: unknown }>);
        return averages.length ? Object.fromEntries(averages.map((item) => [item.key, item.average])) : null;
      })(),
    };

    res.json({
      reviews,
      stats,
    });
  } catch (err: any) {
    console.error("Get reviews error:", err);
    res.status(500).json({ error: "Failed to fetch reviews" });
  }
});

/**
 * POST /property-reviews
 * Create a new review (requires authentication)
 */
router.post("/", requireAuth, blockImpersonated as any, async (req, res) => {
  try {
    const userId = (req as AuthedRequest).user!.id;
    const parsed = createReviewSchema.parse((req as any).body);

    // Reviews come from guests who stayed. The stay is the guest's own finished
    // booking at this property; a bookingId from the browser only picks which one.
    const booking = parsed.bookingId
      ? await prisma.booking.findFirst({
          where: { id: parsed.bookingId, userId, propertyId: parsed.propertyId, ...finishedStayWhere() },
          select: { id: true, propertyId: true, status: true, checkOut: true, code: { select: { id: true } } },
        })
      : await findFinishedStay(userId, parsed.propertyId);
    if (!booking) {
      return res.status(403).json({
        error: "Only guests who stayed here through NoLSAF can review it. After check-out you can rate your stay from My bookings.",
        code: "STAY_REQUIRED",
      });
    }

    const review = await createStayReview({ userId, booking, review: parsed });
    res.status(201).json({ ...review, user: review.user ? { id: review.user.id, name: publicGuestName(review.user.name) } : null });
  } catch (err: any) {
    if (err instanceof StayReviewError) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid request data", details: err.issues });
    }
    console.error("Create review error:", err);
    res.status(500).json({ error: "Failed to create review" });
  }
});

// Owner replies live in routes/owner.reviews.ts (owner-only, no support sessions).

export default router;
