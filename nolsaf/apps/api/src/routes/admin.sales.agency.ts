/**
 * Sales Agency Desk, admin side. The only place the capability can be granted.
 *
 * GET  /api/admin/sales/agency/capabilities          every partner holding or pending it
 * GET  /api/admin/sales/partners/:id/agency          one partner's capability (partner record page)
 * POST /api/admin/sales/partners/:id/agency/grant    grant (finance OTP)
 * POST /api/admin/sales/partners/:id/agency/rate     change the rate, partner re-accepts (finance OTP)
 * POST /api/admin/sales/partners/:id/agency/suspend  pause at once (protective, no OTP)
 * POST /api/admin/sales/partners/:id/agency/reinstate
 *                                                    reopen (finance OTP)
 * POST /api/admin/sales/partners/:id/agency/revoke   end it and close every link (protective, no OTP)
 * POST /api/admin/sales/partners/:id/agency/bookings/void
 *                                                    void a credited stay by its bk_ reference, reversing its commission (finance OTP)
 * GET  /api/admin/sales/agency/groups                agency group stays needing an admin
 * POST /api/admin/sales/agency/groups/:ref/shortlist release or return a large-group shortlist
 * POST /api/admin/sales/agency/groups/:ref/cancel    cancel a prepaid group, refund due (finance OTP)
 * POST /api/admin/sales/agency/groups/:ref/refund    record the refund transfer (finance OTP)
 * POST /api/admin/sales/agency/groups/:ref/owner-payout
 *                                                    record the owner payout (finance OTP)
 * GET  /api/admin/sales/agency/tours                 every tour credit across partners
 * POST /api/admin/sales/agency/tours/void            void a tour credit by booking code (finance OTP)
 *
 * Admin only, never impersonated, every change audited with a reason. Granting
 * needs an existing, active sales partner with a live contract and no payout
 * hold: there is no path from an ordinary account to this capability.
 */
import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { limitSalesAdminRead, limitSalesAdminWrite } from "../middleware/rateLimit.js";
import { audit } from "../lib/audit.js";
import { notifyUser } from "../lib/notifications.js";
import { sanitizeText } from "../lib/sanitize.js";
import { isContractEarning, CONTRACT_EARNING_STATUSES } from "../lib/salesPartner.js";
import { autoReverseSalesCommission } from "../lib/salesCommission.js";
import { COMMISSION_TRANSACTION_OPTIONS } from "../lib/nrmsTransaction.js";
import { reverseGroupStayRefund } from "../lib/revenueRecognition.js";
import { groupStayHoldNotes } from "../lib/groupStayAvailabilityBlocks.js";
import { customerRecordReference, isCustomerRecordReference, matchesCustomerRecordReference } from "../lib/customerBookingReference.js";
import {
  AGENCY_CAPABILITY,
  AGENCY_LINK_HARD_CAP,
  AGENCY_STAY_RATE_MAX,
  AGENCY_STAY_RATE_MIN,
  AGENCY_TERMS_VERSION,
  agencyTermsHash,
  isAgencyDeskEnabled,
} from "../lib/salesAgency.js";

const router = Router();
router.use(requireAuth as RequestHandler, requireRole("ADMIN") as RequestHandler, blockImpersonated as RequestHandler);
const db = prisma as any;

const reason = z.string().trim().min(5).max(300);
const rate = z.number().min(AGENCY_STAY_RATE_MIN).max(AGENCY_STAY_RATE_MAX);

function partnerIdParam(req: AuthedRequest): number | null {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function loadPartner(id: number) {
  const now = new Date();
  return db.salesPartnerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      agentCode: true,
      status: true,
      payoutHoldAt: true,
      contracts: {
        where: { status: { in: CONTRACT_EARNING_STATUSES as unknown as string[] }, startsAt: { lte: now }, expiresAt: { gt: now } },
        orderBy: { expiresAt: "desc" },
        take: 1,
        select: { id: true, status: true, startsAt: true, expiresAt: true },
      },
      capabilities: { where: { capability: AGENCY_CAPABILITY }, take: 1 },
    },
  });
}

/** Why this partner cannot hold the Agency Desk, or null. */
function eligibilityProblem(partner: any): string | null {
  if (!partner) return "Partner not found";
  if (partner.status !== "ACTIVE") return "Only an active sales partner can hold the Agency Desk";
  if (partner.payoutHoldAt) return "This partner has a payout hold. Clear it before granting the Agency Desk";
  if (!isContractEarning(partner.contracts?.[0])) return "This partner has no live sales agreement";
  return null;
}

function serializeCapability(cap: any) {
  if (!cap) return null;
  return {
    status: cap.status,
    stayRate: Number(cap.stayRate),
    maxActiveLinks: cap.maxActiveLinks,
    grantReason: cap.grantReason,
    grantedAt: cap.grantedAt,
    termsVersion: cap.termsVersion,
    acceptedAt: cap.acceptedAt,
    acceptedName: cap.acceptedName,
    suspendedAt: cap.suspendedAt,
    revokedAt: cap.revokedAt,
    statusReason: cap.statusReason,
  };
}

router.get("/agency/capabilities", limitSalesAdminRead, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const caps = await db.salesPartnerCapability.findMany({
    where: { capability: AGENCY_CAPABILITY },
    orderBy: { grantedAt: "desc" },
    take: 500,
    include: { salesPartner: { select: { id: true, agentCode: true, status: true, region: true, user: { select: { name: true, fullName: true } } } } },
  });
  const partnerIds = caps.map((c: any) => c.salesPartnerId);
  const now = new Date();
  const [links, credited, earned, tourCredited] = partnerIds.length
    ? await Promise.all([
        db.salesAgencyLink.groupBy({ by: ["salesPartnerId"], where: { salesPartnerId: { in: partnerIds }, revokedAt: null, expiresAt: { gt: now } }, _count: { _all: true } }),
        db.bookingChannelAttribution.groupBy({ by: ["salesPartnerId", "status"], where: { salesPartnerId: { in: partnerIds } }, _count: { _all: true } }),
        db.salesCommission.groupBy({ by: ["salesPartnerId", "type"], where: { salesPartnerId: { in: partnerIds }, type: { in: ["AGENCY_STAY", "AGENCY_GROUP", "AGENCY_TOUR"] }, status: { notIn: ["REVERSED", "CANCELLED"] } }, _sum: { commissionAmount: true } }),
        db.tourBookingAttribution.groupBy({ by: ["salesPartnerId", "status"], where: { salesPartnerId: { in: partnerIds } }, _count: { _all: true } }),
      ])
    : [[], [], [], []];
  const liveLinks = new Map<number, number>(links.map((r: any) => [r.salesPartnerId, r._count._all]));
  const earnedBy = new Map<number, number>();
  const tourEarnedBy = new Map<number, number>();
  for (const r of earned as any[]) {
    const amount = Number(r._sum.commissionAmount || 0);
    earnedBy.set(r.salesPartnerId, (earnedBy.get(r.salesPartnerId) ?? 0) + amount);
    if (r.type === "AGENCY_TOUR") tourEarnedBy.set(r.salesPartnerId, (tourEarnedBy.get(r.salesPartnerId) ?? 0) + amount);
  }
  const toursBy = new Map<number, { active: number; blocked: number }>();
  for (const row of tourCredited as any[]) {
    const entry = toursBy.get(row.salesPartnerId) ?? { active: 0, blocked: 0 };
    if (row.status === "ACTIVE") entry.active += row._count._all;
    if (row.status === "BLOCKED") entry.blocked += row._count._all;
    toursBy.set(row.salesPartnerId, entry);
  }
  const creditedBy = new Map<number, { active: number; blocked: number }>();
  for (const row of credited as any[]) {
    const entry = creditedBy.get(row.salesPartnerId) ?? { active: 0, blocked: 0 };
    if (row.status === "ACTIVE") entry.active += row._count._all;
    if (row.status === "BLOCKED") entry.blocked += row._count._all;
    creditedBy.set(row.salesPartnerId, entry);
  }
  return res.json({
    enabled: isAgencyDeskEnabled(),
    items: caps.map((c: any) => ({
      partnerId: c.salesPartnerId,
      agentCode: c.salesPartner.agentCode,
      name: c.salesPartner.user?.fullName || c.salesPartner.user?.name || null,
      partnerStatus: c.salesPartner.status,
      region: c.salesPartner.region,
      capability: serializeCapability(c),
      liveLinks: liveLinks.get(c.salesPartnerId) ?? 0,
      bookingsCredited: creditedBy.get(c.salesPartnerId)?.active ?? 0,
      bookingsBlocked: creditedBy.get(c.salesPartnerId)?.blocked ?? 0,
      toursCredited: toursBy.get(c.salesPartnerId)?.active ?? 0,
      toursBlocked: toursBy.get(c.salesPartnerId)?.blocked ?? 0,
      tourEarned: tourEarnedBy.get(c.salesPartnerId) ?? 0,
      earned: earnedBy.get(c.salesPartnerId) ?? 0,
    })),
  });
}) as RequestHandler);

/**
 * GET /api/admin/sales/agency/tours
 * Every tour booking credited (or blocked) to an Agency Desk partner, across
 * partners, blocked attempts first. Rows are keyed by the tour's booking code,
 * never by a row id.
 */
router.get("/agency/tours", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const status = String(req.query.status || "").toUpperCase();
  const where: any = ["ACTIVE", "BLOCKED", "VOID"].includes(status) ? { status } : {};
  const rows = await db.tourBookingAttribution.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 300,
    include: { salesPartner: { select: { agentCode: true, user: { select: { name: true, fullName: true } } } }, link: { select: { label: true } } },
  });
  const ids = rows.map((r: any) => r.tourBookingId);
  const [tours, commissions, counts] = await Promise.all([
    ids.length
      ? db.tourBooking.findMany({
          where: { id: { in: ids } },
          select: {
            id: true, bookingCode: true, title: true, destination: true, startDate: true, travelerCount: true, status: true, paymentStatus: true,
            grossAmount: true, commissionAmount: true, currency: true, operatorSnapshot: true,
          },
        })
      : [],
    ids.length
      ? db.salesCommission.findMany({
          where: { type: "AGENCY_TOUR", sourceKey: { in: ids.map((id: number) => `AGENCY_TOUR:${id}`) } },
          select: { sourceKey: true, status: true, commissionAmount: true, reversalReason: true, paidAt: true },
        })
      : [],
    db.tourBookingAttribution.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const tourById = new Map<number, any>(tours.map((t: any) => [t.id, t]));
  const commissionByKey = new Map<string, any>(commissions.map((c: any) => [c.sourceKey, c]));
  const items = rows.map((r: any) => {
    const t = tourById.get(r.tourBookingId);
    const c = commissionByKey.get(`AGENCY_TOUR:${r.tourBookingId}`);
    return {
      bookingCode: t?.bookingCode ?? null,
      partner: { agentCode: r.salesPartner.agentCode, name: r.salesPartner.user?.fullName || r.salesPartner.user?.name || null },
      link: r.link?.label ?? null,
      tour: t
        ? {
            title: t.title,
            operator: (t.operatorSnapshot as any)?.companyName ?? null,
            destination: t.destination,
            startDate: t.startDate,
            travelers: t.travelerCount,
            status: t.status,
            paymentStatus: t.paymentStatus,
            total: Number(t.grossAmount),
            nolsafCommission: Number(t.commissionAmount),
            currency: t.currency,
          }
        : null,
      credit: r.status,
      blockedReason: r.blockedReason,
      voidReason: r.voidReason,
      commission: c ? { status: c.status, amount: Number(c.commissionAmount), reason: c.reversalReason, paidAt: c.paidAt } : null,
      creditedAt: r.createdAt,
    };
  });
  // Blocked attempts first: they are what an admin needs to look at.
  items.sort((x: any, y: any) => (x.credit === "BLOCKED" ? 0 : 1) - (y.credit === "BLOCKED" ? 0 : 1));
  const count = (s: string) => (counts as any[]).find((c) => c.status === s)?._count?._all ?? 0;
  return res.json({ counts: { active: count("ACTIVE"), blocked: count("BLOCKED"), void: count("VOID") }, items });
}) as RequestHandler);

const voidTourSchema = z.object({ bookingCode: z.string().trim().min(6).max(40), reason }).strict();

/**
 * POST /api/admin/sales/agency/tours/void
 * Void a tour credit (for example a fraud finding). The credit stays on record
 * as VOID; any AGENCY_TOUR commission is reversed, or offset from the next
 * payout if already paid. Finance OTP.
 */
router.post("/agency/tours/void", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const parsed = voidTourSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the tour booking code and a reason" });
  const tour = await db.tourBooking.findUnique({ where: { bookingCode: parsed.data.bookingCode }, select: { id: true } });
  if (!tour) return res.status(404).json({ error: "No credited agency tour found" });
  const attribution = await db.tourBookingAttribution.findUnique({ where: { tourBookingId: tour.id } });
  if (!attribution || attribution.status === "VOID") return res.status(404).json({ error: "No credited agency tour found" });
  const now = new Date();
  const outcome = await db.$transaction(async (tx: any) => {
    const moved = await tx.tourBookingAttribution.updateMany({
      where: { id: attribution.id, status: attribution.status },
      data: { status: "VOID", voidedAt: now, voidedById: Number(req.user!.id), voidReason: sanitizeText(parsed.data.reason).slice(0, 300) },
    });
    if (moved.count !== 1) return null;
    const commission = await tx.salesCommission.findUnique({ where: { sourceKey: `AGENCY_TOUR:${tour.id}` } });
    const reversal = commission ? await autoReverseSalesCommission(tx, commission.id, `Agency tour credit voided: ${parsed.data.reason}`, now) : "UNCHANGED";
    return { reversal };
  }, COMMISSION_TRANSACTION_OPTIONS);
  if (!outcome) return res.status(409).json({ error: "The credit was changed by another request" });
  await audit(req, "SALES_AGENCY_TOUR_ATTRIBUTION_VOID", "TOUR_BOOKING", { status: attribution.status }, { status: "VOID", reason: parsed.data.reason, ...outcome }, tour.id);
  return res.json({ ok: true, ...outcome });
}) as RequestHandler);

router.get("/partners/:id/agency", limitSalesAdminRead, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const partner = await loadPartner(id);
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  const cap = partner.capabilities?.[0] ?? null;
  const now = new Date();

  // Each condition the desk depends on, so admin sees exactly what to fix.
  const checks = [
    { key: "partner", label: "Active sales partner", ok: partner.status === "ACTIVE", detail: partner.status === "ACTIVE" ? null : `Partner is ${String(partner.status).toLowerCase()}` },
    { key: "contract", label: "Live sales agreement", ok: isContractEarning(partner.contracts?.[0]), detail: partner.contracts?.[0] ? null : "No agreement in force" },
    { key: "hold", label: "No payout hold", ok: !partner.payoutHoldAt, detail: partner.payoutHoldAt ? "Withdrawals are on hold" : null },
    { key: "switch", label: "Agency Desk switched on", ok: isAgencyDeskEnabled(), detail: isAgencyDeskEnabled() ? null : "SALES_AGENCY_ENABLED is off on this server" },
  ];

  // What the partner has done with the desk, only when they have held it.
  let activity: any = null;
  if (cap) {
    const [tourCredits, recentTourCredits] = await Promise.all([
      db.tourBookingAttribution.groupBy({ by: ["status"], where: { salesPartnerId: id }, _count: { _all: true } }),
      db.tourBookingAttribution.findMany({ where: { salesPartnerId: id }, orderBy: { createdAt: "desc" }, take: 8, select: { tourBookingId: true, status: true, blockedReason: true, createdAt: true } }),
    ]);
    const recentTourIds = recentTourCredits.map((t: any) => t.tourBookingId);
    const tourRows = recentTourIds.length
      ? await db.tourBooking.findMany({ where: { id: { in: recentTourIds } }, select: { id: true, bookingCode: true, title: true, startDate: true, travelerCount: true, status: true, grossAmount: true, currency: true } })
      : [];
    const tourById = new Map<number, any>(tourRows.map((t: any) => [t.id, t]));
    const [linksLive, linksTotal, credited, groups, clients, earned, recentBookings, recentGroups] = await Promise.all([
      db.salesAgencyLink.count({ where: { salesPartnerId: id, revokedAt: null, expiresAt: { gt: now } } }),
      db.salesAgencyLink.count({ where: { salesPartnerId: id } }),
      db.bookingChannelAttribution.groupBy({ by: ["status"], where: { salesPartnerId: id }, _count: { _all: true } }),
      db.salesAgencyGroupRequest.groupBy({ by: ["status"], where: { salesPartnerId: id }, _count: { _all: true } }),
      db.salesClientAccount.count({ where: { salesPartnerId: id, status: "ACTIVE" } }),
      db.salesCommission.groupBy({
        by: ["type", "status"],
        where: { salesPartnerId: id, type: { in: ["AGENCY_STAY", "AGENCY_GROUP", "AGENCY_TOUR"] } },
        _sum: { commissionAmount: true },
      }),
      db.bookingChannelAttribution.findMany({
        where: { salesPartnerId: id },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { bookingId: true, status: true, blockedReason: true, createdAt: true },
      }),
      db.salesAgencyGroupRequest.findMany({
        where: { salesPartnerId: id },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { reference: true, status: true, clientName: true, payload: true, shortlistStatus: true, groupBookingId: true, createdAt: true },
      }),
    ]);
    const bookingIds = recentBookings.map((b: any) => b.bookingId);
    const bookings = bookingIds.length
      ? await db.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, status: true, checkIn: true, totalAmount: true, property: { select: { title: true } } } })
      : [];
    const bookingById = new Map<number, any>(bookings.map((b: any) => [b.id, b]));
    const groupIds = recentGroups.map((g: any) => g.groupBookingId).filter((v: any) => Number.isInteger(v));
    const groupRows = groupIds.length
      ? await db.groupBooking.findMany({ where: { id: { in: groupIds } }, select: { id: true, status: true, depositPaid: true, totalAmount: true, checkedInAt: true, refundStatus: true } })
      : [];
    const groupById = new Map<number, any>(groupRows.map((g: any) => [g.id, g]));
    const count = (rows: any[], status: string) => rows.find((r: any) => r.status === status)?._count?._all ?? 0;
    const sumEarned = (filter: (r: any) => boolean) =>
      Math.round(earned.filter(filter).reduce((s: number, r: any) => s + Number(r._sum.commissionAmount || 0), 0));
    activity = {
      linksLive,
      linksTotal,
      bookingsCredited: count(credited, "ACTIVE"),
      bookingsBlocked: count(credited, "BLOCKED") + count(tourCredits, "BLOCKED"),
      toursCredited: count(tourCredits, "ACTIVE"),
      recentTours: recentTourCredits.map((a: any) => {
        const t = tourById.get(a.tourBookingId);
        return {
          bookingCode: t?.bookingCode ?? null,
          title: t?.title ?? "Tour",
          startDate: t?.startDate ?? null,
          travelers: t?.travelerCount ?? null,
          tourStatus: t?.status ?? null,
          total: t?.grossAmount != null ? Number(t.grossAmount) : null,
          currency: t?.currency ?? "TZS",
          credit: a.status,
          blockedReason: a.blockedReason,
          at: a.createdAt,
        };
      }),
      bookingsVoided: count(credited, "VOID"),
      groupsWaitingClient: count(groups, "AWAITING_CLIENT"),
      groupsConfirmed: count(groups, "CONFIRMED"),
      groupsCancelled: count(groups, "CANCELLED") + count(groups, "EXPIRED"),
      clients,
      earnedLive: sumEarned((r) => !["REVERSED", "CANCELLED"].includes(r.status)),
      earnedPaid: sumEarned((r) => r.status === "PAID"),
      earnedReversed: sumEarned((r) => r.status === "REVERSED"),
      recentBookings: recentBookings.map((a: any) => {
        const b = bookingById.get(a.bookingId);
        return {
          reference: customerRecordReference("booking", a.bookingId),
          property: b?.property?.title ?? "Booking",
          checkIn: b?.checkIn ?? null,
          total: b?.totalAmount != null ? Number(b.totalAmount) : null,
          bookingStatus: b?.status ?? null,
          credit: a.status,
          blockedReason: a.blockedReason,
          at: a.createdAt,
        };
      }),
      recentGroups: recentGroups.map((g: any) => {
        const gb = g.groupBookingId ? groupById.get(g.groupBookingId) : null;
        const p: any = g.payload || {};
        return {
          reference: g.reference,
          client: g.clientName,
          destination: [p.toDistrict, p.toRegion].filter(Boolean).join(", ") || null,
          people: p.headcount ?? null,
          request: g.status,
          shortlist: g.shortlistStatus,
          stage: !gb ? null : gb.refundStatus && gb.refundStatus !== "NONE" ? `REFUND_${gb.refundStatus}` : gb.checkedInAt ? "CHECKED_IN" : gb.depositPaid ? "PAID" : gb.status,
          total: gb?.totalAmount != null ? Number(gb.totalAmount) : null,
          at: g.createdAt,
        };
      }),
    };
  }

  return res.json({
    enabled: isAgencyDeskEnabled(),
    capability: serializeCapability(cap),
    eligibilityProblem: eligibilityProblem(partner),
    checks,
    contractExpiresAt: partner.contracts?.[0]?.expiresAt ?? null,
    activity,
    rateBounds: { min: AGENCY_STAY_RATE_MIN, max: AGENCY_STAY_RATE_MAX },
  });
}) as RequestHandler);

const grantSchema = z.object({
  stayRate: rate,
  maxActiveLinks: z.number().int().min(1).max(AGENCY_LINK_HARD_CAP).optional(),
  reason,
}).strict();

router.post("/partners/:id/agency/grant", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = grantSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Set a rate and a reason", details: parsed.error.issues });
  const partner = await loadPartner(id);
  const problem = eligibilityProblem(partner);
  if (problem) return res.status(partner ? 409 : 404).json({ error: problem });
  const existing = partner.capabilities?.[0] ?? null;
  if (existing && existing.status !== "REVOKED") {
    return res.status(409).json({ error: "This partner already holds or is pending the Agency Desk" });
  }
  const data = {
    status: "PENDING_ACCEPTANCE",
    stayRate: parsed.data.stayRate,
    maxActiveLinks: parsed.data.maxActiveLinks ?? 20,
    grantReason: sanitizeText(parsed.data.reason).slice(0, 300),
    grantedById: Number(req.user!.id),
    grantedAt: new Date(),
    termsVersion: AGENCY_TERMS_VERSION,
    acceptedTermsHash: null,
    acceptedName: null,
    acceptedIpAddress: null,
    acceptedUserAgent: null,
    acceptedAt: null,
    suspendedAt: null,
    revokedAt: null,
    revokedById: null,
    statusReason: null,
  };
  let cap: any;
  if (existing) {
    const moved = await db.salesPartnerCapability.updateMany({ where: { id: existing.id, status: "REVOKED" }, data });
    if (moved.count !== 1) return res.status(409).json({ error: "The capability was changed by another request" });
    cap = await db.salesPartnerCapability.findUnique({ where: { id: existing.id } });
  } else {
    try {
      cap = await db.salesPartnerCapability.create({ data: { ...data, salesPartnerId: id, capability: AGENCY_CAPABILITY } });
    } catch (error: any) {
      if (error?.code === "P2002") return res.status(409).json({ error: "The capability was changed by another request" });
      throw error;
    }
  }
  await audit(req, "SALES_AGENCY_GRANT", "SALES_PARTNER", existing ? serializeCapability(existing) : null, {
    ...serializeCapability(cap),
    agentCode: partner.agentCode,
    termsHash: agencyTermsHash(parsed.data.stayRate),
  }, id);
  await notifyUser(partner.userId, "sales_partner_agency_granted", { actionPath: "/sales/agency" }).catch(() => {});
  return res.json({ ok: true, capability: serializeCapability(cap) });
}) as RequestHandler);

const rateSchema = z.object({ stayRate: rate, maxActiveLinks: z.number().int().min(1).max(AGENCY_LINK_HARD_CAP).optional(), reason }).strict();

router.post("/partners/:id/agency/rate", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = rateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Set a rate and a reason" });
  const partner = await loadPartner(id);
  const cap = partner?.capabilities?.[0];
  if (!cap || !["ACTIVE", "PENDING_ACCEPTANCE", "SUSPENDED"].includes(cap.status)) return res.status(404).json({ error: "This partner does not hold the Agency Desk" });
  const rateChanged = Number(cap.stayRate) !== parsed.data.stayRate;
  const moved = await db.salesPartnerCapability.updateMany({
    where: { id: cap.id, status: cap.status },
    data: {
      stayRate: parsed.data.stayRate,
      ...(parsed.data.maxActiveLinks ? { maxActiveLinks: parsed.data.maxActiveLinks } : {}),
      // A new rate is a new addendum: the partner must read and accept it again.
      ...(rateChanged && cap.status === "ACTIVE"
        ? { status: "PENDING_ACCEPTANCE", acceptedAt: null, acceptedTermsHash: null, acceptedName: null, termsVersion: AGENCY_TERMS_VERSION }
        : {}),
      statusReason: sanitizeText(parsed.data.reason).slice(0, 300),
    },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "The capability was changed by another request" });
  const after = await db.salesPartnerCapability.findUnique({ where: { id: cap.id } });
  await audit(req, "SALES_AGENCY_RATE", "SALES_PARTNER", serializeCapability(cap), { ...serializeCapability(after), reason: parsed.data.reason }, id);
  if (rateChanged && cap.status === "ACTIVE") {
    await notifyUser(partner.userId, "sales_partner_agency_granted", { actionPath: "/sales/agency" }).catch(() => {});
  }
  return res.json({ ok: true, capability: serializeCapability(after) });
}) as RequestHandler);

router.post("/partners/:id/agency/suspend", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason" });
  const partner = await loadPartner(id);
  const cap = partner?.capabilities?.[0];
  if (!cap || !["ACTIVE", "PENDING_ACCEPTANCE"].includes(cap.status)) return res.status(409).json({ error: "Only a live or pending Agency Desk can be paused" });
  const now = new Date();
  const moved = await db.salesPartnerCapability.updateMany({
    where: { id: cap.id, status: cap.status },
    data: { status: "SUSPENDED", suspendedAt: now, statusReason: sanitizeText(parsed.data.reason).slice(0, 300) },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "The capability was changed by another request" });
  await audit(req, "SALES_AGENCY_SUSPEND", "SALES_PARTNER", { status: cap.status }, { status: "SUSPENDED", reason: parsed.data.reason }, id);
  // The partner is told it happened, never why.
  await notifyUser(partner.userId, "sales_partner_agency_suspended", { actionPath: "/sales" }).catch(() => {});
  return res.json({ ok: true, status: "SUSPENDED" });
}) as RequestHandler);

router.post("/partners/:id/agency/reinstate", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason" });
  const partner = await loadPartner(id);
  const problem = eligibilityProblem(partner);
  if (problem) return res.status(partner ? 409 : 404).json({ error: problem });
  const cap = partner.capabilities?.[0];
  if (!cap || cap.status !== "SUSPENDED") return res.status(409).json({ error: "The Agency Desk is not paused" });
  // Back to ACTIVE only if the partner accepted the current terms at the current rate.
  const stillAccepted = !!cap.acceptedAt && cap.acceptedTermsHash === agencyTermsHash(Number(cap.stayRate)) && cap.termsVersion === AGENCY_TERMS_VERSION;
  const next = stillAccepted ? "ACTIVE" : "PENDING_ACCEPTANCE";
  const moved = await db.salesPartnerCapability.updateMany({
    where: { id: cap.id, status: "SUSPENDED" },
    data: { status: next, suspendedAt: null, statusReason: sanitizeText(parsed.data.reason).slice(0, 300) },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "The capability was changed by another request" });
  await audit(req, "SALES_AGENCY_REINSTATE", "SALES_PARTNER", { status: "SUSPENDED" }, { status: next, reason: parsed.data.reason }, id);
  if (next === "PENDING_ACCEPTANCE") await notifyUser(partner.userId, "sales_partner_agency_granted", { actionPath: "/sales/agency" }).catch(() => {});
  return res.json({ ok: true, status: next });
}) as RequestHandler);

router.post("/partners/:id/agency/revoke", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const id = partnerIdParam(req);
  if (!id) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = z.object({ reason }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason" });
  const partner = await loadPartner(id);
  const cap = partner?.capabilities?.[0];
  if (!cap || cap.status === "REVOKED") return res.status(409).json({ error: "This partner does not hold the Agency Desk" });
  const now = new Date();
  const result = await db.$transaction(async (tx: any) => {
    const moved = await tx.salesPartnerCapability.updateMany({
      where: { id: cap.id, status: cap.status },
      data: { status: "REVOKED", revokedAt: now, revokedById: Number(req.user!.id), statusReason: sanitizeText(parsed.data.reason).slice(0, 300) },
    });
    if (moved.count !== 1) return null;
    const links = await tx.salesAgencyLink.updateMany({
      where: { salesPartnerId: id, revokedAt: null },
      data: { revokedAt: now, revokeReason: "Agency Desk ended by NoLSAF" },
    });
    return { linksClosed: links.count };
  });
  if (!result) return res.status(409).json({ error: "The capability was changed by another request" });
  await audit(req, "SALES_AGENCY_REVOKE", "SALES_PARTNER", { status: cap.status }, { status: "REVOKED", reason: parsed.data.reason, ...result }, id);
  await notifyUser(partner.userId, "sales_partner_agency_revoked", { actionPath: "/sales" }).catch(() => {});
  return res.json({ ok: true, status: "REVOKED", ...result });
}) as RequestHandler);

// ---------------------------------------------------------------------------
// Agency group stays: shortlist review and owner payout for prepaid groups
// ---------------------------------------------------------------------------

const groupRefOk = (v: unknown) => /^gr_[a-f0-9]{20}$/.test(String(v || ""));

/**
 * GET /api/admin/sales/agency/groups
 * Agency groups that need an admin: shortlists waiting for release and
 * prepaid groups whose owner payout is due.
 */
router.get("/agency/groups", limitSalesAdminRead, asyncHandler(async (_req: AuthedRequest, res: Response) => {
  const requests = await db.salesAgencyGroupRequest.findMany({
    where: { status: "CONFIRMED", groupBookingId: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 300,
    include: { salesPartner: { select: { agentCode: true } } },
  });
  const ids = requests.map((r: any) => r.groupBookingId);
  const bookings = ids.length
    ? await db.groupBooking.findMany({
        where: { id: { in: ids } },
        select: {
          id: true, status: true, roomsNeeded: true, headcount: true, toRegion: true, toDistrict: true, totalAmount: true, ownerAmount: true,
          currency: true, depositPaid: true, checkedInAt: true, ownerPayoutAmount: true, ownerPayoutStatus: true, ownerPayoutPaidAt: true, ownerPayoutRef: true,
          refundStatus: true, refundAmount: true, refundRetainedAmount: true, refundedAt: true, refundRef: true,
          assignedOwner: { select: { name: true, phone: true } }, confirmedProperty: { select: { title: true } },
        },
      })
    : [];
  const byId = new Map<number, any>(bookings.map((b: any) => [b.id, b]));
  const shortlistIds = [...new Set(requests.flatMap((r: any) => (Array.isArray(r.shortlistPropertyIds) ? r.shortlistPropertyIds.map(Number) : [])))];
  const claims = shortlistIds.length
    ? await db.groupBookingClaim.findMany({
        where: { groupBookingId: { in: ids }, propertyId: { in: shortlistIds } },
        select: { groupBookingId: true, propertyId: true, totalAmount: true, status: true, property: { select: { title: true } } },
      })
    : [];
  return res.json({
    items: requests.map((r: any) => {
      const b = byId.get(r.groupBookingId);
      const shortlist = (Array.isArray(r.shortlistPropertyIds) ? r.shortlistPropertyIds.map(Number) : []).map((pid: number) => {
        const c = claims.find((x: any) => x.groupBookingId === r.groupBookingId && x.propertyId === pid);
        return { property: c?.property?.title ?? "Property", ownerTotal: c ? Number(c.totalAmount) : null, status: c?.status ?? null };
      });
      return {
        reference: r.reference,
        groupStay: `#${r.groupBookingId}`,
        agentCode: r.salesPartner.agentCode,
        shortlistStatus: r.shortlistStatus,
        shortlist,
        booking: b
          ? {
              status: b.status, rooms: b.roomsNeeded, headcount: b.headcount,
              destination: [b.toDistrict, b.toRegion].filter(Boolean).join(", "),
              total: b.totalAmount != null ? Number(b.totalAmount) : null, currency: b.currency, paid: b.depositPaid,
              checkedInAt: b.checkedInAt, property: b.confirmedProperty?.title ?? null, owner: b.assignedOwner?.name ?? null,
              ownerPayout: { amount: b.ownerPayoutAmount != null ? Number(b.ownerPayoutAmount) : null, status: b.ownerPayoutStatus, paidAt: b.ownerPayoutPaidAt, ref: b.ownerPayoutRef },
              refund: {
                status: b.refundStatus,
                amount: b.refundAmount != null ? Number(b.refundAmount) : null,
                retained: b.refundRetainedAmount != null ? Number(b.refundRetainedAmount) : null,
                refundedAt: b.refundedAt,
                ref: b.refundRef,
              },
              nolsafShare: Math.max(0, Math.round(Number(b.totalAmount || 0) - Number(b.ownerAmount || 0))),
            }
          : null,
      };
    }),
  });
}) as RequestHandler);

const shortlistDecision = z.object({ decision: z.enum(["RELEASE", "RETURN"]), reason }).strict();

router.post("/agency/groups/:ref/shortlist", limitSalesAdminWrite, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!groupRefOk(req.params.ref)) return res.status(404).json({ error: "Not found" });
  const parsed = shortlistDecision.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose release or return, with a reason" });
  const request = await db.salesAgencyGroupRequest.findUnique({ where: { reference: req.params.ref } });
  if (!request || request.shortlistStatus !== "PENDING_REVIEW" || !request.groupBookingId) return res.status(409).json({ error: "Nothing is waiting for review on this group" });
  const ids = Array.isArray(request.shortlistPropertyIds) ? request.shortlistPropertyIds.map(Number) : [];
  const now = new Date();
  const release = parsed.data.decision === "RELEASE";
  const gb = await db.groupBooking.findUnique({ where: { id: request.groupBookingId }, select: { id: true, userId: true, confirmedPropertyId: true } });
  if (!gb || gb.confirmedPropertyId) return res.status(409).json({ error: "The client has already chosen" });
  const applied = await db.$transaction(async (tx: any) => {
    const moved = await tx.salesAgencyGroupRequest.updateMany({
      where: { id: request.id, shortlistStatus: "PENDING_REVIEW" },
      data: { shortlistStatus: release ? "PUBLISHED" : "NONE", shortlistReviewedAt: now, shortlistReviewedById: Number(req.user!.id), ...(release ? {} : { shortlistPropertyIds: [] }) },
    });
    if (moved.count !== 1) return false;
    if (release) await tx.groupBooking.update({ where: { id: gb.id }, data: { recommendedPropertyIds: ids } });
    return true;
  });
  if (!applied) return res.status(409).json({ error: "This shortlist was changed by another request" });
  await audit(req, release ? "SALES_AGENCY_SHORTLIST_RELEASE" : "SALES_AGENCY_SHORTLIST_RETURN", "GROUP_BOOKING", { shortlistStatus: "PENDING_REVIEW" }, { reason: parsed.data.reason, propertyIds: ids }, gb.id);
  if (release) {
    await notifyUser(gb.userId, "group_stay_update", {
      title: "Offers ready for your group stay",
      body: `Offers for group stay #${gb.id} are ready. Open it to compare and choose. You pay NoLSAF directly.`,
      groupBookingId: gb.id,
    }).catch(() => undefined);
  }
  return res.json({ ok: true, shortlistStatus: release ? "PUBLISHED" : "NONE" });
}) as RequestHandler);

const ownerPayoutSchema = z.object({ transferRef: z.string().trim().min(3).max(120), reason }).strict();

/**
 * Record the transfer that paid the owner of a fully prepaid group stay.
 * Finance OTP. Only after check-in, only once, only the amount the owner offered.
 */
router.post("/agency/groups/:ref/owner-payout", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!groupRefOk(req.params.ref)) return res.status(404).json({ error: "Not found" });
  const parsed = ownerPayoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the transfer reference and a reason" });
  const request = await db.salesAgencyGroupRequest.findUnique({ where: { reference: req.params.ref } });
  if (!request?.groupBookingId) return res.status(404).json({ error: "Not found" });
  const now = new Date();
  const moved = await db.groupBooking.updateMany({
    // Never pay the owner of a group that was cancelled or is being refunded.
    where: { id: request.groupBookingId, paymentMode: "FULL", depositPaid: true, checkedInAt: { not: null }, ownerPayoutStatus: "PENDING", status: { notIn: ["CANCELED", "CANCELLED"] }, refundStatus: "NONE" },
    data: { ownerPayoutStatus: "PAID", ownerPayoutPaidAt: now, ownerPayoutRef: sanitizeText(parsed.data.transferRef).slice(0, 120) },
  });
  if (moved.count !== 1) return res.status(409).json({ error: "This owner payout is not due, or was already recorded" });
  const gb = await db.groupBooking.findUnique({ where: { id: request.groupBookingId }, select: { assignedOwnerId: true, ownerPayoutAmount: true, currency: true } });
  await audit(req, "GROUP_STAY_OWNER_PAYOUT_PAID", "GROUP_BOOKING", { ownerPayoutStatus: "PENDING" }, { ownerPayoutStatus: "PAID", amount: Number(gb?.ownerPayoutAmount || 0), transferRef: parsed.data.transferRef, reason: parsed.data.reason }, request.groupBookingId);
  if (gb?.assignedOwnerId) {
    await notifyUser(gb.assignedOwnerId, "group_stay_update", {
      title: "Group stay payout sent",
      body: `NoLSAF sent your payout of ${gb.currency || "TZS"} ${Number(gb.ownerPayoutAmount || 0).toLocaleString("en-US")} for group stay #${request.groupBookingId}. Reference: ${parsed.data.transferRef}.`,
      groupBookingId: request.groupBookingId,
    }).catch(() => undefined);
  }
  return res.json({ ok: true, status: "PAID" });
}) as RequestHandler);

const cancelSchema = z.object({ reason, retainAmount: z.number().min(0).optional() }).strict();

/**
 * Cancel a fully prepaid agency group before the stay. If the guest has paid,
 * the refund is recorded as DUE: amount paid minus what NoLSAF keeps, and NoLSAF
 * may keep at most its own commission (the owner's share always goes back).
 * Finance OTP. Not possible once the group checked in or the owner was paid:
 * those need a manual decision, not this button.
 */
router.post("/agency/groups/:ref/cancel", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!groupRefOk(req.params.ref)) return res.status(404).json({ error: "Not found" });
  const parsed = cancelSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give a reason, and what NoLSAF keeps if anything" });
  const request = await db.salesAgencyGroupRequest.findUnique({ where: { reference: req.params.ref } });
  if (!request?.groupBookingId) return res.status(404).json({ error: "Not found" });
  const gb = await db.groupBooking.findUnique({
    where: { id: request.groupBookingId },
    select: {
      id: true, userId: true, status: true, paymentMode: true, depositPaid: true, depositAmount: true, totalAmount: true, ownerAmount: true, currency: true,
      checkedInAt: true, ownerPayoutStatus: true, paymentRef: true, checkoutSessionId: true, updatedAt: true,
      assignedOwnerId: true, confirmedPropertyId: true,
    },
  });
  if (!gb || gb.paymentMode !== "FULL") return res.status(404).json({ error: "Not found" });
  if (["CANCELED", "CANCELLED"].includes(String(gb.status).toUpperCase())) return res.status(409).json({ error: "This group stay is already cancelled" });
  if (gb.checkedInAt || gb.ownerPayoutStatus === "PAID") {
    return res.status(409).json({ error: "The group already checked in or the owner was paid. Handle this case manually with finance." });
  }
  // A payment may still be confirming: cancelling now could leave money arriving on a cancelled group.
  const paymentInFlight = !gb.depositPaid && (gb.paymentRef || gb.checkoutSessionId) && Date.now() - new Date(gb.updatedAt).getTime() < 2 * 60 * 60 * 1000;
  if (paymentInFlight) return res.status(409).json({ error: "A payment for this group may still be confirming. Try again in two hours." });

  const paid = gb.depositPaid ? Math.round(Number(gb.depositAmount || 0)) : 0;
  const nolsafShare = Math.max(0, Math.round(Number(gb.totalAmount || 0) - Number(gb.ownerAmount || 0)));
  const retain = Math.round(parsed.data.retainAmount ?? 0);
  if (retain > Math.min(nolsafShare, paid)) {
    return res.status(400).json({ error: `NoLSAF can keep at most its own commission (${gb.currency || "TZS"} ${Math.min(nolsafShare, paid).toLocaleString("en-US")}). The owner's share always goes back to the guest.` });
  }
  const refundAmount = paid - retain;
  const now = new Date();
  const reasonText = sanitizeText(parsed.data.reason).slice(0, 300);
  const applied = await db.$transaction(async (tx: any) => {
    const moved = await tx.groupBooking.updateMany({
      where: { id: gb.id, status: gb.status, checkedInAt: null, depositPaid: gb.depositPaid, refundStatus: "NONE" },
      data: {
        status: "CANCELED",
        canceledAt: now,
        cancelReason: reasonText,
        isOpenForClaims: false,
        ...(gb.depositPaid
          ? { refundStatus: refundAmount > 0 ? "DUE" : "NONE", refundAmount, refundRetainedAmount: retain, refundReason: reasonText }
          : {}),
      },
    });
    if (moved.count !== 1) return false;
    await tx.groupBookingClaim.updateMany({ where: { groupBookingId: gb.id, status: { in: ["PENDING", "REVIEWING", "ACCEPTED"] } }, data: { status: "REJECTED", reviewedAt: now } });
    if (gb.confirmedPropertyId) {
      await tx.propertyAvailabilityBlock.deleteMany({ where: { propertyId: gb.confirmedPropertyId, source: "GROUP_STAY", notes: groupStayHoldNotes(gb.id) } });
    }
    await tx.groupBookingAudit.create({
      data: { groupBookingId: gb.id, adminId: Number(req.user!.id), action: "AGENCY_GROUP_CANCELLED", description: reasonText, metadata: { paid, retain, refundAmount } },
    });
    return true;
  });
  if (!applied) return res.status(409).json({ error: "This group stay was changed by another request" });
  await audit(req, "GROUP_STAY_CANCEL_REFUND_DUE", "GROUP_BOOKING", { status: gb.status }, { status: "CANCELED", paid, retain, refundAmount, reason: parsed.data.reason }, gb.id);
  const cur = gb.currency || "TZS";
  await notifyUser(gb.userId, "group_stay_update", {
    title: "Group stay cancelled",
    body: refundAmount > 0
      ? `Group stay #${gb.id} was cancelled. NoLSAF will refund you ${cur} ${refundAmount.toLocaleString("en-US")}. You will be told when it is sent.`
      : `Group stay #${gb.id} was cancelled. Contact NoLSAF support if you have questions.`,
    groupBookingId: gb.id,
  }).catch(() => undefined);
  if (gb.assignedOwnerId) {
    await notifyUser(gb.assignedOwnerId, "group_stay_update", { title: "Group stay cancelled", body: `Group stay #${gb.id} was cancelled by NoLSAF and its dates are free again.`, groupBookingId: gb.id }).catch(() => undefined);
  }
  return res.json({ ok: true, refundStatus: gb.depositPaid && refundAmount > 0 ? "DUE" : "NONE", refundAmount });
}) as RequestHandler);

const refundSchema = z.object({ transferRef: z.string().trim().min(3).max(120), reason }).strict();

/** Record the transfer that refunded the guest of a cancelled prepaid group. Finance OTP, once only. */
router.post("/agency/groups/:ref/refund", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  if (!groupRefOk(req.params.ref)) return res.status(404).json({ error: "Not found" });
  const parsed = refundSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the transfer reference and a reason" });
  const request = await db.salesAgencyGroupRequest.findUnique({ where: { reference: req.params.ref } });
  if (!request?.groupBookingId) return res.status(404).json({ error: "Not found" });
  const now = new Date();
  const ledger = await db.$transaction(async (tx: any) => {
    const moved = await tx.groupBooking.updateMany({
      where: { id: request.groupBookingId, paymentMode: "FULL", refundStatus: "DUE" },
      data: { refundStatus: "REFUNDED", refundedAt: now, refundRef: sanitizeText(parsed.data.transferRef).slice(0, 120) },
    });
    if (moved.count !== 1) return null;
    return reverseGroupStayRefund(tx, request.groupBookingId);
  });
  if (!ledger) return res.status(409).json({ error: "No refund is due on this group, or it was already recorded" });
  const gb = await db.groupBooking.findUnique({ where: { id: request.groupBookingId }, select: { userId: true, refundAmount: true, currency: true } });
  await audit(req, "GROUP_STAY_REFUND_PAID", "GROUP_BOOKING", { refundStatus: "DUE" }, { refundStatus: "REFUNDED", amount: Number(gb?.refundAmount || 0), transferRef: parsed.data.transferRef, reason: parsed.data.reason, ledger: ledger.status }, request.groupBookingId);
  if (gb) {
    await notifyUser(gb.userId, "group_stay_update", {
      title: "Refund sent",
      body: `NoLSAF sent your refund of ${gb.currency || "TZS"} ${Number(gb.refundAmount || 0).toLocaleString("en-US")} for group stay #${request.groupBookingId}. Reference: ${parsed.data.transferRef}.`,
      groupBookingId: request.groupBookingId,
    }).catch(() => undefined);
  }
  return res.json({ ok: true, refundStatus: "REFUNDED" });
}) as RequestHandler);

const voidSchema = z.object({ bookingRef: z.string().trim().max(80), reason }).strict();

/**
 * Void a credited booking (for example a fraud finding). The attribution stays
 * on record as VOID and any agency commission on it is reversed, or offset from
 * the next payout if already paid.
 */
router.post("/partners/:id/agency/bookings/void", limitSalesAdminWrite, requireAdminFinanceGrant as RequestHandler, asyncHandler(async (req: AuthedRequest, res: Response) => {
  const partnerId = partnerIdParam(req);
  if (!partnerId) return res.status(400).json({ error: "Invalid partner id" });
  const parsed = voidSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Give the booking and a reason" });
  // The booking is named by its opaque bk_ reference, resolved only among this partner's credits.
  if (!isCustomerRecordReference(parsed.data.bookingRef, "booking")) return res.status(404).json({ error: "No credited agency booking found" });
  const credits = await db.bookingChannelAttribution.findMany({ where: { salesPartnerId: partnerId }, select: { bookingId: true }, take: 5000 });
  const match = credits.find((c: any) => matchesCustomerRecordReference(parsed.data.bookingRef, "booking", c.bookingId));
  if (!match) return res.status(404).json({ error: "No credited agency booking found" });
  const bookingId: number = match.bookingId;
  const now = new Date();
  const attribution = await db.bookingChannelAttribution.findUnique({ where: { bookingId } });
  if (!attribution || attribution.status === "VOID") return res.status(404).json({ error: "No credited agency booking found" });
  const outcome = await db.$transaction(async (tx: any) => {
    const moved = await tx.bookingChannelAttribution.updateMany({
      where: { id: attribution.id, status: attribution.status },
      data: { status: "VOID", voidedAt: now, voidedById: Number(req.user!.id), voidReason: sanitizeText(parsed.data.reason).slice(0, 300) },
    });
    if (moved.count !== 1) return null;
    const commission = await tx.salesCommission.findFirst({ where: { type: "AGENCY_STAY", sourceBookingId: bookingId, reversalOfId: null } });
    const reversal = commission ? await autoReverseSalesCommission(tx, commission.id, `Agency credit voided: ${parsed.data.reason}`, now) : "UNCHANGED";
    return { reversal };
  }, COMMISSION_TRANSACTION_OPTIONS);
  if (!outcome) return res.status(409).json({ error: "The attribution was changed by another request" });
  await audit(req, "SALES_AGENCY_ATTRIBUTION_VOID", "BOOKING", { status: attribution.status }, { status: "VOID", reason: parsed.data.reason, ...outcome }, bookingId);
  return res.json({ ok: true, ...outcome });
}) as RequestHandler);

export default router;
