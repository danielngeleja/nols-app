import { Router } from "express";
import type { RequestHandler } from "express";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { prisma } from "@nolsaf/prisma";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { evaluateTourCancellation, packageIsNonRefundable } from "../lib/tourCancellationPolicy.js";
import { notifyAdmins } from "../lib/notifications.js";
import { notifyTourOperatorCase } from "../lib/tourCaseNotifications.js";

const router = Router();
router.use(requireAuth as RequestHandler);

function toCustomerTimelineStatus(rawStatus: string | null | undefined, paymentStatus: string | null | undefined): string {
  const status = String(rawStatus || "").trim().toUpperCase();
  const pay = String(paymentStatus || "").trim().toUpperCase();

  if (status === "COMPLETED") return "COMPLETED";
  if (status === "IN_PROGRESS" || status === "ACTIVE" || status === "ONGOING") return "IN_PROGRESS";
  if (pay === "PAID") return "PAID";
  if (status === "CONFIRMED") return "CONFIRMED";
  return "REQUESTED";
}

type TourDashboardBucket = "DRAFT" | "PAID_PACKAGES" | "ACTIVE_TIMELINE" | "COMPLETED";
type TimelineAccessRole = "OWNER" | "TRAVELLER";

function safeObject(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function safeArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function hashTimelineInviteToken(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function signTimelineInviteToken(bookingId: number, inviteId: string): string {
  const payload = `${bookingId}:${inviteId}`;
  const sig = crypto.createHmac("sha256", getTokenSecret()).update(payload).digest("base64url");
  return `${bookingId}.${inviteId}.${sig}`;
}

function parseTimelineInviteToken(token: string): (
  | { kind: "signed"; bookingId: number; inviteId: string; signature: string }
  | { kind: "legacy"; bookingId: number; rawToken: string }
  | null
) {
  const signed = token.match(/^(\d+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (signed) return { kind: "signed", bookingId: Number(signed[1]), inviteId: signed[2], signature: signed[3] };
  const legacy = token.match(/^(\d+)-(.+)$/);
  if (legacy) return { kind: "legacy", bookingId: Number(legacy[1]), rawToken: legacy[2] };
  return null;
}

function findTimelineInvite(md: Record<string, any>, parsed: ReturnType<typeof parseTimelineInviteToken>) {
  if (!parsed) return null;
  const invites = safeArray(md.timelineInvites);
  if (parsed.kind === "signed") {
    const expected = signTimelineInviteToken(parsed.bookingId, parsed.inviteId).split(".").pop() || "";
    if (expected !== parsed.signature) return null;
    return invites.find((entry) => String(entry?.id || "") === parsed.inviteId) || null;
  }
  const tokenHash = hashTimelineInviteToken(parsed.rawToken);
  return invites.find((entry) => String(entry?.tokenHash || "") === tokenHash) || null;
}

function cleanOrigin(value: unknown): string | null {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function resolveWebOrigin(req: AuthedRequest): string {
  const configured =
    cleanOrigin(process.env.FRONTEND_URL) ||
    cleanOrigin(process.env.WEB_ORIGIN) ||
    cleanOrigin(process.env.APP_ORIGIN) ||
    cleanOrigin(process.env.APP_URL) ||
    cleanOrigin(String(process.env.CORS_ORIGIN || "").split(",")[0]);
  if (configured) return configured;

  const requestOrigin = cleanOrigin(req.get("origin")) || cleanOrigin(req.get("referer"));
  if (requestOrigin) return requestOrigin;

  return `${req.protocol}://${req.get("host")}`;
}

function findTimelineParticipant(md: Record<string, any>, userId: number) {
  return safeArray(md.timelineParticipants).find((participant) => (
    Number(participant?.userId) === Number(userId) &&
    String(participant?.status || "ACCEPTED").toUpperCase() === "ACCEPTED"
  )) || null;
}

function acceptedTimelineParticipants(md: Record<string, any>) {
  return safeArray(md.timelineParticipants).filter((participant) => (
    Number(participant?.userId || 0) > 0 &&
    String(participant?.status || "ACCEPTED").toUpperCase() === "ACCEPTED"
  ));
}

function timelineInviteCapacity(travelerCount: number | null | undefined) {
  const totalTravellers = Math.max(1, Number(travelerCount || 1));
  return Math.max(0, totalTravellers - 1);
}

function timelineTeamSummary(metadata: unknown, travelerCount: number | null | undefined) {
  const md = safeObject(metadata);
  const acceptedCount = acceptedTimelineParticipants(md).length;
  const invitedCapacity = timelineInviteCapacity(travelerCount);
  const totalTravellers = Math.max(1, Number(travelerCount || 1));
  return {
    ownerCount: 1,
    acceptedTravellers: acceptedCount,
    invitedCapacity,
    totalTravellers,
    joinedTotal: Math.min(totalTravellers, acceptedCount + 1),
    remainingTravellers: Math.max(0, invitedCapacity - acceptedCount),
  };
}

function getTimelineAccessRole(booking: { customerId: number | null; metadata: unknown }, userId: number): TimelineAccessRole | null {
  if (Number(booking.customerId) === Number(userId)) return "OWNER";
  const md = safeObject(booking.metadata);
  return findTimelineParticipant(md, userId) ? "TRAVELLER" : null;
}

function toPublicTimelineMetadata(md: Record<string, any>) {
  return {
    departureAirport: md.departureAirport || null,
    selectedAirport: md.selectedAirport || null,
    airport: md.airport || null,
    pickupAirport: md.pickupAirport || null,
    flight: md.flight || null,
    packageSnapshot: md.packageSnapshot || null,
    tourPackage: md.tourPackage || null,
    package: md.package || null,
    itinerary: Array.isArray(md.itinerary) ? md.itinerary : null,
    timelineDays: Array.isArray(md.timelineDays) ? md.timelineDays : null,
    pickupValidation: md.pickupValidation || null,
    pickupValidationOperator: md.pickupValidationOperator || null,
    pickupValidationCustomer: md.pickupValidationCustomer || null,
    pickupCheckIn: md.pickupCheckIn || null,
    pickupTimeline: md.pickupTimeline || null,
    timelineEventRatings: safeObject(md.timelineEventRatings),
    timelineParticipants: safeArray(md.timelineParticipants).map((participant) => ({
      userId: Number(participant?.userId || 0) || null,
      role: String(participant?.role || "TRAVELLER"),
      status: String(participant?.status || "ACCEPTED"),
      acceptedAt: participant?.acceptedAt || null,
    })),
  };
}

function hasTimelineData(packageSnapshot: unknown, metadata: unknown): boolean {
  const pkg = safeObject(packageSnapshot);
  const md = safeObject(metadata);
  const itinerary = Array.isArray(pkg.itinerary) ? pkg.itinerary : Array.isArray(md.itinerary) ? md.itinerary : [];
  const days = Array.isArray(pkg.timelineDays) ? pkg.timelineDays : Array.isArray(md.timelineDays) ? md.timelineDays : [];
  return itinerary.length > 0 || days.length > 0;
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

function getUserTimelineRating(entry: unknown, userId: number): number {
  const eventEntry = safeObject(entry);
  const ratings = safeObject(eventEntry.ratings);
  const userRating = ratings[String(userId)];
  if (userRating) return Number(safeObject(userRating).rating || userRating || 0);

  if (Number(eventEntry.ratedByUserId || 0) === Number(userId)) return Number(eventEntry.rating || 0);
  return 0;
}

function timelineCompletionForUser(packageSnapshot: unknown, metadata: unknown, userId: number) {
  const keys = timelineEventKeys(packageSnapshot, metadata);
  const ratings = safeObject(safeObject(metadata).timelineEventRatings);
  const ratedCount = keys.filter((key) => getUserTimelineRating(ratings[key], userId) > 0).length;
  const totalEvents = keys.length;
  return {
    totalEvents,
    ratedEvents: ratedCount,
    isComplete: totalEvents > 0 && ratedCount >= totalEvents,
    status: totalEvents > 0 && ratedCount >= totalEvents ? "COMPLETED_TIMELINE" : "ACTIVE_TIMELINE",
  };
}

function timelineRatingSummary(metadata: unknown) {
  const eventRatings = safeObject(safeObject(metadata).timelineEventRatings);
  const values = Object.values(eventRatings).flatMap((entry) => {
    const eventEntry = safeObject(entry);
    const ratings = safeObject(eventEntry.ratings);
    if (Object.keys(ratings).length) {
      return Object.values(ratings).map((ratingEntry) => Number(safeObject(ratingEntry).rating || ratingEntry || 0));
    }
    return eventEntry.rating ? [Number(eventEntry.rating || 0)] : [];
  }).filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5);

  const totalRatings = values.length;
  const averageRating = totalRatings ? values.reduce((sum, rating) => sum + rating, 0) / totalRatings : 0;
  return {
    totalRatings,
    averageRating,
  };
}

function isPickupValidated(metadata: unknown): boolean {
  const md = safeObject(metadata);
  const shared = safeObject(md.pickupValidation);
  const operator = safeObject(md.pickupValidationOperator);
  return Boolean(
    shared.validated ||
    shared.firstMeetValidated ||
    shared.validatedAt ||
    operator.validated ||
    operator.validatedAt
  );
}

function toDashboardBucket(params: {
  status: string | null | undefined;
  paymentStatus: string | null | undefined;
  startDate: Date | null;
  endDate: Date | null;
  packageSnapshot: unknown;
  metadata: unknown;
  userId?: number | null;
}): TourDashboardBucket {
  const status = String(params.status || "").trim().toUpperCase();
  const pay = String(params.paymentStatus || "").trim().toUpperCase();
  const pickupValidated = isPickupValidated(params.metadata);
  const hasTimeline = hasTimelineData(params.packageSnapshot, params.metadata);

  if (status.includes("COMPLETE") || status === "DONE" || status === "FINISHED") return "COMPLETED";
  if (pickupValidated && hasTimeline) {
    const completion = params.userId ? timelineCompletionForUser(params.packageSnapshot, params.metadata, params.userId) : null;
    return completion?.isComplete ? "COMPLETED" : "ACTIVE_TIMELINE";
  }

  const isPaid = pay === "PAID" || pay === "APPROVED" || status === "PAID" || status === "CONFIRMED";
  if (!isPaid) return "DRAFT";

  return "PAID_PACKAGES";
}

function bookingCodeSuffix(bookingCode: string | null | undefined): string {
  return String(bookingCode || "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(-6)
    .toUpperCase();
}

function cleanText(value: unknown, max = 500): string {
  return String(value || "").trim().slice(0, max);
}

const MAX_ACTION_MESSAGE_WORDS = 30;
const TIMELINE_RATING_LABELS: Record<number, string> = {
  1: "Bored",
  2: "Okay",
  3: "Good",
  4: "Excited",
  5: "Beyond expectations",
};

function wordCount(value: string): number {
  const text = String(value || "").trim();
  if (!text) return 0;
  return text.split(/\s+/).length;
}

function appendTimelineEvent(md: Record<string, any>, event: { type: string; label: string; at?: string; meta?: Record<string, any> }) {
  const at = event.at || new Date().toISOString();
  const prev = Array.isArray(md.clientTimelineEvents) ? md.clientTimelineEvents : [];
  const next = {
    type: event.type,
    label: event.label,
    at,
    meta: event.meta || null,
  };
  md.clientTimelineEvents = [...prev, next].slice(-100);
}

function buildPickupTimeline(booking: { status: string | null; updatedAt: Date; metadata: unknown }) {
  const md = safeObject(booking.metadata);
  const requestedAt = md?.pickupCheckIn?.requestedAt ? String(md.pickupCheckIn.requestedAt) : null;
  const validatedAt = md?.pickupValidation?.validatedAt ? String(md.pickupValidation.validatedAt) : null;
  const statusUpper = String(booking.status || "").toUpperCase();
  const inProgressAt = md?.inProgressAt
    ? String(md.inProgressAt)
    : statusUpper.includes("PROGRESS")
      ? validatedAt || booking.updatedAt.toISOString()
      : null;
  return { requestedAt, validatedAt, inProgressAt };
}

function getTokenSecret(): string {
  const secret =
    process.env.PUBLIC_LINK_TOKEN_SECRET ||
    process.env.JWT_SECRET ||
    (process.env.NODE_ENV !== "production" ? "dev_jwt_secret" : "");
  if (!secret) throw new Error("tour_booking_secret_missing");
  return secret;
}

const PAYMENT_ACCESS_TOKEN_HOURS = 12;

function signTourBookingAccessToken(tourBookingId: number, expiresIn: SignOptions["expiresIn"] = `${PAYMENT_ACCESS_TOKEN_HOURS}h`): string {
  return jwt.sign(
    { typ: "TOUR_BOOKING_ACCESS", tourBookingId },
    getTokenSecret(),
    { expiresIn, issuer: "nolsaf-public", subject: String(tourBookingId) }
  );
}

function draftPaymentAccessWindow(metadata: unknown, createdAt: Date) {
  const access = safeObject(safeObject(metadata).paymentAccess);
  const createdAtMs = createdAt instanceof Date && Number.isFinite(createdAt.getTime()) ? createdAt.getTime() : Date.now();
  const tokenHours = Number(access.tokenHours || PAYMENT_ACCESS_TOKEN_HOURS);
  const canonicalExpiresAtMs = createdAtMs + PAYMENT_ACCESS_TOKEN_HOURS * 60 * 60 * 1000;
  const issuedAt = String(access.issuedAt || new Date(createdAtMs).toISOString()).trim();
  const expiresAt = new Date(canonicalExpiresAtMs).toISOString();
  const remainingSeconds = Math.max(0, Math.floor((canonicalExpiresAtMs - Date.now()) / 1000));

  return {
    issuedAt,
    expiresAt,
    tokenHours: Number.isFinite(tokenHours) && tokenHours > 0 ? tokenHours : PAYMENT_ACCESS_TOKEN_HOURS,
    source: String(access.source || "CREATED_AT_WINDOW"),
    status: remainingSeconds > 0 ? "ACTIVE" : "EXPIRED",
    remainingSeconds,
  };
}

function formatYmd(value: Date | null | undefined): string {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return "00000000";
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function checksum36(input: string): string {
  let acc = 0;
  for (let i = 0; i < input.length; i += 1) acc += input.charCodeAt(i) * (i + 1);
  return (acc % 36).toString(36).toUpperCase();
}

function buildVoucherIdentity(payload: {
  bookingId: number;
  bookingCode: string | null | undefined;
  startDate: Date | null | undefined;
  travelerCount: number | null | undefined;
}) {
  const suffix = bookingCodeSuffix(payload.bookingCode) || String(payload.bookingId).slice(-6).padStart(6, "0");
  const ymd = formatYmd(payload.startDate);
  const travelerPart = String(Math.max(1, Number(payload.travelerCount || 1))).padStart(2, "0");
  const core = `NLSAF-TVR-${ymd}-${suffix}-${travelerPart}`;
  const check = checksum36(core);
  return {
    voucherNumber: `${core}-${check}`,
    securityMark: `★${suffix}-${check}★`,
    machineLine: `NLSAF|TVR|${payload.bookingId}|${suffix}|${travelerPart}|${check}`,
    issuedAt: new Date().toISOString(),
  };
}

/**
 * GET /api/customer/tour-bookings
 * Returns tour package purchases linked to the authenticated customer account.
 */
router.get("/", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const { page = "1", pageSize = "20", status, bucket } = req.query as any;

    const pageNum = Math.max(1, Number(page) || 1);
    const pageSizeNum = Math.min(50, Math.max(1, Number(pageSize) || 20));
    const skip = (pageNum - 1) * pageSizeNum;

    const where: any = { customerId: userId };
    if (status) {
      where.status = String(status).trim().toUpperCase();
    }

    const [items, total] = await Promise.all([
      prisma.tourBooking.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSizeNum,
        select: {
          id: true,
          bookingCode: true,
          title: true,
          destination: true,
          category: true,
          startDate: true,
          endDate: true,
          travelerCount: true,
          status: true,
          paymentStatus: true,
          payoutStatus: true,
          currency: true,
          grossAmount: true,
          guestName: true,
          guestEmail: true,
          guestPhone: true,
          paidAt: true,
          confirmedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true,
          operatorSnapshot: true,
          packageSnapshot: true,
          metadata: true,
        },
      }),
      prisma.tourBooking.count({ where }),
    ]);

    const normalizedBucket = String(bucket || "").trim().toUpperCase();
    const bucketSet = new Set(["DRAFT", "PAID_PACKAGES", "ACTIVE_TIMELINE", "COMPLETED"]);
    const bucketFilter = bucketSet.has(normalizedBucket) ? (normalizedBucket as TourDashboardBucket) : null;

    const mapped = items.map((item) => {
      const dashboardBucket = toDashboardBucket({
        status: item.status,
        paymentStatus: item.paymentStatus,
        startDate: item.startDate,
        endDate: item.endDate,
        packageSnapshot: item.packageSnapshot,
        metadata: item.metadata,
        userId,
      });
      const hasTimeline = hasTimelineData(item.packageSnapshot, item.metadata);
      const timelineCompletion = timelineCompletionForUser(item.packageSnapshot, item.metadata, userId);
      const md = safeObject(item.metadata);
      const pickupTimeline = buildPickupTimeline({ status: item.status, updatedAt: item.updatedAt, metadata: item.metadata });
      const draftAccess = dashboardBucket === "DRAFT" ? draftPaymentAccessWindow(item.metadata, item.createdAt) : null;
      return {
        id: item.id,
        bookingCode: item.bookingCode,
        bookingCodeSuffix: bookingCodeSuffix(item.bookingCode),
        title: item.title,
        destination: item.destination,
        category: item.category,
        startDate: item.startDate,
        endDate: item.endDate,
        travelerCount: item.travelerCount,
        status: item.status,
        paymentStatus: item.paymentStatus,
        payoutStatus: item.payoutStatus,
        timelineStatus: toCustomerTimelineStatus(item.status, item.paymentStatus),
        timelineCompletionStatus: timelineCompletion.status,
        timelineCompletion,
        timelineRatingSummary: timelineRatingSummary(item.metadata),
        dashboardBucket,
        hasTimeline,
        pickupValidation: md.pickupValidation || null,
        pickupCheckIn: md.pickupCheckIn || null,
        metadata: {
          pickupValidationOperator: md.pickupValidationOperator || null,
          pickupValidationCustomer: md.pickupValidationCustomer || null,
        },
        pickupTimeline,
        currency: item.currency,
        grossAmount: Number(item.grossAmount || 0),
        guestName: item.guestName,
        guestEmail: item.guestEmail,
        guestPhone: item.guestPhone,
        paidAt: item.paidAt,
        confirmedAt: item.confirmedAt,
        completedAt: item.completedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        draftExpiresAt: draftAccess?.expiresAt ?? null,
        draftExpiryStatus: draftAccess?.status ?? null,
        operatorSnapshot: item.operatorSnapshot,
      };
    });

    const filtered = bucketFilter
      ? mapped.filter((item) => item.dashboardBucket === bucketFilter)
      : mapped;

    return res.json({
      items: filtered,
      total: filtered.length,
      page: pageNum,
      pageSize: pageSizeNum,
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings error:", error);
    return res.status(500).json({ error: "Failed to fetch tour bookings" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id
 * Returns one tour package purchase linked to the authenticated customer account.
 */
router.get("/:id", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: {
        id: idNum,
        customerId: userId,
      },
      select: {
        id: true,
        bookingCode: true,
        packageId: true,
        packageSnapshot: true,
        operatorSnapshot: true,
        title: true,
        destination: true,
        category: true,
        startDate: true,
        endDate: true,
        travelerCount: true,
        status: true,
        paymentStatus: true,
        payoutStatus: true,
        currency: true,
        unitPrice: true,
        grossAmount: true,
        commissionPercent: true,
        commissionAmount: true,
        operatorPayoutAmount: true,
        guestName: true,
        guestEmail: true,
        guestPhone: true,
        nationality: true,
        paymentProvider: true,
        paymentRef: true,
        payerPhone: true,
        paidAt: true,
        confirmedAt: true,
        completedAt: true,
        notes: true,
        metadata: true,
        operatorAgentId: true,
        createdAt: true,
        updatedAt: true,
        cases: {
          where: { type: "CANCELLATION" },
          orderBy: { createdAt: "desc" },
          take: 5,
          include: { events: { orderBy: { createdAt: "desc" }, take: 5 } },
        },
      },
    });

    if (!booking) {
      return res.status(404).json({ error: "Tour booking not found" });
    }

    const md = safeObject(booking.metadata);
    const dashboardBucket = toDashboardBucket({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      startDate: booking.startDate,
      endDate: booking.endDate,
      packageSnapshot: booking.packageSnapshot,
      metadata: booking.metadata,
      userId,
    });

    const pickupTimeline = buildPickupTimeline({ status: booking.status, updatedAt: booking.updatedAt, metadata: booking.metadata });
    const timelineCompletion = timelineCompletionForUser(booking.packageSnapshot, booking.metadata, userId);
    const paymentComplete = String(booking.paymentStatus || "").toUpperCase() === "PAID" || Boolean(booking.paidAt);
    const paymentAccess = draftPaymentAccessWindow(booking.metadata, booking.createdAt);
    const paymentAccessToken = !paymentComplete && paymentAccess.status === "ACTIVE"
      ? signTourBookingAccessToken(booking.id, paymentAccess.remainingSeconds)
      : null;
    const paymentUrl = paymentAccessToken
      ? `/public/booking/tour-payment?tourBookingId=${booking.id}&accessToken=${encodeURIComponent(paymentAccessToken)}`
      : null;
    if (!paymentComplete) {
      md.paymentAccess = {
        ...safeObject(md.paymentAccess),
        issuedAt: paymentAccess.issuedAt,
        expiresAt: paymentAccess.expiresAt,
        tokenHours: paymentAccess.tokenHours,
        source: paymentAccess.source,
        status: paymentAccess.status,
      };
      await prisma.tourBooking.update({
        where: { id: booking.id },
        data: { metadata: md as any },
        select: { id: true },
      });
    }

    return res.json({
      ...booking,
      metadata: md,
      bookingCodeSuffix: bookingCodeSuffix(booking.bookingCode),
      timelineStatus: toCustomerTimelineStatus(booking.status, booking.paymentStatus),
      timelineCompletionStatus: timelineCompletion.status,
      timelineCompletion,
      dashboardBucket,
      pickupValidation: md.pickupValidation || null,
      pickupCheckIn: md.pickupCheckIn || null,
      pickupTimeline,
      clientTimelineEvents: Array.isArray(md.clientTimelineEvents) ? md.clientTimelineEvents : [],
      timelineTeam: timelineTeamSummary(booking.metadata, booking.travelerCount),
      timelineShare: (() => {
        if (!isPickupValidated(booking.metadata)) {
          return { hasInvite: false, invitePath: null, inviteUrl: null, expiresAt: null };
        }
        const activeInvite = safeArray(md.timelineInvites).find((invite) => (
          String(invite?.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
          (!invite?.expiresAt || new Date(invite.expiresAt).getTime() > Date.now())
        ));
        const origin = resolveWebOrigin(req);
        const token = activeInvite?.id ? signTimelineInviteToken(booking.id, String(activeInvite.id)) : null;
        const invitePath = token ? `/account/tour-packages/invite/${encodeURIComponent(token)}` : null;
        return {
          hasInvite: Boolean(token),
          invitePath,
          inviteUrl: invitePath ? `${origin}${invitePath}` : null,
          expiresAt: activeInvite?.expiresAt || null,
        };
      })(),
      paymentResume: {
        paymentUrl,
        paymentAccessToken,
        paymentAccessTokenExpiresAt: paymentAccess.expiresAt,
        paymentAccessTokenStatus: paymentAccess.status,
      },
      unitPrice: Number(booking.unitPrice || 0),
      grossAmount: Number(booking.grossAmount || 0),
      commissionPercent: Number(booking.commissionPercent || 0),
      commissionAmount: Number(booking.commissionAmount || 0),
      operatorPayoutAmount: Number(booking.operatorPayoutAmount || 0),
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id error:", error);
    return res.status(500).json({ error: "Failed to fetch tour booking" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id/timeline
 * Timeline-only view for booking owner or accepted traveller participants.
 */
router.get("/:id/timeline", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }

    const booking = await prisma.tourBooking.findUnique({
      where: { id: idNum },
      select: {
        id: true,
        bookingCode: true,
        packageId: true,
        packageSnapshot: true,
        operatorSnapshot: true,
        title: true,
        destination: true,
        category: true,
        operatorAgentId: true,
        startDate: true,
        endDate: true,
        travelerCount: true,
        status: true,
        paymentStatus: true,
        guestName: true,
        metadata: true,
        customerId: true,
        updatedAt: true,
      },
    });

    if (!booking) return res.status(404).json({ error: "Tour booking not found" });
    const accessRole = getTimelineAccessRole(booking, userId);
    if (!accessRole) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const dashboardBucket = toDashboardBucket({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      startDate: booking.startDate,
      endDate: booking.endDate,
      packageSnapshot: booking.packageSnapshot,
      metadata: booking.metadata,
      userId,
    });
    const timelineCompletion = timelineCompletionForUser(booking.packageSnapshot, booking.metadata, userId);
    const pickupTimeline = buildPickupTimeline({ status: booking.status, updatedAt: booking.updatedAt, metadata: booking.metadata });

    return res.json({
      id: booking.id,
      bookingCode: booking.bookingCode,
      bookingCodeSuffix: bookingCodeSuffix(booking.bookingCode),
      packageId: booking.packageId,
      packageSnapshot: booking.packageSnapshot,
      operatorSnapshot: booking.operatorSnapshot,
      title: booking.title,
      destination: booking.destination,
      category: booking.category,
      operatorAgentId: booking.operatorAgentId,
      startDate: booking.startDate,
      endDate: booking.endDate,
      travelerCount: booking.travelerCount,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      timelineStatus: toCustomerTimelineStatus(booking.status, booking.paymentStatus),
      timelineCompletionStatus: timelineCompletion.status,
      timelineCompletion,
      dashboardBucket,
      pickupValidation: md.pickupValidation || null,
      pickupCheckIn: md.pickupCheckIn || null,
      pickupTimeline,
      metadata: toPublicTimelineMetadata(md),
      timelineTeam: timelineTeamSummary(booking.metadata, booking.travelerCount),
      timelineAccessRole: accessRole,
      timelineCurrentUserId: userId,
      timelineIsOwner: accessRole === "OWNER",
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/timeline error:", error);
    return res.status(500).json({ error: "Failed to fetch tour timeline" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/timeline-invite
 * Booking owner creates a secure invite for another traveller to join the timeline.
 */
router.post("/:id/timeline-invite", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, title: true, bookingCode: true, travelerCount: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });
    if (!isPickupValidated(booking.metadata)) {
      return res.status(409).json({
        error: "meetup_not_validated",
        message: "Validate meetup before sharing this timeline.",
      });
    }

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const md = safeObject(booking.metadata);
    const inviteCapacity = timelineInviteCapacity(booking.travelerCount);
    const acceptedCount = acceptedTimelineParticipants(md).length;
    const remainingSlots = Math.max(0, inviteCapacity - acceptedCount);
    const existingInvites = safeArray(md.timelineInvites);
    const activeInvite = existingInvites.find((entry) => (
      String(entry?.status || "ACTIVE").toUpperCase() === "ACTIVE" &&
      (!entry?.expiresAt || new Date(entry.expiresAt).getTime() > Date.now())
    ));

    if (!activeInvite && remainingSlots <= 0) {
      return res.status(409).json({
        error: "traveller_capacity_full",
        message: `This booking allows ${booking.travelerCount || 1} traveller${Number(booking.travelerCount || 1) === 1 ? "" : "s"} total, and all shared timeline slots are already used.`,
      });
    }
    const invite = activeInvite || {
      id: crypto.randomBytes(12).toString("base64url"),
      status: "ACTIVE",
      role: "TRAVELLER",
      maxAcceptedTravellers: remainingSlots,
      bookingTravelerCount: booking.travelerCount || 1,
      createdByUserId: userId,
      createdAt: nowIso,
      expiresAt,
      acceptedByUserIds: [],
    };
    if (!activeInvite) {
      const inactiveInvites = existingInvites.filter((entry) => String(entry?.status || "ACTIVE").toUpperCase() !== "ACTIVE").slice(-10);
      md.timelineInvites = [...inactiveInvites, invite];
      appendTimelineEvent(md, {
        type: "TIMELINE_INVITE_CREATED",
        label: "Customer created a timeline invite",
        at: nowIso,
        meta: { inviteId: invite.id, role: invite.role, expiresAt },
      });

      await prisma.tourBooking.update({
        where: { id: booking.id },
        data: { metadata: md as any },
        select: { id: true },
      });
    }

    const token = signTimelineInviteToken(booking.id, String(invite.id));
    const invitePath = `/account/tour-packages/invite/${encodeURIComponent(token)}`;
    const origin = resolveWebOrigin(req);
    return res.json({
      ok: true,
      reused: Boolean(activeInvite),
      invite: {
        id: invite.id,
        role: invite.role,
        expiresAt: invite.expiresAt || expiresAt,
        remainingSlots,
        team: timelineTeamSummary(md, booking.travelerCount),
      },
      invitePath,
      inviteUrl: `${origin}${invitePath}`,
    });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/timeline-invite error:", error);
    return res.status(500).json({ error: "Failed to create timeline invite" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/timeline-invites/:token
 * Authenticated traveller previews an invite before accepting.
 */
router.get("/timeline-invites/:token", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const token = cleanText(req.params.token, 220);
    const parsedToken = parseTimelineInviteToken(token);
    if (!parsedToken) return res.status(400).json({ error: "Invalid timeline invite" });

    const booking = await prisma.tourBooking.findUnique({
      where: { id: parsedToken.bookingId },
      select: { id: true, title: true, bookingCode: true, travelerCount: true, metadata: true, customerId: true },
    });
    if (!booking) return res.status(404).json({ error: "Timeline invite not found" });

    const md = safeObject(booking.metadata);
    const invite = findTimelineInvite(md, parsedToken);
    if (!invite || String(invite?.status || "").toUpperCase() !== "ACTIVE") {
      return res.status(404).json({ error: "Timeline invite not found" });
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: "Timeline invite has expired" });
    }

    const accessRole = getTimelineAccessRole(booking, userId);
    const inviteCapacity = timelineInviteCapacity(booking.travelerCount);
    const acceptedCount = acceptedTimelineParticipants(md).length;
    return res.json({
      ok: true,
      bookingId: booking.id,
      title: booking.title,
      bookingCode: booking.bookingCode,
      alreadyAccepted: Boolean(accessRole),
      travelerCount: booking.travelerCount,
      remainingSlots: Math.max(0, inviteCapacity - acceptedCount),
      timelineUrl: `/account/tour-packages/${booking.id}/timeline`,
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/timeline-invites/:token error:", error);
    return res.status(500).json({ error: "Failed to load timeline invite" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/timeline-invites/:token/accept
 * Authenticated traveller accepts a timeline invite.
 */
router.post("/timeline-invites/:token/accept", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const token = cleanText(req.params.token, 220);
    const parsedToken = parseTimelineInviteToken(token);
    if (!parsedToken) return res.status(400).json({ error: "Invalid timeline invite" });

    const [booking, user] = await Promise.all([
      prisma.tourBooking.findUnique({
        where: { id: parsedToken.bookingId },
        select: { id: true, title: true, bookingCode: true, travelerCount: true, metadata: true, customerId: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, phone: true },
      }),
    ]);
    if (!booking) return res.status(404).json({ error: "Timeline invite not found" });

    const md = safeObject(booking.metadata);
    const invites = safeArray(md.timelineInvites);
    const inviteIndex = invites.findIndex((entry) => {
      const found = findTimelineInvite({ timelineInvites: [entry] }, parsedToken);
      return Boolean(found);
    });
    const invite = inviteIndex >= 0 ? invites[inviteIndex] : null;
    if (!invite || String(invite?.status || "").toUpperCase() !== "ACTIVE") {
      return res.status(404).json({ error: "Timeline invite not found" });
    }
    if (invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: "Timeline invite has expired" });
    }

    const nowIso = new Date().toISOString();
    const existingRole = getTimelineAccessRole(booking, userId);
    const inviteCapacity = timelineInviteCapacity(booking.travelerCount);
    const acceptedCount = acceptedTimelineParticipants(md).length;
    if (!existingRole && acceptedCount >= inviteCapacity) {
      return res.status(409).json({
        error: "traveller_capacity_full",
        message: `This booking allows ${booking.travelerCount || 1} traveller${Number(booking.travelerCount || 1) === 1 ? "" : "s"} total, and all shared timeline slots are already used.`,
      });
    }

    if (!existingRole) {
      const participants = safeArray(md.timelineParticipants);
      md.timelineParticipants = [
        ...participants,
        {
          userId,
          role: "TRAVELLER",
          status: "ACCEPTED",
          invitedByUserId: Number(invite.createdByUserId || 0) || null,
          inviteId: invite.id || null,
          displayName: user?.name || user?.email || user?.phone || "Traveller",
          acceptedAt: nowIso,
        },
      ].slice(-100);
    }

    const acceptedByUserIds = Array.from(new Set([...safeArray(invite.acceptedByUserIds).map(Number).filter(Boolean), userId]));
    invites[inviteIndex] = { ...invite, acceptedByUserIds, lastAcceptedAt: nowIso };
    md.timelineInvites = invites;
    appendTimelineEvent(md, {
      type: "TIMELINE_INVITE_ACCEPTED",
      label: "Traveller joined the shared timeline",
      at: nowIso,
      meta: { inviteId: invite.id || null, travellerUserId: userId },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({
      ok: true,
      bookingId: booking.id,
      accessRole: existingRole || "TRAVELLER",
      timelineUrl: `/account/tour-packages/${booking.id}/timeline`,
    });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/timeline-invites/:token/accept error:", error);
    return res.status(500).json({ error: "Failed to accept timeline invite" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/start-pickup-checkin
 * Customer starts pickup check-in flow and receives booking code suffix to share at pickup.
 */
router.post("/:id/start-pickup-checkin", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const note = String((req.body as any)?.note || "").trim().slice(0, 240) || null;

    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: {
        id: true,
        bookingCode: true,
        guestName: true,
        status: true,
        paymentStatus: true,
        metadata: true,
      },
    });

    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const dashboardBucket = toDashboardBucket({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      startDate: null,
      endDate: null,
      packageSnapshot: null,
      metadata: booking.metadata,
    });

    if (dashboardBucket === "DRAFT" || dashboardBucket === "COMPLETED") {
      return res.status(409).json({
        error: "pickup_not_available",
        message: "Pickup check-in is available only for paid/active packages.",
      });
    }

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const suffix = bookingCodeSuffix(booking.bookingCode);

    const prevHistory = Array.isArray(md.pickupCheckInHistory) ? md.pickupCheckInHistory : [];
    const event = {
      at: nowIso,
      byCustomerId: userId,
      action: "START_PICKUP_CHECKIN",
      codeSuffix: suffix,
      note,
    };

    md.pickupCheckIn = {
      requested: true,
      requestedAt: nowIso,
      requestedByCustomerId: userId,
      codeSuffix: suffix,
      note,
      state: "WAITING_OPERATOR_VALIDATION",
    };
    md.pickupCheckInHistory = [...prevHistory, event].slice(-20);
    appendTimelineEvent(md, {
      type: "PICKUP_REQUESTED",
      label: "Pickup check-in requested",
      at: nowIso,
      meta: { codeSuffix: suffix },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({
      ok: true,
      message: "Pickup check-in started. Share the code suffix with the operator for validation.",
      pickupCheckIn: md.pickupCheckIn,
      bookingCodeSuffix: suffix,
    });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/start-pickup-checkin error:", error);
    return res.status(500).json({ error: "Failed to start pickup check-in" });
  }
}) as RequestHandler);
/**
 * POST /api/customer/tour-bookings/:id/validate-pickup
 * Customer confirms first meetup and self-validates after policy agreement.
 */
router.post("/:id/validate-pickup", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const agreed = Boolean((req.body as any)?.policyAgreed);
    const providedSuffix = String((req.body as any)?.codeSuffix || "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toUpperCase();

    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }
    if (!agreed) {
      return res.status(400).json({ error: "policy_agreement_required", message: "You must agree to verification policy before validation." });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: {
        id: true,
        bookingCode: true,
        status: true,
        paymentStatus: true,
        metadata: true,
      },
    });

    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const dashboardBucket = toDashboardBucket({
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      startDate: null,
      endDate: null,
      packageSnapshot: null,
      metadata: booking.metadata,
    });

    if (dashboardBucket === "DRAFT" || dashboardBucket === "COMPLETED") {
      return res.status(409).json({
        error: "pickup_not_available",
        message: "Pickup validation is available only for paid/active packages.",
      });
    }

    const expectedSuffix = bookingCodeSuffix(booking.bookingCode);
    if (!expectedSuffix) {
      return res.status(400).json({ error: "missing_booking_code", message: "Booking code suffix is unavailable for validation." });
    }
    if (providedSuffix && providedSuffix !== expectedSuffix) {
      return res.status(400).json({
        error: "invalid_code_suffix",
        message: "Code suffix does not match this booking.",
      });
    }

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const codeSuffix = providedSuffix || expectedSuffix;
    const customerDisplayName = String(
      booking.guestName ||
      req.user?.name ||
      req.user?.email ||
      `User #${userId}`
    ).trim();

    const prevCheckIn = safeObject(md.pickupCheckIn);
    const prevCustomerValidation = safeObject(md.pickupValidationCustomer);
    md.pickupCheckIn = {
      ...prevCheckIn,
      requested: true,
      requestedAt: String(prevCheckIn.requestedAt || nowIso),
      requestedByCustomerId: prevCheckIn.requestedByCustomerId || userId,
      codeSuffix,
      state: "CUSTOMER_CONFIRMED",
    };

    const prevValidationHistory = Array.isArray(md.pickupValidationHistory) ? md.pickupValidationHistory : [];
    const validationEvent = {
      at: nowIso,
      byCustomerId: userId,
      method: "CUSTOMER_POLICY_ACK",
      expectedSuffix,
      providedSuffix: codeSuffix,
    };

    md.pickupValidationCustomer = {
      ...prevCustomerValidation,
      validated: true,
      validatedAt: nowIso,
      validatedByCustomerId: userId,
      validatedByName: customerDisplayName,
      expectedSuffix,
      providedSuffix: codeSuffix,
      source: "CUSTOMER",
    };
    md.pickupValidationHistory = [...prevValidationHistory, validationEvent].slice(-20);

    appendTimelineEvent(md, {
      type: "CUSTOMER_PICKUP_CONFIRMED",
      label: "Pickup confirmation submitted by customer",
      at: nowIso,
      meta: { byCustomerId: userId },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    const pickupTimeline = buildPickupTimeline({
      status: booking.status,
      updatedAt: new Date(nowIso),
      metadata: md,
    });

    return res.json({
      ok: true,
      message: "Your meetup confirmation was recorded. Operator validation is still required to unlock the official timeline.",
      pickupValidation: md.pickupValidation,
      pickupValidationCustomer: md.pickupValidationCustomer,
      pickupTimeline,
      bookingCodeSuffix: expectedSuffix,
    });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/validate-pickup error:", error);
    return res.status(500).json({ error: "Failed to validate meetup" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id/chat
 * Package-scoped chat thread for customer/operator conversation.
 */
router.get("/:id/chat", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, bookingCode: true, metadata: true, updatedAt: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const messages = Array.isArray(md.chatMessages) ? md.chatMessages : [];
    return res.json({
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      messages,
      updatedAt: booking.updatedAt,
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/chat error:", error);
    return res.status(500).json({ error: "Failed to fetch chat" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/chat
 * Post customer message into package-scoped chat thread.
 */
router.post("/:id/chat", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const body = cleanText((req.body as any)?.body, 2000);
    if (!Number.isFinite(idNum) || idNum <= 0) {
      return res.status(400).json({ error: "Invalid booking id" });
    }
    if (!body) return res.status(400).json({ error: "Message body is required" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true, bookingCode: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const prev = Array.isArray(md.chatMessages) ? md.chatMessages : [];
    const msg = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderRole: "CUSTOMER",
      senderUserId: userId,
      body,
      createdAt: nowIso,
    };
    md.chatMessages = [...prev, msg].slice(-500);
    appendTimelineEvent(md, {
      type: "CHAT_MESSAGE",
      label: "Customer sent a chat message",
      at: nowIso,
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, message: msg });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/chat error:", error);
    return res.status(500).json({ error: "Failed to send chat message" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/request-change
 * Customer submits change request for this package.
 */
router.post("/:id/request-change", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const title = cleanText((req.body as any)?.title, 160);
    const message = cleanText((req.body as any)?.message, 2000);
    const changeType = cleanText((req.body as any)?.changeType, 80) || "GENERAL";

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!title) return res.status(400).json({ error: "Change request title is required" });
    if (!message) return res.status(400).json({ error: "Change request message is required" });
    if (wordCount(message) > MAX_ACTION_MESSAGE_WORDS) {
      return res.status(400).json({ error: `Change request details must be ${MAX_ACTION_MESSAGE_WORDS} words or fewer` });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const prev = Array.isArray(md.changeRequests) ? md.changeRequests : [];
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      requestedByUserId: userId,
      title,
      changeType,
      message,
      status: "OPEN",
      createdAt: nowIso,
    };
    md.changeRequests = [...prev, entry].slice(-100);
    appendTimelineEvent(md, {
      type: "REQUEST_CHANGE",
      label: "Customer requested a package change",
      at: nowIso,
      meta: { title, changeType },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, request: entry });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/request-change error:", error);
    return res.status(500).json({ error: "Failed to submit change request" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/timeline-event-rating
 * Owner or accepted traveller submits one permanent personal rating for a timetable event.
 */
router.post("/:id/timeline-event-rating", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const key = cleanText((req.body as any)?.key, 120);
    const day = Number((req.body as any)?.day || 0);
    const slotIndex = Number((req.body as any)?.slotIndex ?? -1);
    const time = cleanText((req.body as any)?.time, 80);
    const title = cleanText((req.body as any)?.title, 180);
    const rating = Number((req.body as any)?.rating || 0);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!key) return res.status(400).json({ error: "Timeline event key is required" });
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: "Rating must be between 1 and 5" });
    }

    const booking = await prisma.tourBooking.findUnique({
      where: { id: idNum },
      select: { id: true, customerId: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });
    const accessRole = getTimelineAccessRole(booking, userId);
    if (!accessRole) return res.status(404).json({ error: "Tour booking not found" });

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const prevRatings = safeObject(md.timelineEventRatings);
    const existingEvent = safeObject(prevRatings[key]);
    const migratedRatings = safeObject(existingEvent.ratings);
    if (!Object.keys(migratedRatings).length && existingEvent.rating) {
      const legacyUserId = String(existingEvent.ratedByUserId || booking.customerId || "legacy-owner");
      migratedRatings[legacyUserId] = {
        rating: Number(existingEvent.rating),
        label: String(existingEvent.label || TIMELINE_RATING_LABELS[Number(existingEvent.rating)] || `${existingEvent.rating}/5`),
        ratedByUserId: existingEvent.ratedByUserId || booking.customerId || null,
        ratedByRole: Number(existingEvent.ratedByUserId || booking.customerId) === Number(booking.customerId) ? "OWNER" : "TRAVELLER",
        ratedAt: existingEvent.ratedAt || nowIso,
      };
    }

    const userRatingKey = String(userId);
    if (migratedRatings[userRatingKey]) {
      return res.status(409).json({
        error: "rating_already_submitted",
        message: "You have already rated this event.",
        rating: migratedRatings[userRatingKey],
      });
    }

    const personalRating = {
      rating,
      label: TIMELINE_RATING_LABELS[rating] || `${rating}/5`,
      ratedByUserId: userId,
      ratedByRole: accessRole,
      ratedAt: nowIso,
    };
    migratedRatings[userRatingKey] = personalRating;

    const entry = {
      key,
      day: Number.isFinite(day) && day > 0 ? day : existingEvent.day || null,
      slotIndex: Number.isFinite(slotIndex) && slotIndex >= 0 ? slotIndex : existingEvent.slotIndex || null,
      time: time || existingEvent.time || null,
      title: title || existingEvent.title || "Activity details",
      ratings: migratedRatings,
      updatedAt: nowIso,
    };

    md.timelineEventRatings = {
      ...prevRatings,
      [key]: entry,
    };
    appendTimelineEvent(md, {
      type: "TIMELINE_EVENT_RATED",
      label: "Customer rated a timeline event",
      at: nowIso,
      meta: { key, day: entry.day, slotIndex: entry.slotIndex, rating, label: personalRating.label, accessRole },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, rating: personalRating, timelineEventRatings: md.timelineEventRatings });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/timeline-event-rating error:", error);
    return res.status(500).json({ error: "Failed to save timeline rating" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/report-issue
 * Customer reports an issue for this package.
 */
router.post("/:id/report-issue", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const title = cleanText((req.body as any)?.title, 160);
    const message = cleanText((req.body as any)?.message, 2000);
    const issueType = cleanText((req.body as any)?.issueType, 80) || "GENERAL";
    const severityRaw = cleanText((req.body as any)?.severity, 20).toUpperCase();
    const severity = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(severityRaw) ? severityRaw : "MEDIUM";

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!title) return res.status(400).json({ error: "Issue title is required" });
    if (!message) return res.status(400).json({ error: "Issue message is required" });
    if (wordCount(message) > MAX_ACTION_MESSAGE_WORDS) {
      return res.status(400).json({ error: `Issue details must be ${MAX_ACTION_MESSAGE_WORDS} words or fewer` });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const prev = Array.isArray(md.issueReports) ? md.issueReports : [];
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      reportedByUserId: userId,
      title,
      issueType,
      severity,
      message,
      status: "OPEN",
      createdAt: nowIso,
    };
    md.issueReports = [...prev, entry].slice(-100);
    appendTimelineEvent(md, {
      type: "REPORT_ISSUE",
      label: "Customer reported an issue",
      at: nowIso,
      meta: { title, issueType, severity },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, issue: entry });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/report-issue error:", error);
    return res.status(500).json({ error: "Failed to report issue" });
  }
}) as RequestHandler);

/**
 * DELETE /api/customer/tour-bookings/:id/request-change/:requestId
 * Customer removes one of their change request audit entries.
 */
router.delete("/:id/request-change/:requestId", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const requestId = cleanText(req.params.requestId, 120);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!requestId) return res.status(400).json({ error: "Invalid request id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const prev = Array.isArray(md.changeRequests) ? md.changeRequests : [];
    const next = prev.filter((entry: any) => String(entry?.id || "") !== requestId);
    if (next.length === prev.length) return res.status(404).json({ error: "Change request not found" });

    md.changeRequests = next;
    appendTimelineEvent(md, {
      type: "REQUEST_CHANGE_DELETED",
      label: "Customer deleted a change request",
      at: new Date().toISOString(),
      meta: { requestId },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /customer/tour-bookings/:id/request-change/:requestId error:", error);
    return res.status(500).json({ error: "Failed to delete change request" });
  }
}) as RequestHandler);

/**
 * DELETE /api/customer/tour-bookings/:id/report-issue/:issueId
 * Customer removes one of their issue report audit entries.
 */
router.delete("/:id/report-issue/:issueId", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const issueId = cleanText(req.params.issueId, 120);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!issueId) return res.status(400).json({ error: "Invalid issue id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const prev = Array.isArray(md.issueReports) ? md.issueReports : [];
    const next = prev.filter((entry: any) => String(entry?.id || "") !== issueId);
    if (next.length === prev.length) return res.status(404).json({ error: "Issue report not found" });

    md.issueReports = next;
    appendTimelineEvent(md, {
      type: "REPORT_ISSUE_DELETED",
      label: "Customer deleted an issue report",
      at: new Date().toISOString(),
      meta: { issueId },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true });
  } catch (error: any) {
    console.error("DELETE /customer/tour-bookings/:id/report-issue/:issueId error:", error);
    return res.status(500).json({ error: "Failed to delete issue report" });
  }
}) as RequestHandler);

const GROUP_MEMBER_DOCUMENT_TYPES = ["PASSPORT", "NATIONAL_ID", "BIRTH_CERTIFICATE", "OTHER"];
const GROUP_MEMBER_RELATIONS = ["SPOUSE", "CHILD", "PARENT", "SIBLING", "RELATIVE", "FRIEND", "COLLEAGUE", "OTHER"];

function sanitizeDocumentsArray(raw: unknown, nowIso: string): Array<Record<string, unknown>> | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const MAX_DOCS = 10;
  const out: Array<Record<string, unknown>> = [];
  for (const item of raw.slice(0, MAX_DOCS)) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const typeRaw = cleanText(obj.type, 30).toUpperCase();
    const docType = GROUP_MEMBER_DOCUMENT_TYPES.includes(typeRaw) ? typeRaw : "OTHER";
    const url = cleanUrl(obj.url);
    if (!url) continue;
    out.push({
      id: cleanText(obj.id, 60) || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: docType,
      label: cleanText(obj.label, 80) || null,
      number: cleanText(obj.number, 60) || null,
      url,
      fileName: cleanText(obj.fileName, 160) || null,
      uploadedAt: cleanText(obj.uploadedAt, 40) || nowIso,
    });
  }
  return out.length > 0 ? out : null;
}

function cleanUrl(value: unknown, max = 600): string {
  const text = cleanText(value, max);
  if (!text) return "";
  try {
    const parsed = new URL(text);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

/**
 * GET /api/customer/tour-bookings/:id/group-members
 * Returns the traveller group roster linked to this package booking.
 */
router.get("/:id/group-members", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, title: true, bookingCode: true, travelerCount: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const members = safeArray(md.groupMembers);

    return res.json({
      ok: true,
      bookingId: booking.id,
      title: booking.title,
      bookingCode: booking.bookingCode,
      travelerCount: booking.travelerCount,
      members,
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/group-members error:", error);
    return res.status(500).json({ error: "Failed to load traveller group" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/group-members
 * Adds a traveller to the group roster for this package booking.
 */
router.post("/:id/group-members", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const fullName = cleanText((req.body as any)?.fullName, 120);
    const documentTypeRaw = cleanText((req.body as any)?.documentType, 30).toUpperCase();
    const documentType = GROUP_MEMBER_DOCUMENT_TYPES.includes(documentTypeRaw) ? documentTypeRaw : "";
    const documentNumber = cleanText((req.body as any)?.documentNumber, 60);
    const nationality = cleanText((req.body as any)?.nationality, 80);
    const phone = cleanText((req.body as any)?.phone, 30);
    const relationRaw = cleanText((req.body as any)?.relation, 30).toUpperCase();
    const relation = GROUP_MEMBER_RELATIONS.includes(relationRaw) ? relationRaw : "OTHER";
    const notes = cleanText((req.body as any)?.notes, 500);
    const photoUrl = cleanUrl((req.body as any)?.photoUrl);
    const documentUrl = cleanUrl((req.body as any)?.documentUrl);
    const documentFileName = cleanText((req.body as any)?.documentFileName, 160);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!fullName) return res.status(400).json({ error: "Traveller's full name is required" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true, travelerCount: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const nowIso = new Date().toISOString();
    const md = safeObject(booking.metadata);
    const prev = safeArray(md.groupMembers);
    const capacity = Number(booking.travelerCount || 0);
    if (capacity > 0 && prev.length >= capacity) {
      return res.status(409).json({ error: `This trip is set up for ${capacity} traveller(s). Update the traveller count first.` });
    }

    const documents = sanitizeDocumentsArray((req.body as any)?.documents, nowIso);

    const entry: Record<string, unknown> = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fullName,
      documentType: documentType || null,
      documentNumber: documentNumber || null,
      nationality: nationality || null,
      phone: phone || null,
      relation,
      notes: notes || null,
      photoUrl: photoUrl || null,
      documentUrl: documentUrl || null,
      documentFileName: documentUrl ? documentFileName || null : null,
      addedByUserId: userId,
      createdAt: nowIso,
    };
    if (documents) entry.documents = documents;
    md.groupMembers = [...prev, entry].slice(-50);
    appendTimelineEvent(md, {
      type: "GROUP_MEMBER_ADDED",
      label: "Traveller added to group",
      at: nowIso,
      meta: { fullName, relation },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, member: entry, members: md.groupMembers });
  } catch (error: any) {
    console.error("POST /customer/tour-bookings/:id/group-members error:", error);
    return res.status(500).json({ error: "Failed to add traveller" });
  }
}) as RequestHandler);

/**
 * PATCH /api/customer/tour-bookings/:id/group-members/:memberId
 * Updates an existing traveller's details in the group roster.
 */
router.patch("/:id/group-members/:memberId", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const memberId = cleanText(req.params.memberId, 120);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!memberId) return res.status(400).json({ error: "Invalid member id" });

    const fullName = cleanText((req.body as any)?.fullName, 120);
    const documentTypeRaw = cleanText((req.body as any)?.documentType, 30).toUpperCase();
    const documentType = GROUP_MEMBER_DOCUMENT_TYPES.includes(documentTypeRaw) ? documentTypeRaw : "";
    const documentNumber = cleanText((req.body as any)?.documentNumber, 60);
    const nationality = cleanText((req.body as any)?.nationality, 80);
    const phone = cleanText((req.body as any)?.phone, 30);
    const relationRaw = cleanText((req.body as any)?.relation, 30).toUpperCase();
    const relation = GROUP_MEMBER_RELATIONS.includes(relationRaw) ? relationRaw : "OTHER";
    const notes = cleanText((req.body as any)?.notes, 500);
    const photoUrl = cleanUrl((req.body as any)?.photoUrl);
    const documentUrl = cleanUrl((req.body as any)?.documentUrl);
    const documentFileName = cleanText((req.body as any)?.documentFileName, 160);

    if (!fullName) return res.status(400).json({ error: "Traveller's full name is required" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const prev = safeArray(md.groupMembers);
    const idx = prev.findIndex((entry: any) => String(entry?.id || "") === memberId);
    if (idx === -1) return res.status(404).json({ error: "Traveller not found in this group" });

    const nowIso = new Date().toISOString();
    const existing = safeObject(prev[idx]);
    const documents = sanitizeDocumentsArray((req.body as any)?.documents, nowIso);
    const updated: Record<string, unknown> = {
      ...existing,
      fullName,
      documentType: documentType || null,
      documentNumber: documentNumber || null,
      nationality: nationality || null,
      phone: phone || null,
      relation,
      notes: notes || null,
      photoUrl: photoUrl || existing.photoUrl || null,
      documentUrl: documentUrl || existing.documentUrl || null,
      documentFileName: (documentUrl ? documentFileName : existing.documentFileName) || null,
      updatedAt: nowIso,
    };
    if (documents) updated.documents = documents;
    const next = [...prev];
    next[idx] = updated;
    md.groupMembers = next;
    appendTimelineEvent(md, {
      type: "GROUP_MEMBER_UPDATED",
      label: "Traveller details updated",
      at: nowIso,
      meta: { fullName, relation },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, member: updated, members: md.groupMembers });
  } catch (error: any) {
    console.error("PATCH /customer/tour-bookings/:id/group-members/:memberId error:", error);
    return res.status(500).json({ error: "Failed to update traveller" });
  }
}) as RequestHandler);

/**
 * DELETE /api/customer/tour-bookings/:id/group-members/:memberId
 * Removes a traveller from the group roster for this package booking.
 */
router.delete("/:id/group-members/:memberId", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    const memberId = cleanText(req.params.memberId, 120);

    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });
    if (!memberId) return res.status(400).json({ error: "Invalid member id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, metadata: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const md = safeObject(booking.metadata);
    const prev = safeArray(md.groupMembers);
    const removed = prev.find((entry: any) => String(entry?.id || "") === memberId);
    const next = prev.filter((entry: any) => String(entry?.id || "") !== memberId);
    if (next.length === prev.length) return res.status(404).json({ error: "Traveller not found in this group" });

    md.groupMembers = next;
    appendTimelineEvent(md, {
      type: "GROUP_MEMBER_REMOVED",
      label: "Traveller removed from group",
      at: new Date().toISOString(),
      meta: { fullName: removed?.fullName || null },
    });

    await prisma.tourBooking.update({
      where: { id: booking.id },
      data: { metadata: md as any },
      select: { id: true },
    });

    return res.json({ ok: true, members: md.groupMembers });
  } catch (error: any) {
    console.error("DELETE /customer/tour-bookings/:id/group-members/:memberId error:", error);
    return res.status(500).json({ error: "Failed to remove traveller" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id/voucher
 * Returns voucher payload for this package booking.
 */
router.get("/:id/voucher", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: {
        id: true,
        bookingCode: true,
        title: true,
        destination: true,
        startDate: true,
        endDate: true,
        travelerCount: true,
        guestName: true,
        guestPhone: true,
        packageSnapshot: true,
        operatorSnapshot: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const pkg = safeObject(booking.packageSnapshot);
    const identity = buildVoucherIdentity({
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      startDate: booking.startDate,
      travelerCount: booking.travelerCount,
    });

    return res.json({
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      voucherIdentity: identity,
      title: booking.title,
      destination: booking.destination,
      startDate: booking.startDate,
      endDate: booking.endDate,
      travelerCount: booking.travelerCount,
      guestName: booking.guestName,
      guestPhone: booking.guestPhone,
      operatorSnapshot: booking.operatorSnapshot || null,
      itinerary: Array.isArray(pkg.itinerary) ? pkg.itinerary : [],
      meetingPoints: Array.isArray(pkg.meetingPoints) ? pkg.meetingPoints : (pkg.meetingPoint ? [pkg.meetingPoint] : []),
      inclusions: Array.isArray(pkg.inclusions) ? pkg.inclusions : [],
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/voucher error:", error);
    return res.status(500).json({ error: "Failed to load voucher" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id/receipt
 * Returns receipt payload for paid package bookings.
 */
router.get("/:id/receipt", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: {
        id: true,
        bookingCode: true,
        title: true,
        currency: true,
        grossAmount: true,
        paymentStatus: true,
        paymentProvider: true,
        paymentRef: true,
        paidAt: true,
        travelerCount: true,
        guestName: true,
      },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const pay = String(booking.paymentStatus || "").toUpperCase();
    if (pay !== "PAID" && pay !== "APPROVED") {
      return res.status(409).json({ error: "receipt_not_available", message: "Receipt is available after successful payment." });
    }

    return res.json({
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      title: booking.title,
      currency: booking.currency,
      amount: Number(booking.grossAmount || 0),
      paymentStatus: booking.paymentStatus,
      paymentProvider: booking.paymentProvider,
      paymentRef: booking.paymentRef,
      paidAt: booking.paidAt,
      travelerCount: booking.travelerCount,
      guestName: booking.guestName,
    });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/receipt error:", error);
    return res.status(500).json({ error: "Failed to load receipt" });
  }
}) as RequestHandler);

/**
 * GET /api/customer/tour-bookings/:id/agent-review
 * Returns the review the customer left for this booking's operator, if any,
 * plus whether the booking is eligible to be reviewed.
 */
router.get("/:id/agent-review", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, status: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    const review = await prisma.agentReview.findUnique({
      where: { tourBookingId: booking.id },
      select: {
        id: true,
        punctualityRating: true,
        customerCareRating: true,
        communicationRating: true,
        comment: true,
        createdAt: true,
      },
    });

    const eligible = String(booking.status || "").toUpperCase() === "COMPLETED";
    return res.json({ ok: true, eligible, alreadyReviewed: !!review, review });
  } catch (error: any) {
    console.error("GET /customer/tour-bookings/:id/agent-review error:", error);
    return res.status(500).json({ error: "Failed to load review" });
  }
}) as RequestHandler);

/**
 * POST /api/customer/tour-bookings/:id/agent-review
 * The booking owner rates the tour operator after a COMPLETED trip.
 * Three 1-5 dimensions (punctuality, customer care, communication) + optional comment.
 * One review per booking (enforced by the unique tourBookingId).
 */
router.post("/:id/agent-review", (async (req: AuthedRequest, res) => {
  try {
    const userId = req.user!.id;
    const idNum = Number(req.params.id);
    if (!Number.isFinite(idNum) || idNum <= 0) return res.status(400).json({ error: "Invalid booking id" });

    const body = (req.body ?? {}) as Record<string, any>;
    const punctualityRating = Number(body.punctualityRating);
    const customerCareRating = Number(body.customerCareRating);
    const communicationRating = Number(body.communicationRating);
    const comment = cleanText(body.comment, 1000) || null;

    const isValidScore = (v: number) => Number.isInteger(v) && v >= 1 && v <= 5;
    if (![punctualityRating, customerCareRating, communicationRating].every(isValidScore)) {
      return res.status(400).json({ error: "Each rating must be a whole number between 1 and 5" });
    }

    const booking = await prisma.tourBooking.findFirst({
      where: { id: idNum, customerId: userId },
      select: { id: true, status: true, operatorAgentId: true },
    });
    if (!booking) return res.status(404).json({ error: "Tour booking not found" });

    if (String(booking.status || "").toUpperCase() !== "COMPLETED") {
      return res.status(409).json({
        error: "not_completed",
        message: "You can review the operator once the trip is completed.",
      });
    }

    const existing = await prisma.agentReview.findUnique({
      where: { tourBookingId: booking.id },
      select: { id: true },
    });
    if (existing) {
      return res.status(409).json({
        error: "already_reviewed",
        message: "You have already reviewed this trip.",
      });
    }

    const review = await prisma.agentReview.create({
      data: {
        agentId: booking.operatorAgentId,
        userId,
        tourBookingId: booking.id,
        punctualityRating,
        customerCareRating,
        communicationRating,
        comment,
      },
      select: {
        id: true,
        punctualityRating: true,
        customerCareRating: true,
        communicationRating: true,
        comment: true,
        createdAt: true,
      },
    });

    return res.status(201).json({ ok: true, review });
  } catch (error: any) {
    // Unique violation race (two concurrent submissions for the same booking).
    if (error?.code === "P2002") {
      return res.status(409).json({ error: "already_reviewed", message: "You have already reviewed this trip." });
    }
    console.error("POST /customer/tour-bookings/:id/agent-review error:", error);
    return res.status(500).json({ error: "Failed to submit review" });
  }
}) as RequestHandler);

/** Normalized, append-only operational cases for changes, incidents, cancellation, rescheduling, and refunds. */
router.post("/:id/request-cancellation", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const reason = cleanText(req.body?.reason, 4000);
  const reasonCategory = cleanText(req.body?.reasonCategory, 80).toUpperCase() || "OTHER";
  if (!reason) return res.status(400).json({ error: "Cancellation reason is required" });
  const booking = await prisma.tourBooking.findFirst({
    where: { id: bookingId, customerId: req.user!.id },
    select: { id: true, bookingCode: true, title: true, operatorAgentId: true, currency: true, status: true, startDate: true, createdAt: true, grossAmount: true, packageSnapshot: true, metadata: true, paymentStatus: true, payoutStatus: true },
  });
  if (!booking) return res.status(404).json({ error: "Tour booking not found" });
  if (["CANCELED", "REFUNDED"].includes(String(booking.status).toUpperCase())) return res.status(409).json({ error: "Booking is already canceled or refunded" });
  const existing = await prisma.tourCase.findFirst({ where: { tourBookingId: booking.id, type: "CANCELLATION", status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE"] } } });
  if (existing) return res.status(409).json({ error: "An active cancellation request already exists", caseId: existing.id });
  const md = safeObject(booking.metadata);
  const pickupValidated = Boolean(safeObject(md.pickupValidation).validated || safeObject(md.pickupValidationOperator).validated || safeObject(md.pickupValidationCustomer).validated);
  const bookingStatusUpper = String(booking.status).toUpperCase();
  const paymentConfirmed = String(booking.paymentStatus || "").toUpperCase() === "PAID";
  const tourStarted = pickupValidated || ["IN_PROGRESS", "OPERATOR_COMPLETED", "COMPLETED"].includes(bookingStatusUpper);
  // Unpaid and not started: nothing is at stake, so the booking cancels
  // immediately with an auto-resolved case for the record. No NoLSAF review,
  // no refund, and the operator is informed rather than made a participant.
  if (!paymentConfirmed && !tourStarted) {
    let autoCase;
    try {
      autoCase = await prisma.$transaction(async (tx) => {
        const duplicate = await tx.tourCase.findFirst({
          where: { tourBookingId: booking.id, type: "CANCELLATION", status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE"] } },
          select: { id: true },
        });
        if (duplicate) throw Object.assign(new Error("ACTIVE_CASE_EXISTS"), { code: "ACTIVE_CASE_EXISTS", caseId: duplicate.id });
        const item = await tx.tourCase.create({ data: {
          tourBookingId: booking.id,
          type: "CANCELLATION",
          status: "RESOLVED",
          severity: "LOW",
          title: `Tour cancellation: ${reasonCategory}`,
          description: reason,
          requestedByUserId: req.user!.id,
          resolution: "Cancelled automatically: the booking was never paid, so no refund is due and no review is required.",
          resolutionAmount: 0,
          closedAt: new Date(),
        } });
        await tx.tourCaseEvent.create({ data: {
          tourCaseId: item.id, actorUserId: req.user!.id, type: "AUTO_CANCELLED_UNPAID",
          message: "The traveller cancelled before payment. The booking was cancelled immediately with no refund due.",
          data: { reasonCategory, paymentStatus: booking.paymentStatus, bookingStatus: booking.status },
        } });
        await tx.tourBooking.update({ where: { id: booking.id }, data: { status: "CANCELED", canceledAt: new Date() } });
        return item;
      }, { isolationLevel: "Serializable" });
    } catch (error: any) {
      if (error?.code === "ACTIVE_CASE_EXISTS") return res.status(409).json({ error: "An active cancellation request already exists", caseId: error.caseId });
      if (error?.code === "P2034") return res.status(409).json({ error: "Another cancellation request is being processed for this booking. Please retry." });
      throw error;
    }
    const unpaidNotifications: Promise<unknown>[] = [
      notifyAdmins("tour_cancellation_auto_cancelled_unpaid", { caseId: autoCase.id, bookingCode: booking.bookingCode, tourBookingId: booking.id }),
    ];
    if (booking.operatorAgentId) unpaidNotifications.push(notifyTourOperatorCase({
      kind: "UNPAID_AUTO_CANCELLED",
      operatorAgentId: booking.operatorAgentId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      caseId: autoCase.id,
      tourTitle: booking.title,
      startDate: booking.startDate,
      reason,
      currency: booking.currency,
    }));
    await Promise.all(unpaidNotifications);
    return res.status(201).json({
      ok: true,
      case: autoCase,
      autoCancelled: true,
      notice: "Your booking was never paid, so it has been cancelled immediately. No refund is due and no further review is needed.",
    });
  }
  const policySnapshot = safeObject(md.tourCancellationPolicy);
  const calculatedDecision = evaluateTourCancellation({
    bookedAt: booking.createdAt,
    startDate: booking.startDate,
    requestedAt: new Date(),
    amountPaid: String(booking.paymentStatus).toUpperCase() === "PAID" ? Number(booking.grossAmount) : 0,
    status: booking.status,
    pickupValidated,
    nonRefundable: packageIsNonRefundable(booking.packageSnapshot),
  });
  const decision = policySnapshot.version ? calculatedDecision : {
    ...calculatedDecision,
    eligibilityCode: "MANUAL_REVIEW" as const,
    eligible: false,
    refundPercent: 0,
    estimatedRefundAmount: 0,
    reason: "This booking predates the stored tour cancellation policy version. NoLSAF will review it under the terms accepted when the booking was made.",
  };
  const requestedAt = new Date();
  const hoursUntilDeparture = (new Date(booking.startDate).getTime() - requestedAt.getTime()) / 3_600_000;
  const operatorParticipationRequired = paymentConfirmed;
  const payoutReleasedAtRequest = ["DISBURSED", "PAID"].includes(String(booking.payoutStatus || "").toUpperCase());
  const operatorResponseWindowHours = operatorParticipationRequired ? (hoursUntilDeparture <= 72 ? 1 : 6) : null;
  const operatorResponseDueAt = operatorResponseWindowHours == null ? null : new Date(requestedAt.getTime() + operatorResponseWindowHours * 3_600_000);
  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      const duplicate = await tx.tourCase.findFirst({
        where: { tourBookingId: booking.id, type: "CANCELLATION", status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE"] } },
        select: { id: true },
      });
      if (duplicate) throw Object.assign(new Error("ACTIVE_CASE_EXISTS"), { code: "ACTIVE_CASE_EXISTS", caseId: duplicate.id });
      const item = await tx.tourCase.create({ data: {
        tourBookingId: booking.id,
        type: "CANCELLATION",
        status: decision.eligible ? "ELIGIBLE" : "UNDER_REVIEW",
        severity: "MEDIUM",
        title: `Tour cancellation: ${reasonCategory}`,
        description: reason,
        requestedByUserId: req.user!.id,
        resolutionAmount: decision.estimatedRefundAmount,
      } });
      await tx.tourCaseEvent.create({ data: {
        tourCaseId: item.id, actorUserId: req.user!.id, type: "ELIGIBILITY_CALCULATED", message: decision.reason,
        data: {
          ...decision,
          reasonCategory,
          amountPaid: Number(booking.grossAmount),
          deductionsPendingOperatorEvidence: decision.refundPercent > 0,
          operatorParticipationRequired,
          operatorResponseWindowHours,
          operatorResponseDueAt: operatorResponseDueAt?.toISOString() || null,
          payoutReleasedAtRequest,
        },
      } });
      return item;
    }, { isolationLevel: "Serializable" });
  } catch (error: any) {
    if (error?.code === "ACTIVE_CASE_EXISTS") return res.status(409).json({ error: "An active cancellation request already exists", caseId: error.caseId });
    if (error?.code === "P2034") return res.status(409).json({ error: "Another cancellation request is being processed for this booking. Please retry." });
    throw error;
  }
  const cancellationNotifications: Promise<unknown>[] = [
    notifyAdmins("tour_cancellation_submitted", { caseId: created.id, bookingCode: booking.bookingCode, tourBookingId: booking.id }),
  ];
  if (operatorParticipationRequired) cancellationNotifications.push(notifyTourOperatorCase({
      kind: "SUBMITTED",
      operatorAgentId: booking.operatorAgentId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      caseId: created.id,
      tourTitle: booking.title,
      startDate: booking.startDate,
      reason,
      currency: booking.currency,
      responseDueAt: operatorResponseDueAt,
    }));
  await Promise.all(cancellationNotifications);
  return res.status(201).json({
    ok: true,
    case: created,
    eligibility: decision,
    notice: decision.refundPercent > 0
      ? "This is a provisional amount. Only disclosed, documented non-recoverable tour costs may reduce the final refund, and approved refunds are paid less the applicable payment-channel and administrative charges. Cancellations within the 24-hour cooling-off window are exempt from all charges. The booking remains active until NoLSAF approves the cancellation."
      : "No automatic refund is available. NoLSAF will review any exceptional-circumstance evidence before changing the booking.",
  });
}) as RequestHandler);

router.get("/:id/cases", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const booking = await prisma.tourBooking.findFirst({ where: { id: bookingId, customerId: req.user!.id }, select: { id: true, bookingCode: true, title: true, operatorAgentId: true, startDate: true, currency: true } });
  if (!booking) return res.status(404).json({ error: "Tour booking not found" });
  const cases = await prisma.tourCase.findMany({
    where: { tourBookingId: booking.id },
    include: { events: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return res.json({ ok: true, cases });
}) as RequestHandler);

router.post("/:id/cases/:caseId/evidence", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const caseId = Number(req.params.caseId);
  const documents = Array.isArray(req.body?.documents)
    ? req.body.documents
      .map((entry: any) => ({
        url: cleanText(entry?.url, 1500),
        fileName: cleanText(entry?.fileName, 240),
        type: cleanText(entry?.type, 80),
        label: cleanText(entry?.label, 180),
        uploadedAt: cleanText(entry?.uploadedAt, 80),
      }))
      .filter((entry: any) => {
        // Only NoLSAF-hosted uploads are accepted as evidence; arbitrary links are dropped.
        try {
          const url = new URL(entry.url);
          return url.protocol === "https:" && url.hostname === "res.cloudinary.com";
        } catch { return false; }
      })
    : [];
  if (!Number.isFinite(bookingId) || !Number.isFinite(caseId)) return res.status(400).json({ error: "Invalid tour cancellation evidence request" });
  if (documents.length === 0) return res.status(400).json({ error: "Upload at least one evidence file through the NoLSAF document uploader" });
  if (documents.length > 10) return res.status(400).json({ error: "Submit up to 10 evidence files at a time" });

  const booking = await prisma.tourBooking.findFirst({ where: { id: bookingId, customerId: req.user!.id }, select: { id: true } });
  if (!booking) return res.status(404).json({ error: "Tour booking not found" });
  const item = await prisma.tourCase.findFirst({ where: { id: caseId, tourBookingId: booking.id, type: "CANCELLATION" } });
  if (!item) return res.status(404).json({ error: "Tour cancellation case not found" });
  if (["WITHDRAWN", "CLOSED", "RESOLVED", "REJECTED"].includes(String(item.status).toUpperCase())) return res.status(409).json({ error: "This cancellation case is closed" });

  const event = await prisma.tourCaseEvent.create({
    data: {
      tourCaseId: item.id,
      actorUserId: req.user!.id,
      type: "TRAVELER_EVIDENCE_SUBMITTED",
      message: "Traveller submitted requested cancellation evidence through the booking workspace.",
      data: { documents },
    },
  });
  await Promise.all([
    notifyTourOperatorCase({
      kind: "TRAVELER_EVIDENCE_SUBMITTED",
      operatorAgentId: booking.operatorAgentId,
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      caseId: item.id,
      tourTitle: booking.title,
      startDate: booking.startDate,
      currency: booking.currency,
    }),
    notifyAdmins("tour_cancellation_evidence_submitted", { actor: "The traveller", caseId: item.id, bookingCode: booking.bookingCode, tourBookingId: booking.id }),
  ]);
  return res.status(201).json({ ok: true, event, submittedFiles: documents.length });
}) as RequestHandler);

router.post("/:id/cases", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const type = String(req.body?.type || "").trim().toUpperCase();
  const allowedTypes = ["CHANGE", "ISSUE", "CANCELLATION", "RESCHEDULE", "REFUND"];
  const title = cleanText(req.body?.title, 180);
  const description = cleanText(req.body?.description || req.body?.message, 4000);
  const severityInput = String(req.body?.severity || "MEDIUM").toUpperCase();
  const severity = ["LOW", "MEDIUM", "HIGH", "URGENT"].includes(severityInput) ? severityInput : "MEDIUM";
  if (!allowedTypes.includes(type) || !title || !description) return res.status(400).json({ error: "Invalid case type, title, or description" });
  const booking = await prisma.tourBooking.findFirst({ where: { id: bookingId, customerId: req.user!.id }, select: { id: true, status: true } });
  if (!booking) return res.status(404).json({ error: "Tour booking not found" });
  if (["REFUNDED"].includes(String(booking.status).toUpperCase())) return res.status(409).json({ error: "Booking is already refunded" });
  const created = await prisma.$transaction(async (tx) => {
    const tourCase = await tx.tourCase.create({ data: {
      tourBookingId: booking.id, type, title, description, severity, requestedByUserId: req.user!.id,
      requestedStartDate: req.body?.requestedStartDate ? new Date(req.body.requestedStartDate) : null,
      requestedEndDate: req.body?.requestedEndDate ? new Date(req.body.requestedEndDate) : null,
    } });
    await tx.tourCaseEvent.create({ data: { tourCaseId: tourCase.id, actorUserId: req.user!.id, type: "CREATED", message: description } });
    return tourCase;
  });
  return res.status(201).json({ ok: true, case: created });
}) as RequestHandler);

router.post("/:id/cases/:caseId/withdraw", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const caseId = Number(req.params.caseId);
  const existing = await prisma.tourCase.findFirst({ where: { id: caseId, tourBookingId: bookingId, requestedByUserId: req.user!.id } });
  if (!existing) return res.status(404).json({ error: "Case not found" });
  if (["RESOLVED", "CLOSED", "WITHDRAWN"].includes(existing.status)) return res.status(409).json({ error: "Case is already closed" });
  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.tourCase.update({ where: { id: caseId }, data: { status: "WITHDRAWN", withdrawnAt: new Date(), closedAt: new Date() } });
    await tx.tourCaseEvent.create({ data: { tourCaseId: caseId, actorUserId: req.user!.id, type: "WITHDRAWN", message: cleanText(req.body?.reason, 1000) } });
    return item;
  });
  return res.json({ ok: true, case: updated });
}) as RequestHandler);

router.post("/:id/confirm-completion", (async (req: AuthedRequest, res) => {
  const bookingId = Number(req.params.id);
  const booking = await prisma.tourBooking.findFirst({
    where: { id: bookingId, customerId: req.user!.id },
    select: { id: true, status: true, cases: { where: { status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW"] } }, select: { id: true } } },
  });
  if (!booking) return res.status(404).json({ error: "Tour booking not found" });
  if (booking.status !== "OPERATOR_COMPLETED") return res.status(409).json({ error: "Operator has not completed the tour" });
  if (booking.cases.length) return res.status(409).json({ error: "Open cases must be resolved before completion" });
  const now = new Date();
  const updated = await prisma.tourBooking.update({ where: { id: booking.id }, data: { status: "COMPLETED", customerConfirmedAt: now, completedAt: now } });
  return res.json({ ok: true, booking: updated });
}) as RequestHandler);

export default router;
