/**
 * Agency Desk, phase 2: client book and partner-coordinated group stays.
 *
 * Roles, so no single person controls a deal:
 * - the partner prepares the request, invites owners, shortlists bids;
 * - the client confirms the request from their own phone and picks the bid;
 * - owners set their own prices through the normal owner bidding flow;
 * - NoLSAF collects the full amount (paymentMode FULL) and pays the owner
 *   after check-in; large groups need an admin to release the shortlist.
 */
import { createHash, randomBytes } from "node:crypto";
import { CreateGroupBookingInput } from "../schemas/groupBookingSchemas.js";
import { sanitizeText } from "./sanitize.js";
import { commissionSourceKey } from "./salesPartner.js";
import { phoneKey, loadPartnerIdentity, partnerOwnsPropertyReason } from "./salesSelfDealing.js";
import { calculateSalesCommission, roundSalesMoney, POST_STAY_BUFFER_DAYS, type CommissionAccrualResult } from "./salesCommission.js";
import { AGENCY_SETTLE_MS, agencyGateFailure, loadAgencyGateInput } from "./salesAgency.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Agency groups pay the whole stay at once, often after collecting from many
 * members, so they get a longer window than the 24 hours a deposit gets.
 */
export const FULL_PAYMENT_WINDOW_MS = 72 * 60 * 60 * 1000;
export const DEPOSIT_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type AgencyGroupEvent = "offer" | "chosen" | "paid" | "expired";

/**
 * Tell the sales partner behind an agency group what just happened. A no-op for
 * ordinary groups. Never throws: a missed notice must not break the caller.
 */
export async function notifyAgencyPartnerAboutGroup(
  db: any,
  groupBookingId: number,
  event: AgencyGroupEvent,
  extra: { dueAt?: Date | null } = {},
): Promise<void> {
  try {
    const request = await db.salesAgencyGroupRequest.findUnique({
      where: { groupBookingId },
      select: { reference: true, clientName: true, salesPartner: { select: { userId: true } } },
    });
    const userId = request?.salesPartner?.userId;
    if (!request || !userId) return;
    const { notifyUser } = await import("./notifications.js");
    const dueAt = extra.dueAt
      ? `${new Date(extra.dueAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT`
      : null;
    await notifyUser(userId, `sales_partner_agency_group_${event}`, {
      reference: request.reference,
      clientName: request.clientName,
      ...(dueAt ? { dueAt } : {}),
      actionPath: `/sales/agency/groups/${request.reference}`,
    });
  } catch {
    // Best effort.
  }
}

// ---------------------------------------------------------------------------
// Client book
// ---------------------------------------------------------------------------

export const CLIENT_TYPES = ["ORGANISER", "SCHOOL", "CHURCH", "NGO", "COMPANY", "BANK", "GOVERNMENT", "EVENT", "OTHER"] as const;
export const CLIENT_ACTIVITY_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL", "FOLLOW_UP"] as const;
/** Open decision 3 in the plan: 12 months, renewed by real activity. */
export const CLIENT_PROTECTION_DAYS = 365;
/** Cap on clients per partner, so a leaked account cannot harvest the market. */
export const CLIENT_BOOK_LIMIT = 500;

export function normalizeName(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 200);
}

export function normalizeEmail(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 190) : null;
}

export function newClientReference(): string {
  return `sc_${randomBytes(10).toString("hex")}`;
}

export function protectionUntil(now: Date = new Date()): Date {
  return new Date(now.getTime() + CLIENT_PROTECTION_DAYS * DAY_MS);
}

/**
 * Another partner's protected client with the same phone, email or name.
 * Returns only whether one exists: callers must never reveal whose it is.
 */
export async function findProtectedConflict(
  db: any,
  input: { salesPartnerId: number; phoneKey: string | null; emailNormalized: string | null; nameNormalized: string },
  now: Date = new Date(),
): Promise<{ hard: boolean; soft: boolean }> {
  const others = { salesPartnerId: { not: input.salesPartnerId }, status: "ACTIVE", protectionExpiresAt: { gt: now } };
  const hardOr = [
    ...(input.phoneKey ? [{ phoneKey: input.phoneKey }] : []),
    ...(input.emailNormalized ? [{ emailNormalized: input.emailNormalized }] : []),
  ];
  const hard = hardOr.length ? await db.salesClientAccount.count({ where: { ...others, OR: hardOr } }) : 0;
  const soft = input.nameNormalized.length >= 4 ? await db.salesClientAccount.count({ where: { ...others, nameNormalized: input.nameNormalized } }) : 0;
  return { hard: hard > 0, soft: soft > 0 };
}

// ---------------------------------------------------------------------------
// Group requests
// ---------------------------------------------------------------------------

export const GROUP_REQUEST_LINK_HOURS = 72;
export const GROUP_BIDDING_DAYS_MIN = 1;
export const GROUP_BIDDING_DAYS_MAX = 7;
export const GROUP_SHORTLIST_MAX = 3;
export const GROUP_INVITE_MAX = 10;
/** Groups at or above either threshold need an admin to release the shortlist. */
export const GROUP_REVIEW_ROOMS = 30;
export function groupReviewAmount(): number {
  const n = Number(process.env.SALES_AGENCY_GROUP_REVIEW_AMOUNT || 10_000_000);
  return Number.isFinite(n) && n > 0 ? n : 10_000_000;
}

export function newGroupRequestReference(): string {
  return `gr_${randomBytes(10).toString("hex")}`;
}

export function newGroupRequestToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashGroupRequestToken(token) };
}

export function hashGroupRequestToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function isWellFormedGroupToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** Validate the partner's group payload with the same rules as the customer form. */
export function parseGroupPayload(input: unknown) {
  return CreateGroupBookingInput.safeParse(input);
}

function parseRouteDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * Turn a confirmed request into a group booking owned by the client, paid in
 * full through NoLSAF, and open to all owners for bidding. Runs inside the
 * caller's transaction together with the request update.
 */
export async function createAgencyGroupBooking(tx: any, input: { request: any; clientUserId: number; partnerUserId: number; now?: Date }) {
  const now = input.now ?? new Date();
  const parsed = CreateGroupBookingInput.parse(input.request.payload);
  const deadline = new Date(now.getTime() + Math.min(GROUP_BIDDING_DAYS_MAX, Math.max(GROUP_BIDDING_DAYS_MIN, Number(input.request.biddingDays) || 3)) * DAY_MS);
  const booking = await tx.groupBooking.create({
    data: {
      userId: input.clientUserId,
      groupType: parsed.groupType,
      fromCountry: parsed.fromCountry || null,
      fromRegion: parsed.fromRegion || null,
      fromDistrict: parsed.fromDistrict || null,
      fromWard: parsed.fromWard || null,
      fromLocation: parsed.fromLocation || null,
      toRegion: parsed.toRegion,
      toDistrict: parsed.toDistrict || null,
      toWard: parsed.toWard || null,
      toLocation: parsed.toLocation || null,
      accommodationType: parsed.accommodationType,
      minHotelStarLabel: parsed.accommodationType === "hotel" ? (parsed.minHotelStarLabel ?? null) : null,
      headcount: parsed.headcount,
      maleCount: parsed.maleCount ?? null,
      femaleCount: parsed.femaleCount ?? null,
      otherCount: parsed.otherCount ?? null,
      roomSize: parsed.roomSize,
      roomsNeeded: parsed.roomsNeeded,
      needsPrivateRoom: parsed.needsPrivateRoom,
      privateRoomCount: parsed.privateRoomCount,
      checkIn: parseRouteDate(parsed.checkin),
      checkOut: parseRouteDate(parsed.checkout),
      useDates: parsed.useDates ?? true,
      arrPickup: parsed.arrangements.pickup,
      arrTransport: parsed.arrangements.transport,
      arrMeals: parsed.arrangements.meals,
      arrGuide: parsed.arrangements.guide,
      arrEquipment: parsed.arrangements.equipment,
      pickupLocation: parsed.arrangements.pickupLocation || null,
      pickupTime: parsed.arrangements.pickupTime || null,
      arrangementNotes: parsed.arrangements.notes || null,
      roster: parsed.roster as any,
      status: "PENDING",
      currency: "TZS",
      paymentMode: "FULL",
      isOpenForClaims: true,
      openedForClaimsAt: now,
    },
  });
  if (parsed.roster?.length) {
    await tx.groupBookingPassenger.createMany({
      data: parsed.roster.map((p: any, index: number) => ({
        groupBookingId: booking.id,
        firstName: p.firstname,
        lastName: p.lastname,
        phone: p.phone || null,
        age: p.age ? parseInt(p.age, 10) : null,
        gender: p.gender || null,
        nationality: p.nationality || null,
        sequenceNumber: index + 1,
      })),
      skipDuplicates: true,
    });
  }
  // The owner bidding flow reads its deadline from this audit row.
  await tx.groupBookingAudit.create({
    data: {
      groupBookingId: booking.id,
      adminId: input.partnerUserId,
      action: "OPENED_FOR_CLAIMS",
      description: "Agency Desk group confirmed by the client and opened to owners for bidding.",
      metadata: { deadline: deadline.toISOString(), source: "AGENCY_DESK", requestReference: input.request.reference },
    },
  });
  await tx.groupBookingMessage.create({
    data: {
      groupBookingId: booking.id,
      senderId: null,
      senderRole: "SYSTEM",
      senderName: "NoLSAF",
      messageType: "APPLICATION_RECEIVED",
      body: sanitizeText(
        "Thanks for confirming your group stay request. Verified property owners in your destination can now send offers. Your NoLSAF sales partner will share the best options with you, and you choose. You pay NoLSAF directly on the NoLSAF payment page, never to anyone else.",
      ),
      isInternal: false,
    },
  });
  return { booking, deadline };
}

/** Whether a shortlist on this group must wait for an admin. */
export function shortlistNeedsReview(input: { roomsNeeded: number; customerTotals: number[] }): boolean {
  if (Number(input.roomsNeeded) >= GROUP_REVIEW_ROOMS) return true;
  return input.customerTotals.some((t) => Number(t) >= groupReviewAmount());
}

/** Owner price plus NoLSAF commission, as the customer sees it (mirrors customer.groupStays). */
export function customerTotalFor(ownerTotal: number, commissionPercent: number): number {
  return roundSalesMoney(Number(ownerTotal || 0) * (1 + Math.max(0, Number(commissionPercent) || 0) / 100));
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

export const GROUP_CANCELLED_STATUSES = ["CANCELED", "CANCELLED"];

/**
 * AGENCY_GROUP commission on a fully prepaid agency group. Idempotent on
 * AGENCY_GROUP:<id>. Basis is NoLSAF's own commission on the group
 * (totalAmount - ownerAmount), never the group value.
 */
export async function accrueAgencyGroupCommission(tx: any, groupBookingId: number, now: Date = new Date()): Promise<CommissionAccrualResult> {
  const sourceKey = commissionSourceKey("AGENCY_GROUP", groupBookingId);
  const replay = await tx.salesCommission.findUnique({ where: { sourceKey } });
  if (replay) return { created: false, commission: replay };

  const request = await tx.salesAgencyGroupRequest.findUnique({ where: { groupBookingId } });
  if (!request || request.status !== "CONFIRMED") return { created: false, skippedReason: "NO_AGENCY_REQUEST" };

  const gb = await tx.groupBooking.findUnique({
    where: { id: groupBookingId },
    select: {
      id: true, status: true, paymentMode: true, depositPaid: true, depositPaidAt: true, totalAmount: true, ownerAmount: true,
      currency: true, checkOut: true, confirmedPropertyId: true, userId: true, payerPhone: true,
      user: { select: { email: true, phone: true } },
    },
  });
  if (!gb || gb.paymentMode !== "FULL" || !gb.depositPaid || !gb.depositPaidAt) return { created: false, skippedReason: "SOURCE_NOT_PAID" };
  if (now.getTime() - new Date(gb.depositPaidAt).getTime() < AGENCY_SETTLE_MS) return { created: false, skippedReason: "SETTLING" };

  const paidAt: Date = gb.depositPaidAt;
  const gate = await loadAgencyGateInput(tx, request.salesPartnerId, paidAt);
  const failure = agencyGateFailure({ ...gate, enabled: true, partner: gate.partner ? { ...gate.partner, payoutHoldAt: null } : null }, { at: paidAt });
  const capability = gate.capabilityRow;
  if (failure || !gate.contract?.id || !capability) return { created: false, skippedReason: `AGENCY_NOT_LIVE_AT_PAYMENT:${failure ?? "NO_CONTRACT"}` };

  const grossCommission = roundSalesMoney(Math.max(0, Number(gb.totalAmount || 0) - Number(gb.ownerAmount || 0)));
  if (grossCommission <= 0) return { created: false, skippedReason: "COMMISSION_BASIS_MISSING" };
  const calculation = calculateSalesCommission({ grossAmount: grossCommission, processingFeeAmount: 0, commissionRate: Number(capability.stayRate) });

  const identity = await loadPartnerIdentity(tx, request.salesPartnerId);
  const clientIsPartner =
    identity &&
    (gb.userId === identity.userId ||
      [gb.user?.phone, gb.payerPhone].some((p) => {
        const k = phoneKey(p);
        return k ? identity.phones.has(k) : false;
      }));
  const blockedReason =
    (clientIsPartner ? "The client on this group is the sales partner." : null) ??
    (identity && gb.confirmedPropertyId ? await partnerOwnsPropertyReason(tx, identity, gb.confirmedPropertyId) : null) ??
    (GROUP_CANCELLED_STATUSES.includes(String(gb.status).toUpperCase()) ? "The group stay was cancelled." : null);

  const checkOut = gb.checkOut ? new Date(gb.checkOut).getTime() : NaN;
  const eligibleAt = new Date(Math.max(paidAt.getTime() + 30 * DAY_MS, Number.isFinite(checkOut) ? checkOut + POST_STAY_BUFFER_DAYS * DAY_MS : 0));

  let created: any;
  let wasCreated = true;
  try {
    created = await tx.salesCommission.create({
      data: {
        salesPartnerId: request.salesPartnerId,
        propertyId: gb.confirmedPropertyId ?? null,
        attributionId: null,
        contractId: gate.contract.id,
        type: "AGENCY_GROUP",
        status: blockedReason ? "REVERSED" : "VALIDATING",
        ...(blockedReason ? { reversedAt: now, reversalReason: blockedReason } : {}),
        sourceKey,
        ...calculation,
        currency: gb.currency || "TZS",
        description: `Agency Desk group stay, request ${request.reference}`,
        earnedAt: paidAt,
        eligibleAt,
      },
    });
  } catch (error: any) {
    if (error?.code !== "P2002") throw error;
    created = await tx.salesCommission.findUnique({ where: { sourceKey } });
    wasCreated = false;
  }
  if (wasCreated) {
    await tx.auditLog.create({
      data: {
        actorId: null,
        actorRole: "SYSTEM",
        action: "SALES_COMMISSION_ACCRUE",
        entity: "SALES_COMMISSION",
        entityId: created.id,
        beforeJson: null,
        afterJson: { sourceKey, type: "AGENCY_GROUP", salesPartnerId: request.salesPartnerId, groupBookingId, calculation, ...(blockedReason ? { blockedReason } : {}) },
      },
    });
  }
  return { created: wasCreated, commission: created };
}

/** Group id inside an AGENCY_GROUP source key, or null. */
export function groupIdFromSourceKey(sourceKey: string): number | null {
  const m = /^AGENCY_GROUP:(\d+)$/.exec(String(sourceKey || ""));
  return m ? Number(m[1]) : null;
}
