import { Router } from "express";
import type { RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

router.use(requireAuth as unknown as RequestHandler);
router.use(requireRole("ADMIN") as unknown as RequestHandler);

type OperatorProfile = {
  companyName?: string;
  contactEmail?: string;
  contactPhone?: string;
  operatingRegions?: unknown;
  packageItems?: unknown;
  documentProofs?: unknown;
  reviewStatus?: string;
  review?: {
    status?: string;
  };
};

function asProfile(value: unknown): OperatorProfile {
  return value && typeof value === "object" ? (value as OperatorProfile) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function num(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isPaidTourBooking(booking: { paymentStatus?: unknown; paidAt?: unknown }) {
  return String(booking.paymentStatus || "").toUpperCase() === "PAID" || Boolean(booking.paidAt);
}

function isDraftTourBooking(booking: { status?: unknown; paymentStatus?: unknown; paidAt?: unknown }) {
  if (isPaidTourBooking(booking)) return false;
  const status = String(booking.status || "").toUpperCase();
  const paymentStatus = String(booking.paymentStatus || "").toUpperCase();
  return status === "PENDING_PAYMENT" || paymentStatus === "UNPAID" || paymentStatus === "PENDING";
}

function normalizeDocStatus(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return String((value as any).status || "").toUpperCase();
}

function profileReadiness(profile: OperatorProfile) {
  const docs = profile.documentProofs && typeof profile.documentProofs === "object"
    ? (profile.documentProofs as Record<string, unknown>)
    : {};
  const required = ["brela", "tin", "license", "business"];
  const approvedDocs = required.filter((key) => normalizeDocStatus(docs[key]) === "APPROVED").length;
  const packages = asArray(profile.packageItems);
  const reviewStatus = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  const isApproved = reviewStatus === "APPROVED";

  return {
    hasCompanyName: Boolean(String(profile.companyName || "").trim()),
    hasContact: Boolean(String(profile.contactEmail || profile.contactPhone || "").trim()),
    approvedDocs,
    requiredDocs: required.length,
    packageCount: packages.length,
    profileApproved: isApproved,
  };
}

// Same rule public.agents.ts applies before listing an operator: an ACTIVE account
// with an APPROVED profile. Anything looser over-reports who travellers can see.
function isPublicVisible(agentStatus: unknown, profile: OperatorProfile) {
  const reviewStatus = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  return String(agentStatus || "").toUpperCase() === "ACTIVE" && reviewStatus === "APPROVED";
}

function clampPercent(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return Math.max(0, Math.min(100, Number(fallback) || 0));
  return Math.max(0, Math.min(100, parsed));
}

function resolveAgentCommissionPercent(profile: OperatorProfile, fallbackPercent: number): number {
  const directCommission = Number((profile as any)?.commissionPercent);
  if (Number.isFinite(directCommission)) return clampPercent(directCommission, fallbackPercent);

  const servicesCommission = Number((profile as any)?.services?.commissionPercent);
  if (Number.isFinite(servicesCommission)) return clampPercent(servicesCommission, fallbackPercent);

  return clampPercent(fallbackPercent, 15);
}

function normalizeActivityHistoryEntry(entry: any) {
  return {
    activityId: String(entry?.activityId || "").trim(),
    checked: Boolean(entry?.checked),
    at: String(entry?.at || "").trim(),
    byAgentId: Number.isFinite(Number(entry?.byAgentId)) ? Number(entry.byAgentId) : null,
    byUserId: Number.isFinite(Number(entry?.byUserId)) ? Number(entry.byUserId) : null,
  };
}

function normalizePackage(
  agent: any,
  pkg: any,
  index: number,
  commissionPercent: number,
  bookingStatsByPackageId: Map<string, { bookingsCount: number; totalGenerated: number }>,
  bookingStatsByTitleDestination: Map<string, { bookingsCount: number; totalGenerated: number }>,
) {
  const profile = asProfile(agent.operatorProfile);
  const price = num(pkg?.pricePerPerson || pkg?.price);
  const minPax = Math.max(1, num(pkg?.minPax) || 1);
  const maxPax = Math.max(minPax, num(pkg?.maxPax) || minPax);
  const profileReviewStatus = String(profile?.reviewStatus || profile?.review?.status || "").toUpperCase();
  const status = String(pkg?.status || pkg?.visibility || profileReviewStatus || "DRAFT").toUpperCase();
  const packageId = String(pkg?.id || index);
  const title = String(pkg?.name || pkg?.title || "Untitled tour package");
  const destination = String(pkg?.destination || "");
  const byIdKey = `${agent.id}::${packageId}`;
  const legacyKey = `${agent.id}::${title.trim().toLowerCase()}::${destination.trim().toLowerCase()}`;
  const stats =
    bookingStatsByPackageId.get(byIdKey) ||
    bookingStatsByTitleDestination.get(legacyKey) ||
    { bookingsCount: 0, totalGenerated: 0 };
  const approvedLike = ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(status);
  // A package a traveller can actually buy: approved, complete enough to show, and
  // sold by an operator the public site lists. Approval alone is inherited from the
  // operator's profile review, so an empty draft package would otherwise read as live.
  const issues: string[] = [];
  if (!String(pkg?.name || pkg?.title || "").trim()) issues.push("No title");
  if (!(price > 0)) issues.push("No price");
  if (!destination.trim()) issues.push("No destination");
  const operatorVisible = isPublicVisible(agent.status, profile);
  const onSale = approvedLike && issues.length === 0 && operatorVisible;

  return {
    id: `${agent.id}:${packageId}`,
    packageId,
    agentId: agent.id,
    operatorName: String(profile.companyName || agent.user?.fullName || agent.user?.name || "Unnamed operator"),
    title,
    destination,
    category: String(pkg?.category || ""),
    duration: String(pkg?.duration || ""),
    minPax,
    maxPax,
    pricePerPerson: price,
    currency: String(pkg?.currency || "TZS"),
    estimatedGross: price * minPax,
    nolsafPercent: approvedLike ? commissionPercent : 0,
    bookingsCount: stats.bookingsCount,
    totalGenerated: stats.totalGenerated,
    status,
    onSale,
    operatorVisible,
    issues,
  };
}

async function loadOperators() {
  return prisma.agent.findMany({
    where: { operatorProfile: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 500,
    select: {
      id: true,
      status: true,
      isAvailable: true,
      totalCompletedTrips: true,
      totalRevenueGenerated: true,
      operatorProfile: true,
      user: {
        select: {
          id: true,
          name: true,
          fullName: true,
          email: true,
          phone: true,
        },
      },
    },
  });
}

router.get("/overview", async (_req, res) => {
  try {
    // Money that stayed with us: paid, and not cancelled or refunded afterwards.
    // (A refunded booking keeps its paidAt, so paidAt alone over-counts.)
    const paidBookingWhere = {
      OR: [
        { paymentStatus: "PAID" },
        { paidAt: { not: null } },
      ],
      status: { notIn: ["CANCELED", "CANCELLED", "REFUNDED"] },
      paymentStatus: { not: "REFUNDED" },
    };
    const [agents, recentBookings, paidTotals, disbursedPayoutTotals, commissionTotals, systemSetting, paidPackageGroupsByPackageId, paidPackageGroupsByTitleDestination, owedTotals] = await Promise.all([
      loadOperators(),
      prisma.tourBooking.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: {
          operator: {
            select: {
              id: true,
              user: { select: { name: true, fullName: true, email: true } },
              operatorProfile: true,
            },
          },
          customer: { select: { id: true, name: true, fullName: true, email: true, phone: true } },
        },
      }),
      prisma.tourBooking.aggregate({
        where: paidBookingWhere,
        _count: { _all: true },
        _sum: {
          grossAmount: true,
          commissionAmount: true,
          operatorPayoutAmount: true,
        },
      }),
      prisma.tourBooking.aggregate({
        where: {
          OR: [
            { payoutStatus: "DISBURSED" },
            { payoutStatus: "PAID" },
          ],
        },
        _count: { _all: true },
        _sum: {
          operatorPayoutAmount: true,
        },
      }),
      prisma.tourBooking.aggregate({
        where: paidBookingWhere,
        _sum: {
          commissionAmount: true,
        },
      }),
      prisma.systemSetting.findFirst({
        select: {
          agentCommissionPercent: true,
          agentCommissionCurrency: true,
        },
      }),
      prisma.tourBooking.groupBy({
        by: ["operatorAgentId", "packageId"],
        where: {
          ...paidBookingWhere,
          packageId: { not: null },
        },
        _count: { _all: true },
        _sum: { grossAmount: true },
      }),
      prisma.tourBooking.groupBy({
        by: ["operatorAgentId", "title", "destination"],
        where: paidBookingWhere,
        _count: { _all: true },
        _sum: { grossAmount: true },
      }),
      // Operator share on paid bookings that has not been disbursed yet, across all time.
      prisma.tourBooking.aggregate({
        where: { ...paidBookingWhere, payoutStatus: { not: "DISBURSED" } },
        _count: { _all: true },
        _sum: { operatorPayoutAmount: true },
      }),
    ]);

    // Booking journey, all time: every checkout, then each stage it can reach.
    const neverPaidWhere = {
      paymentStatus: { not: "PAID" },
      paidAt: null,
    };
    const [journeyStarted, journeyCompleted, journeyPaidOut, journeyStuck, journeyDropped] = await Promise.all([
      prisma.tourBooking.aggregate({ _count: { _all: true }, _sum: { grossAmount: true } }),
      prisma.tourBooking.aggregate({
        where: { ...paidBookingWhere, status: "COMPLETED" },
        _count: { _all: true },
        _sum: { grossAmount: true },
      }),
      prisma.tourBooking.aggregate({
        where: { ...paidBookingWhere, payoutStatus: "DISBURSED" },
        _count: { _all: true },
        _sum: { operatorPayoutAmount: true },
      }),
      // Still open and unpaid: the travellers who could still pay.
      prisma.tourBooking.aggregate({
        where: { ...neverPaidWhere, status: { notIn: ["CANCELED", "CANCELLED", "REFUNDED"] } },
        _count: { _all: true },
        _sum: { grossAmount: true },
        _min: { createdAt: true },
      }),
      // Abandoned or auto-cancelled before any payment.
      prisma.tourBooking.count({
        where: { ...neverPaidWhere, status: { in: ["CANCELED", "CANCELLED"] } },
      }),
    ]);

    const defaultAgentCommissionPercent = clampPercent((systemSetting as any)?.agentCommissionPercent ?? 15, 15);
    const bookingStatsByPackageId = new Map<string, { bookingsCount: number; totalGenerated: number }>();
    for (const row of paidPackageGroupsByPackageId) {
      const packageId = String((row as any).packageId || "").trim();
      if (!packageId) continue;
      const key = `${Number(row.operatorAgentId || 0)}::${packageId}`;
      bookingStatsByPackageId.set(key, {
        bookingsCount: Number((row as any)?._count?._all || 0),
        totalGenerated: Number((row as any)?._sum?.grossAmount || 0),
      });
    }

    const bookingStatsByTitleDestination = new Map<string, { bookingsCount: number; totalGenerated: number }>();
    for (const row of paidPackageGroupsByTitleDestination) {
      const key = `${Number(row.operatorAgentId || 0)}::${String(row.title || "").trim().toLowerCase()}::${String(row.destination || "").trim().toLowerCase()}`;
      bookingStatsByTitleDestination.set(key, {
        bookingsCount: Number((row as any)?._count?._all || 0),
        totalGenerated: Number((row as any)?._sum?.grossAmount || 0),
      });
    }

    const packages = agents.flatMap((agent) => {
      const profile = asProfile(agent.operatorProfile);
      const agentCommissionPercent = resolveAgentCommissionPercent(profile, defaultAgentCommissionPercent);
      return asArray(profile.packageItems).map((pkg, index) =>
        normalizePackage(agent, pkg, index, agentCommissionPercent, bookingStatsByPackageId, bookingStatsByTitleDestination),
      );
    });

    const operators = agents.map((agent) => {
      const profile = asProfile(agent.operatorProfile);
      return {
        id: agent.id,
        status: agent.status,
        isAvailable: agent.isAvailable,
        name: profile.companyName || agent.user?.fullName || agent.user?.name || "Unnamed operator",
        email: profile.contactEmail || agent.user?.email || null,
        phone: profile.contactPhone || agent.user?.phone || null,
        regions: asArray<string>(profile.operatingRegions),
        completedTrips: agent.totalCompletedTrips,
        totalRevenueGenerated: Number(agent.totalRevenueGenerated || 0),
        readiness: { ...profileReadiness(profile), publicReady: isPublicVisible(agent.status, profile) },
      };
    });

    const publicReadyOperators = operators.filter((operator) => operator.readiness.publicReady).length;
    const grossPackageFloor = packages.reduce((sum, pkg) => sum + Number(pkg.estimatedGross || 0), 0);
    const allBookings = recentBookings.map((booking) => {
      const operatorProfile = asProfile(booking.operator?.operatorProfile);
      const isPaid = isPaidTourBooking(booking);
      const amountPaid = isPaid ? Number(booking.grossAmount || 0) : 0;
      return {
        id: booking.id,
        bookingCode: booking.bookingCode,
        operatorAgentId: booking.operatorAgentId,
        operatorName: operatorProfile.companyName || booking.operator?.user?.fullName || booking.operator?.user?.name || "Unnamed operator",
        customerName: booking.customer?.fullName || booking.customer?.name || booking.guestName || "Guest",
        customerEmail: booking.customer?.email || booking.guestEmail || null,
        title: booking.title,
        destination: booking.destination,
        category: booking.category,
        travelerCount: booking.travelerCount,
        startDate: booking.startDate,
        endDate: booking.endDate,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        payoutStatus: booking.payoutStatus,
        isPaid,
        metadata: booking.metadata,
        pickupValidated: Boolean((booking.metadata as any)?.pickupValidation?.validated),
        pickupValidatedAt: (booking.metadata as any)?.pickupValidation?.validatedAt || null,
        pickupValidatedByAgentId: (booking.metadata as any)?.pickupValidation?.validatedByAgentId || null,
        currency: booking.currency,
        grossAmount: Number(booking.grossAmount || 0),
        amountPaid,
        commissionAmount: Number(booking.commissionAmount || 0),
        operatorPayoutAmount: Number(booking.operatorPayoutAmount || 0),
        paidAt: booking.paidAt,
        createdAt: booking.createdAt,
      };
    });
    const bookings = allBookings.filter((booking) => booking.isPaid);
    const draftBookings = allBookings.filter((booking) => isDraftTourBooking(booking));
    const paidBookingCount = Number(paidTotals._count?._all || 0);
    const summaryCurrency =
      String((systemSetting as any)?.agentCommissionCurrency || "").trim().toUpperCase() ||
      String(recentBookings[0]?.currency || "").trim().toUpperCase() ||
      "USD";
    const livePackageCount = packages.filter((pkg) => pkg.onSale).length;

    return res.json({
      ok: true,
      summary: {
        operators: operators.length,
        activeOperators: operators.filter((operator) => String(operator.status).toUpperCase() === "ACTIVE").length,
        publicReadyOperators,
        packages: packages.length,
        livePackages: livePackageCount,
        paidBookings: paidBookingCount,
        disbursedPayoutBookings: Number(disbursedPayoutTotals._count?._all || 0),
        grossBookingRevenue: Number(paidTotals._sum.grossAmount || 0),
        nolsafCommission: Number(commissionTotals._sum.commissionAmount || 0),
        // operatorPayout is the operators' share of paid bookings (so share + commission = gross);
        // operatorPaidOut / operatorOwed split it into sent and still to send.
        operatorPayout: Number(paidTotals._sum.operatorPayoutAmount || 0),
        operatorPaidOut: Number(disbursedPayoutTotals._sum.operatorPayoutAmount || 0),
        operatorOwed: Number(owedTotals._sum.operatorPayoutAmount || 0),
        owedPayoutBookings: Number(owedTotals._count?._all || 0),
        grossPackageFloor,
        currency: summaryCurrency,
        journey: {
          started: { count: Number(journeyStarted._count?._all || 0), amount: Number(journeyStarted._sum.grossAmount || 0) },
          paid: { count: paidBookingCount, amount: Number(paidTotals._sum.grossAmount || 0) },
          completed: { count: Number(journeyCompleted._count?._all || 0), amount: Number(journeyCompleted._sum.grossAmount || 0) },
          paidOut: { count: Number(journeyPaidOut._count?._all || 0), amount: Number(journeyPaidOut._sum.operatorPayoutAmount || 0) },
          unpaidOpen: {
            count: Number(journeyStuck._count?._all || 0),
            amount: Number(journeyStuck._sum.grossAmount || 0),
            oldestAt: journeyStuck._min?.createdAt ?? null,
          },
          cancelledBeforePayment: journeyDropped,
        },
      },
      operators,
      packages,
      bookings,
      draftBookings,
    });
  } catch (err: any) {
    console.error("[GET /admin/tour-commerce/overview] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load tour commerce overview" });
  }
});

router.get("/bookings/:id/activity-progress-history", async (req, res) => {
  try {
    const bookingId = Number(req.params.id);
    if (!Number.isFinite(bookingId) || bookingId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid booking id" });
    }

    const requestedLimit = Number(req.query.limit || 100);
    const limit = Math.min(300, Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : 100));

    const booking = await prisma.tourBooking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        bookingCode: true,
        title: true,
        status: true,
        paymentStatus: true,
        payoutStatus: true,
        metadata: true,
        operator: {
          select: {
            user: { select: { name: true, fullName: true } },
            operatorProfile: true,
          },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ ok: false, error: "Booking not found" });
    }

    const md = booking.metadata && typeof booking.metadata === "object" && !Array.isArray(booking.metadata)
      ? (booking.metadata as Record<string, any>)
      : {};
    const progress = md.activityProgress && typeof md.activityProgress === "object" && !Array.isArray(md.activityProgress)
      ? (md.activityProgress as Record<string, any>)
      : {};
    const rawHistory = Array.isArray(progress.history) ? progress.history : [];

    const normalized = rawHistory
      .map((entry) => normalizeActivityHistoryEntry(entry))
      .filter((entry) => entry.activityId && entry.at)
      .sort((a, b) => String(b.at).localeCompare(String(a.at)))
      .slice(0, limit);

    const uniqueAgentIds = Array.from(new Set(normalized.map((entry) => entry.byAgentId).filter((v): v is number => Number.isFinite(v))));
    const uniqueUserIds = Array.from(new Set(normalized.map((entry) => entry.byUserId).filter((v): v is number => Number.isFinite(v))));

    const [agents, users] = await Promise.all([
      uniqueAgentIds.length
        ? prisma.agent.findMany({
            where: { id: { in: uniqueAgentIds } },
            select: { id: true, user: { select: { fullName: true, name: true } } },
          })
        : Promise.resolve([]),
      uniqueUserIds.length
        ? prisma.user.findMany({
            where: { id: { in: uniqueUserIds } },
            select: { id: true, fullName: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const agentNameById = new Map<number, string>();
    for (const agent of agents) {
      const agentName = String(agent.user?.fullName || agent.user?.name || "").trim();
      if (agentName) agentNameById.set(agent.id, agentName);
    }

    const userNameById = new Map<number, string>();
    for (const user of users) {
      const userName = String(user.fullName || user.name || "").trim();
      if (userName) userNameById.set(user.id, userName);
    }

    const history = normalized.map((entry) => ({
      ...entry,
      actorName:
        (entry.byUserId != null ? userNameById.get(entry.byUserId) : undefined) ||
        (entry.byAgentId != null ? agentNameById.get(entry.byAgentId) : undefined) ||
        null,
      action: entry.checked ? "CHECKED" : "UNCHECKED",
    }));

    const operatorProfile = asProfile(booking.operator?.operatorProfile);
    const operatorName =
      String(operatorProfile.companyName || booking.operator?.user?.fullName || booking.operator?.user?.name || "").trim() ||
      "Unnamed operator";

    return res.json({
      ok: true,
      booking: {
        id: booking.id,
        bookingCode: booking.bookingCode,
        title: booking.title,
        operatorName,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        payoutStatus: booking.payoutStatus,
      },
      history,
    });
  } catch (err: any) {
    console.error("[GET /admin/tour-commerce/bookings/:id/activity-progress-history] Error:", err);
    return res.status(500).json({ ok: false, error: "Failed to load activity progress history" });
  }
});

export default router;
