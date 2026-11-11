/**
 * Owner review inbox: guest reviews across the signed-in owner's properties,
 * and the owner's public reply to each one.
 *
 * Signed-in owners only, never during an admin support session (a reply is
 * published under the owner's name). Every lookup is scoped to properties the
 * session user owns; a review on someone else's property reads as not found.
 * Reviews NoLSAF has hidden or unpublished are not listed and cannot be
 * answered, since no guest can see them.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { limitOwnerReviewReply } from "../middleware/rateLimit.js";
import { sanitizeText } from "../lib/sanitize.js";

export const router = Router();
router.use(
  requireAuth as RequestHandler,
  requireRole("OWNER") as RequestHandler,
  blockImpersonated as RequestHandler,
);
const limitWrites = limitOwnerReviewReply as unknown as RequestHandler;

export const REPLY_MAX = 2000;

const idParams = z.object({ id: z.coerce.number().int().positive() });
const listQuery = z.object({
  filter: z.enum(["all", "unanswered", "answered"]).default("all"),
  property: z.coerce.number().int().positive().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});
const replySchema = z.object({
  response: z.string().transform(sanitizeText).pipe(z.string().trim().min(2, "Write a reply first").max(REPLY_MAX)),
});

const PAGE_SIZE = 20;

/** Reviews a guest can see on one of this owner's properties. */
function visibleOwned(userId: number) {
  return { isPublished: true, isHidden: false, property: { ownerId: userId } };
}

/** First name and last initial only: the owner never gets guest contact details here. */
function guestName(user: { name?: string | null; fullName?: string | null } | null) {
  const full = (user?.fullName || user?.name || "").trim();
  if (!full) return "Guest";
  const parts = full.split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]?.toUpperCase()}.` : parts[0];
}

function publicReview(row: any) {
  return {
    id: row.id,
    rating: row.rating,
    title: row.title ?? null,
    comment: row.comment ?? null,
    categoryRatings: row.categoryRatings ?? null,
    isVerified: Boolean(row.isVerified),
    createdAt: row.createdAt,
    ownerResponse: row.ownerResponse ?? null,
    ownerResponseAt: row.ownerResponseAt ?? null,
    guest: { name: guestName(row.user) },
    property: { id: row.property?.id, title: row.property?.title ?? "" },
  };
}

const reviewSelect = {
  id: true,
  rating: true,
  title: true,
  comment: true,
  categoryRatings: true,
  isVerified: true,
  createdAt: true,
  ownerResponse: true,
  ownerResponseAt: true,
  user: { select: { name: true, fullName: true } },
  property: { select: { id: true, title: true } },
};

/** GET /api/owner/reviews/count: sidebar badge. */
router.get("/count", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const [total, unanswered] = await Promise.all([
    prisma.propertyReview.count({ where: visibleOwned(userId) }),
    prisma.propertyReview.count({ where: { ...visibleOwned(userId), ownerResponse: null } }),
  ]);
  res.json({ total, unanswered });
}));

/** GET /api/owner/reviews: one page of reviews plus the owner's totals. */
router.get("/", asyncHandler(async (req: AuthedRequest, res: Response) => {
  const userId = req.user!.id;
  const parsed = listQuery.safeParse(req.query);
  const q = parsed.success ? parsed.data : listQuery.parse({});

  const base = visibleOwned(userId);
  const where: any = { ...base };
  if (q.property) where.propertyId = q.property;
  if (q.rating) where.rating = q.rating;
  if (q.filter === "unanswered") where.ownerResponse = null;
  if (q.filter === "answered") where.ownerResponse = { not: null };

  const [rows, matching, total, unanswered, average, properties, byRating, byProperty, openByProperty] = await Promise.all([
    prisma.propertyReview.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: reviewSelect,
    }),
    prisma.propertyReview.count({ where }),
    prisma.propertyReview.count({ where: base }),
    prisma.propertyReview.count({ where: { ...base, ownerResponse: null } }),
    prisma.propertyReview.aggregate({ where: base, _avg: { rating: true } }),
    // Only properties that have something to show, for the filter.
    prisma.property.findMany({
      where: { ownerId: userId, reviews: { some: { isPublished: true, isHidden: false } } },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
    prisma.propertyReview.groupBy({ by: ["rating"], where: base, _count: { _all: true } }),
    prisma.propertyReview.groupBy({ by: ["propertyId"], where: base, _count: { _all: true }, _avg: { rating: true } }),
    prisma.propertyReview.groupBy({ by: ["propertyId"], where: { ...base, ownerResponse: null }, _count: { _all: true } }),
  ]);

  const distribution: Record<string, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const row of byRating as any[]) distribution[String(row.rating)] = row._count._all;
  const stats = new Map<number, any>((byProperty as any[]).map((row) => [row.propertyId, row]));
  const open = new Map<number, number>((openByProperty as any[]).map((row) => [row.propertyId, row._count._all]));

  res.json({
    reviews: rows.map(publicReview),
    page: q.page,
    pageSize: PAGE_SIZE,
    matching,
    summary: {
      total,
      unanswered,
      averageRating: average._avg.rating ? Number(average._avg.rating.toFixed(2)) : null,
      distribution,
    },
    properties: properties.map((p) => ({
      id: p.id,
      title: p.title,
      total: stats.get(p.id)?._count?._all ?? 0,
      averageRating: stats.get(p.id)?._avg?.rating ? Number(stats.get(p.id)._avg.rating.toFixed(2)) : null,
      unanswered: open.get(p.id) ?? 0,
    })),
  });
}));

async function findOwned(reviewId: number, userId: number) {
  return prisma.propertyReview.findFirst({
    where: { id: reviewId, ...visibleOwned(userId) },
    select: { id: true },
  });
}

/** PUT /api/owner/reviews/:id/response: post or edit the public reply. */
router.put("/:id/response", limitWrites, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  if (!params.success) return res.status(404).json({ error: "Review not found" });
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message || `Keep your reply between 2 and ${REPLY_MAX} characters` });
  }
  const userId = req.user!.id;
  if (!(await findOwned(params.data.id, userId))) return res.status(404).json({ error: "Review not found" });

  const updated = await prisma.propertyReview.update({
    where: { id: params.data.id },
    data: { ownerResponse: parsed.data.response, ownerResponseAt: new Date() },
    select: reviewSelect,
  });
  res.json({ review: publicReview(updated) });
}));

/** DELETE /api/owner/reviews/:id/response: take the reply down. */
router.delete("/:id/response", limitWrites, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const params = idParams.safeParse(req.params);
  if (!params.success) return res.status(404).json({ error: "Review not found" });
  const userId = req.user!.id;
  if (!(await findOwned(params.data.id, userId))) return res.status(404).json({ error: "Review not found" });

  const updated = await prisma.propertyReview.update({
    where: { id: params.data.id },
    data: { ownerResponse: null, ownerResponseAt: null },
    select: reviewSelect,
  });
  res.json({ review: publicReview(updated) });
}));

export default router;
