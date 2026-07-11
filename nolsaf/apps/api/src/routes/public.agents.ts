/**
 * Public Agents API
 * ─────────────────────────────────────────────────────────────────────────────
 * Routes:
 *   GET  /api/public/agents            list active operator profiles (paginated)
 *   GET  /api/public/agents/:id        get a single operator profile by agent id
 *
 * No authentication required — public-facing tour operator marketplace.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { asyncHandler } from "../middleware/errorHandler.js";
import { withCache } from "../lib/performance.js";
import { signOperatorVerificationToken, verifyOperatorVerificationToken } from "../lib/operatorVerificationToken.js";

const router = Router();

const FALLBACK_TOURISM_CATEGORIES = [
  "Safari Tours",
  "Beach Holidays",
  "Cultural Tours",
  "Mountain Trekking",
  "City Tours",
  "Group Travel",
  "Honeymoon",
  "Family Travel",
  "Luxury Travel",
  "Budget Travel",
  "Corporate Travel",
  "Adventure Travel",
];

const TRIP_CONFIDENCE_WINDOW_DAYS = 365;

function approvedProfile(value: unknown): any | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, any>;
  const status = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  if (status !== "APPROVED") return null;
  return profile.approvedSnapshot && typeof profile.approvedSnapshot === "object" ? profile.approvedSnapshot : profile;
}

/**
 * Public verification data must come from the admin-controlled profile review,
 * never from fields submitted by the tour operator. The certificate reference
 * is deterministic so it can be quoted consistently without exposing review
 * documents or reviewer identity.
 */
function buildPublicOperatorVerification(agent: { id: number; operatorProfile: unknown }) {
  const source = safeObject(agent.operatorProfile);
  const status = String(source.reviewStatus || safeObject(source.review).status || "").toUpperCase();
  if (status !== "APPROVED") return null;

  const approvedAt = String(source.approvedAt || source.reviewedAt || safeObject(source.review).reviewedAt || "").trim();
  return {
    status: "VERIFIED" as const,
    certificateId: `NOLS-TO-${String(agent.id).padStart(6, "0")}`,
    approvedAt: approvedAt || null,
    verificationUrl: approvedAt
      ? `/verify/operator?t=${encodeURIComponent(signOperatorVerificationToken(agent.id, approvedAt))}`
      : null,
  };
}

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function collectStrings(value: unknown, target: Set<string>) {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    const text = String(item ?? "").trim();
    if (text) target.add(text);
  }
}

function isPickupValidated(metadata: unknown): boolean {
  const md = safeObject(metadata);
  const shared = safeObject(md.pickupValidation);
  const operator = safeObject(md.pickupValidationOperator);
  const customer = safeObject(md.pickupValidationCustomer);
  return Boolean(
    shared.validated ||
    shared.firstMeetValidated ||
    shared.validatedAt ||
    operator.validated ||
    operator.validatedAt ||
    customer.validated ||
    customer.validatedAt
  );
}

function timelineRows(packageSnapshot: unknown, metadata: unknown): any[] {
  const pkg = safeObject(packageSnapshot);
  const md = safeObject(metadata);
  const candidates = [pkg.itinerary, md.itinerary, pkg.timelineDays, md.timelineDays];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function timelineEventKeys(packageSnapshot: unknown, metadata: unknown): string[] {
  return timelineRows(packageSnapshot, metadata).flatMap((row: any, idx: number) => {
    const day = Number(row?.day) > 0 ? Number(row.day) : idx + 1;
    const slots = [
      ...(Array.isArray(row?.events) ? row.events : []),
      ...(Array.isArray(row?.timeline) ? row.timeline : []),
    ].filter(Boolean);

    if (slots.length) return slots.map((_, slotIdx) => `${day}-${slotIdx}`);

    const hasFallbackSlot = Boolean(
      row?.timeRange ||
      row?.time ||
      row?.startTime ||
      row?.endTime ||
      row?.title ||
      row?.name ||
      row?.dayLabel ||
      row?.description ||
      row?.notes
    );
    return hasFallbackSlot ? [`${day}-0`] : [];
  });
}

function getTimelineRating(entry: unknown, userId: number): number {
  const eventEntry = safeObject(entry);
  const ratings = safeObject(eventEntry.ratings);
  const userRating = ratings[String(userId)];
  if (userRating) return Number(safeObject(userRating).rating || userRating || 0);
  if (Number(eventEntry.ratedByUserId || 0) === Number(userId)) return Number(eventEntry.rating || 0);
  return 0;
}

function completedTimelineUserIds(booking: { customerId: number | null; travelerCount: number; packageSnapshot: unknown; metadata: unknown }) {
  const md = safeObject(booking.metadata);
  const keys = timelineEventKeys(booking.packageSnapshot, booking.metadata);
  if (!keys.length) return [];

  const candidates = new Set<number>();
  if (Number(booking.customerId || 0) > 0) candidates.add(Number(booking.customerId));
  for (const participant of safeArray(md.timelineParticipants)) {
    const userId = Number(participant?.userId || 0);
    const status = String(participant?.status || "ACCEPTED").toUpperCase();
    if (userId > 0 && status === "ACCEPTED") candidates.add(userId);
  }

  const ratings = safeObject(md.timelineEventRatings);
  return [...candidates].filter((userId) => keys.every((key) => getTimelineRating(ratings[key], userId) >= 1));
}

function ratingLabel(value: number): string {
  if (value >= 4.75) return "Beyond expectations";
  if (value >= 3.75) return "Excited";
  if (value >= 2.75) return "Good";
  if (value >= 1.75) return "Okay";
  return "Bored";
}

function summarizeTripConfidence(bookings: Array<{
  id: number;
  customerId: number | null;
  packageId: string | null;
  packageSnapshot: unknown;
  metadata: unknown;
  travelerCount: number;
  completedAt: Date | null;
  updatedAt: Date;
}>, includePackages = true) {
  const cutoff = Date.now() - TRIP_CONFIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const allValues: number[] = [];
  const recentValues: number[] = [];
  const packageBuckets = new Map<string, typeof bookings>();
  const recentBookingIds = new Set<number>();
  const allBookingIds = new Set<number>();
  let recentCompletedTravellers = 0;
  let recentDeclaredTravellers = 0;
  let allCompletedTravellers = 0;

  for (const booking of bookings) {
    if (!isPickupValidated(booking.metadata)) continue;
    const completedUsers = completedTimelineUserIds(booking);
    if (!completedUsers.length) continue;

    const keys = timelineEventKeys(booking.packageSnapshot, booking.metadata);
    const eventRatings = safeObject(safeObject(booking.metadata).timelineEventRatings);
    const bookingValues = keys.flatMap((key) => completedUsers.map((userId) => getTimelineRating(eventRatings[key], userId)))
      .filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);
    if (!bookingValues.length) continue;

    allBookingIds.add(booking.id);
    allCompletedTravellers += completedUsers.length;
    allValues.push(...bookingValues);

    const packageKey = String(booking.packageId || safeObject(booking.packageSnapshot).id || "");
    if (packageKey) packageBuckets.set(packageKey, [...(packageBuckets.get(packageKey) || []), booking]);

    const scoreDate = booking.completedAt || booking.updatedAt;
    if (scoreDate.getTime() >= cutoff) {
      recentBookingIds.add(booking.id);
      recentCompletedTravellers += completedUsers.length;
      recentDeclaredTravellers += Math.max(1, Number(booking.travelerCount || 1));
      recentValues.push(...bookingValues);
    }
  }

  const averageRating = recentValues.length ? recentValues.reduce((sum, rating) => sum + rating, 0) / recentValues.length : 0;
  const participationScore = recentDeclaredTravellers ? Math.min(1, recentCompletedTravellers / recentDeclaredTravellers) * 100 : 0;
  const volumeScore = Math.min(1, recentBookingIds.size / 10) * 100;
  const variance = recentValues.length
    ? recentValues.reduce((sum, rating) => sum + Math.pow(rating - averageRating, 2), 0) / recentValues.length
    : 0;
  const consistencyScore = Math.max(0, 100 - (Math.sqrt(variance) / 1.5) * 100);
  const ratingScore = (averageRating / 5) * 100;
  const score = recentValues.length
    ? Math.round(ratingScore * 0.7 + participationScore * 0.15 + volumeScore * 0.10 + consistencyScore * 0.05)
    : 0;

  const packageTripConfidence = includePackages
    ? Object.fromEntries([...packageBuckets.entries()].map(([packageId, rows]) => [packageId, summarizeTripConfidence(rows, false)]))
    : {};

  return {
    score,
    averageRating: Number(averageRating.toFixed(2)),
    totalRatings: recentValues.length,
    completedTimelines: recentBookingIds.size,
    completedTravellers: recentCompletedTravellers,
    topFeeling: recentValues.length ? ratingLabel(averageRating) : null,
    recentWindowDays: TRIP_CONFIDENCE_WINDOW_DAYS,
    allTime: {
      totalRatings: allValues.length,
      completedTimelines: allBookingIds.size,
      completedTravellers: allCompletedTravellers,
    },
    packageTripConfidence,
  };
}

async function buildTripConfidenceByAgent(agentIds: number[]) {
  if (!agentIds.length) return new Map<number, ReturnType<typeof summarizeTripConfidence>>();
  const bookings = await prisma.tourBooking.findMany({
    where: {
      operatorAgentId: { in: agentIds },
      OR: [
        { paymentStatus: { in: ["PAID", "APPROVED"] } },
        { status: { in: ["PAID", "CONFIRMED", "IN_PROGRESS", "ACTIVE", "ONGOING", "COMPLETED"] } },
      ],
    },
    select: {
      id: true,
      operatorAgentId: true,
      customerId: true,
      packageId: true,
      packageSnapshot: true,
      metadata: true,
      travelerCount: true,
      completedAt: true,
      updatedAt: true,
    },
  });

  const grouped = new Map<number, typeof bookings>();
  for (const booking of bookings) grouped.set(booking.operatorAgentId, [...(grouped.get(booking.operatorAgentId) || []), booking]);
  return new Map(agentIds.map((agentId) => [agentId, summarizeTripConfidence(grouped.get(agentId) || [])]));
}

router.get(
  "/categories",
  asyncHandler(async (_req, res) => {
    const payload = await withCache("public:agents:categories", async () => {
      const agents = await prisma.agent.findMany({
        where: {
          status: "ACTIVE",
          operatorProfile: { not: null },
        },
        select: {
          specializations: true,
          operatorProfile: true,
        },
      });

      const categories = new Set<string>();

      for (const agent of agents) {
        const profile = approvedProfile(agent.operatorProfile);
        if (!profile) continue;

        collectStrings(agent.specializations, categories);
        collectStrings(profile.specializations, categories);
        collectStrings(profile.tourismTypes, categories);
      }

      if (categories.size === 0) collectStrings(FALLBACK_TOURISM_CATEGORIES, categories);

      return {
        items: [...categories].sort((a, b) => a.localeCompare(b)).map((name) => ({ name })),
      };
    }, { ttl: 60, tags: ["public:agents"] });

    return res.json(payload);
  })
);

// ─── GET /api/public/agents ───
// Returns a paginated list of agents who have an operator profile and are active.
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const skip = (page - 1) * pageSize;

    const payload = await withCache(`public:agents:list:p${page}:s${pageSize}`, async () => {
      const [agents, total] = await Promise.all([
        prisma.agent.findMany({
          where: {
            status: "ACTIVE",
            operatorProfile: { not: null },
          },
          select: {
            id: true,
            operatorProfile: true,
            level: true,
            totalCompletedTrips: true,
          },
          orderBy: { totalCompletedTrips: "desc" },
          skip,
          take: pageSize,
        }),
        prisma.agent.count({
          where: {
            status: "ACTIVE",
            operatorProfile: { not: null },
          },
        }),
      ]);

      const tripConfidenceByAgent = await buildTripConfidenceByAgent(agents.map((agent) => agent.id));
      const visibleAgents = agents
        .map((a) => ({
          id: a.id,
          level: a.level,
          totalCompletedTrips: a.totalCompletedTrips,
          verification: buildPublicOperatorVerification(a),
          profile: (() => {
            const profile = approvedProfile(a.operatorProfile);
            return profile ? { ...profile, tripConfidence: tripConfidenceByAgent.get(a.id) || summarizeTripConfidence([]) } : null;
          })(),
        }))
        .filter((a) => Boolean(a.profile));

      return { items: visibleAgents, total: visibleAgents.length, page, pageSize };
    }, { ttl: 30, tags: ["public:agents"] });

    res.json(payload);
  })
);

// ─── GET /api/public/agents/verification ─────
// Resolves a signed public tour-operator certificate and revalidates its status.
router.get(
  "/verification",
  asyncHandler(async (req, res) => {
    const token = String(req.query.token || req.query.t || "").trim();
    const payload = verifyOperatorVerificationToken(token);
    if (!payload) return res.json({ ok: true, valid: false });

    const agent = await prisma.agent.findFirst({
      where: { id: payload.agentId, status: "ACTIVE" },
      select: { id: true, operatorProfile: true },
    });
    const profile = approvedProfile(agent?.operatorProfile);
    const source = safeObject(agent?.operatorProfile);
    const reviewStatus = String(source.reviewStatus || safeObject(source.review).status || "").toUpperCase();
    const approvedAt = String(source.approvedAt || source.reviewedAt || safeObject(source.review).reviewedAt || "").trim();

    if (!agent || !profile || reviewStatus !== "APPROVED" || !approvedAt || approvedAt !== payload.approvedAt) {
      return res.json({ ok: true, valid: false });
    }

    const companyName = String(profile.companyName || profile.businessName || profile.operatorName || "NoLSAF Tour Operator").trim();
    const location = String(profile.physicalLocation || profile.businessAddress || "").trim();
    return res.json({
      ok: true,
      valid: true,
      certificate: {
        issuer: "NoLS Africa Co Ltd",
        operator: { id: agent.id, companyName, location },
        verification: {
          status: "VERIFIED",
          verifiedAt: approvedAt,
          method: "Operator profile and business review",
          note: "This operator is currently active and approved on the NoLSAF platform.",
        },
      },
    });
  }),
);

// ─── GET /api/public/agents/:id ─────
// Returns a single operator profile by agent id.
router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid agent id" });
    }

    const payload = await withCache(`public:agents:detail:${id}`, async () => {
      const agent = await prisma.agent.findFirst({
        where: { id, status: "ACTIVE" },
        select: {
          id: true,
          operatorProfile: true,
          level: true,
          totalCompletedTrips: true,
        },
      });

      const profile = approvedProfile(agent?.operatorProfile);
      if (!agent || !profile) return null;

      const tripConfidenceByAgent = await buildTripConfidenceByAgent([agent.id]);
      return {
        id: agent.id,
        level: agent.level,
        totalCompletedTrips: agent.totalCompletedTrips,
        verification: buildPublicOperatorVerification(agent),
        profile: { ...profile, tripConfidence: tripConfidenceByAgent.get(agent.id) || summarizeTripConfidence([]) },
      };
    }, { ttl: 30, tags: ["public:agents"] });

    if (!payload) {
      return res.status(404).json({ error: "Operator profile not found" });
    }

    res.json(payload);
  })
);

export default router;
