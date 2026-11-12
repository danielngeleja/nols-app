/**
 * Agency Desk tour referrals.
 *
 * A partner sends a client to an operator's listed tour package with a signed
 * link. The client books and pays NoLSAF through the normal tour checkout; the
 * operator delivers and is paid exactly as today. The partner earns a share of
 * NoLSAF's own commission on that tour (AGENCY_TOUR) once the tour is
 * COMPLETED (after its dispute window), reversed if it is later refunded.
 *
 * Rules: listed packages only (the partner never sets a price), nothing when
 * the partner is the operator or the traveller, one credit per tour booking,
 * and the operator is never told which partner sent the client.
 */
import { commissionSourceKey } from "./salesPartner.js";
import { loadPartnerIdentity, payoutAccountKey, phoneKey, type PartnerIdentity } from "./salesSelfDealing.js";
import { calculateSalesCommission, exclusiveTaxAmount, roundSalesMoney, POST_STAY_BUFFER_DAYS, type CommissionAccrualResult } from "./salesCommission.js";
import { AGENCY_SETTLE_MS, agencyGateFailure, hashAgencyToken, isAgencyDeskEnabled, isWellFormedAgencyToken, loadAgencyGateInput } from "./salesAgency.js";

const DAY_MS = 24 * 60 * 60 * 1000;
export const TOUR_REFUNDED_STATUSES = ["CANCELED", "CANCELLED", "REFUNDED"];

// ---------------------------------------------------------------------------
// Catalogue (mirrors the approval rules in routes/public.tourBookings.ts)
// ---------------------------------------------------------------------------

const asArray = <T = unknown>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The operator's approved profile, or null when it is not approved. */
export function approvedOperatorProfile(value: unknown): Record<string, any> | null {
  if (!value || typeof value !== "object") return null;
  const profile = value as Record<string, any>;
  const status = String(profile.reviewStatus || profile.review?.status || "").toUpperCase();
  if (status !== "APPROVED") return null;
  return profile.approvedSnapshot && typeof profile.approvedSnapshot === "object" ? profile.approvedSnapshot : profile;
}

export function bookablePackages(profile: Record<string, any> | null): Array<{ id: string; pkg: any }> {
  if (!profile) return [];
  return asArray<any>(profile.packageItems)
    .map((pkg, index) => ({ id: String(pkg?.id ?? index), pkg }))
    .filter(({ pkg }) => ["APPROVED", "LIVE", "PUBLISHED", "ACTIVE"].includes(String(pkg?.status || "APPROVED").toUpperCase()))
    .filter(({ pkg }) => num(pkg?.pricePerPerson || pkg?.price) > 0);
}

/** "operatorPublicKey:packageId": how a partner picks a tour without ids in the UI. */
export function tourKey(operatorPublicKey: string, packageId: string): string {
  return `${operatorPublicKey}:${packageId}`;
}

export function parseTourKey(value: unknown): { operatorPublicKey: string; packageId: string } | null {
  const m = /^([a-z0-9]{20,40}):([A-Za-z0-9_-]{1,120})$/i.exec(String(value || "").trim());
  return m ? { operatorPublicKey: m[1].toLowerCase(), packageId: m[2] } : null;
}

export function tourLinkUrl(webOrigin: string, token: string, operatorPublicKey: string, packageId: string, travelers?: number | null): string {
  const params = new URLSearchParams({ agentKey: operatorPublicKey, packageId });
  if (travelers && travelers > 0) params.set("travelers", String(travelers));
  params.set("ag", token);
  return `${webOrigin}/public/booking/tour-confirm?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Self-dealing
// ---------------------------------------------------------------------------

/** Why this partner may not earn on this operator's tour, or null. */
export async function partnerIsOperatorReason(db: any, identity: PartnerIdentity, operatorAgentId: number): Promise<string | null> {
  const agent = await db.agent.findUnique({ where: { id: operatorAgentId }, select: { userId: true, user: { select: { email: true, phone: true } } } });
  if (!agent) return null;
  if (agent.userId === identity.userId) return "The sales partner is the tour operator (same account).";
  const email = String(agent.user?.email || "").trim().toLowerCase();
  if (email && identity.emails.has(email)) return "The sales partner is the tour operator (same email).";
  const p = phoneKey(agent.user?.phone);
  if (p && identity.phones.has(p)) return "The sales partner is the tour operator (same phone).";
  if (identity.payoutKeys.size) {
    const accounts = await db.payoutAccount.findMany({ where: { userId: agent.userId, isActive: true }, select: { accountNumber: true } });
    if (accounts.some((a: any) => {
      const k = payoutAccountKey(a.accountNumber);
      return k ? identity.payoutKeys.has(k) : false;
    })) return "The sales partner is paid into the same account as the tour operator.";
  }
  return null;
}

/** Why this tour booking is the partner's own trip, or null. */
export function partnerIsTravellerReason(identity: PartnerIdentity, tour: { customerId?: number | null; guestPhone?: string | null; guestEmail?: string | null; payerPhone?: string | null }): string | null {
  if (tour.customerId != null && tour.customerId === identity.userId) return "The traveller on this tour is the sales partner (same account).";
  const email = String(tour.guestEmail || "").trim().toLowerCase();
  if (email && identity.emails.has(email)) return "The traveller on this tour is the sales partner (same email).";
  for (const ph of [tour.guestPhone, tour.payerPhone]) {
    const k = phoneKey(ph);
    if (k && identity.phones.has(k)) return "The traveller on this tour is the sales partner (same phone).";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------

export type TourAttributionOutcome = { recorded: false; reason: string } | { recorded: true; status: "ACTIVE" | "BLOCKED"; blockedReason?: string };

/**
 * Credit a just-created tour booking to the partner behind an agency link.
 * Same guarantees as stays: server-side only, never affects the booking, one
 * credit per tour booking, a fresh booking only, and self-dealing recorded
 * BLOCKED. A property-pinned link never credits a tour; a tour-pinned link
 * only credits its own operator and package.
 */
export async function recordAgencyTourAttribution(db: any, input: { tourBookingId: number; token: unknown; now?: Date }): Promise<TourAttributionOutcome> {
  const now = input.now ?? new Date();
  if (!isAgencyDeskEnabled()) return { recorded: false, reason: "DISABLED" };
  if (!isWellFormedAgencyToken(input.token)) return { recorded: false, reason: "MALFORMED" };
  const link = await db.salesAgencyLink.findUnique({ where: { tokenHash: hashAgencyToken(input.token) } });
  if (!link) return { recorded: false, reason: "UNKNOWN_LINK" };
  if (link.revokedAt) return { recorded: false, reason: "LINK_REVOKED" };
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return { recorded: false, reason: "LINK_EXPIRED" };
  if (link.maxUses != null && link.useCount >= link.maxUses) return { recorded: false, reason: "LINK_USED_UP" };
  if (link.propertyId != null) return { recorded: false, reason: "PROPERTY_LINK" };

  const gate = await loadAgencyGateInput(db, link.salesPartnerId, now);
  const failure = agencyGateFailure(gate, { at: now });
  if (failure) return { recorded: false, reason: failure };

  const tour = await db.tourBooking.findUnique({
    where: { id: input.tourBookingId },
    select: { id: true, operatorAgentId: true, packageId: true, customerId: true, guestPhone: true, guestEmail: true, payerPhone: true, createdAt: true },
  });
  if (!tour) return { recorded: false, reason: "NO_BOOKING" };
  if (now.getTime() - new Date(tour.createdAt).getTime() > 10 * 60 * 1000) return { recorded: false, reason: "BOOKING_TOO_OLD" };
  if (link.operatorAgentId != null && (link.operatorAgentId !== tour.operatorAgentId || String(link.tourPackageId) !== String(tour.packageId))) {
    return { recorded: false, reason: "WRONG_TOUR" };
  }

  const identity = await loadPartnerIdentity(db, link.salesPartnerId);
  const blockedReason =
    (identity ? partnerIsTravellerReason(identity, tour) : null) ??
    (identity ? await partnerIsOperatorReason(db, identity, tour.operatorAgentId) : null);

  try {
    await db.$transaction(async (tx: any) => {
      if (!blockedReason) {
        const bumped = await tx.salesAgencyLink.updateMany({
          where: { id: link.id, revokedAt: null, ...(link.maxUses != null ? { useCount: { lt: link.maxUses } } : {}) },
          data: { useCount: { increment: 1 }, lastUsedAt: now },
        });
        if (bumped.count !== 1) throw new Error("AGENCY_LINK_RACE");
      }
      await tx.tourBookingAttribution.create({
        data: { tourBookingId: tour.id, salesPartnerId: link.salesPartnerId, linkId: link.id, status: blockedReason ? "BLOCKED" : "ACTIVE", blockedReason: blockedReason ?? null },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: blockedReason ? "SALES_AGENCY_TOUR_ATTRIBUTION_BLOCKED" : "SALES_AGENCY_TOUR_ATTRIBUTION",
          entity: "TOUR_BOOKING",
          entityId: tour.id,
          beforeJson: null,
          afterJson: { salesPartnerId: link.salesPartnerId, linkReference: link.reference, ...(blockedReason ? { blockedReason } : {}) },
        },
      });
    });
  } catch (error: any) {
    if (error?.message === "AGENCY_LINK_RACE") return { recorded: false, reason: "LINK_USED_UP" };
    if (error?.code === "P2002") return { recorded: false, reason: "ALREADY_ATTRIBUTED" };
    throw error;
  }
  return blockedReason ? { recorded: true, status: "BLOCKED", blockedReason } : { recorded: true, status: "ACTIVE" };
}

// ---------------------------------------------------------------------------
// Commission
// ---------------------------------------------------------------------------

/**
 * AGENCY_TOUR on a completed, paid tour. Idempotent on AGENCY_TOUR:<id>.
 * Basis: NoLSAF's own commission on the tour, converted to TZS at the rate
 * frozen on the booking, less VAT. Never the tour value.
 */
export async function accrueAgencyTourCommission(tx: any, tourBookingId: number, now: Date = new Date()): Promise<CommissionAccrualResult> {
  const sourceKey = commissionSourceKey("AGENCY_TOUR", tourBookingId);
  const replay = await tx.salesCommission.findUnique({ where: { sourceKey } });
  if (replay) return { created: false, commission: replay };

  const attribution = await tx.tourBookingAttribution.findUnique({ where: { tourBookingId } });
  if (!attribution || attribution.status !== "ACTIVE") return { created: false, skippedReason: "NO_AGENCY_ATTRIBUTION" };

  const tour = await tx.tourBooking.findUnique({
    where: { id: tourBookingId },
    select: {
      id: true, bookingCode: true, title: true, status: true, paymentStatus: true, paidAt: true, completedAt: true, currency: true,
      commissionAmount: true, fxTzsPerUnit: true, operatorAgentId: true, customerId: true, guestPhone: true, guestEmail: true, payerPhone: true,
    },
  });
  if (!tour || String(tour.paymentStatus).toUpperCase() !== "PAID" || !tour.paidAt) return { created: false, skippedReason: "SOURCE_NOT_PAID" };
  if (String(tour.status).toUpperCase() !== "COMPLETED" || !tour.completedAt) return { created: false, skippedReason: "NOT_COMPLETED" };
  if (now.getTime() - new Date(tour.paidAt).getTime() < AGENCY_SETTLE_MS) return { created: false, skippedReason: "SETTLING" };

  const currency = String(tour.currency || "TZS").toUpperCase();
  const fx = currency === "TZS" ? 1 : Number(tour.fxTzsPerUnit || 0);
  if (!(fx > 0)) return { created: false, skippedReason: "NO_FX_RATE" };
  const grossTzs = roundSalesMoney(Number(tour.commissionAmount || 0) * fx);
  if (grossTzs <= 0) return { created: false, skippedReason: "COMMISSION_BASIS_MISSING" };

  const paidAt: Date = tour.paidAt;
  const gate = await loadAgencyGateInput(tx, attribution.salesPartnerId, paidAt);
  const failure = agencyGateFailure({ ...gate, enabled: true, partner: gate.partner ? { ...gate.partner, payoutHoldAt: null } : null }, { at: paidAt });
  const capability = gate.capabilityRow;
  if (failure || !gate.contract?.id || !capability) return { created: false, skippedReason: `AGENCY_NOT_LIVE_AT_PAYMENT:${failure ?? "NO_CONTRACT"}` };

  const settings = await tx.systemSetting.findUnique({ where: { id: 1 }, select: { taxPercent: true } }).catch(() => null);
  const calculation = calculateSalesCommission({
    grossAmount: grossTzs,
    taxAmount: exclusiveTaxAmount(grossTzs, Number(settings?.taxPercent || 0)),
    processingFeeAmount: 0,
    commissionRate: Number(capability.stayRate),
  });

  const identity = await loadPartnerIdentity(tx, attribution.salesPartnerId);
  const blockedReason =
    (identity ? partnerIsTravellerReason(identity, tour) : null) ??
    (identity ? await partnerIsOperatorReason(tx, identity, tour.operatorAgentId) : null) ??
    (TOUR_REFUNDED_STATUSES.includes(String(tour.status).toUpperCase()) || String(tour.paymentStatus).toUpperCase() === "REFUNDED" ? "The tour was cancelled or refunded." : null) ??
    (calculation.commissionAmount <= 0 ? "No eligible revenue on this tour." : null);

  let created: any;
  let wasCreated = true;
  try {
    created = await tx.salesCommission.create({
      data: {
        salesPartnerId: attribution.salesPartnerId,
        propertyId: null,
        attributionId: null,
        contractId: gate.contract.id,
        type: "AGENCY_TOUR",
        status: blockedReason ? "REVERSED" : "VALIDATING",
        ...(blockedReason ? { reversedAt: now, reversalReason: blockedReason } : {}),
        sourceKey,
        ...calculation,
        currency: "TZS",
        description: `Agency Desk tour ${tour.bookingCode}: ${String(tour.title || "").slice(0, 120)}`,
        earnedAt: tour.completedAt,
        eligibleAt: new Date(new Date(tour.completedAt).getTime() + POST_STAY_BUFFER_DAYS * DAY_MS),
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
        afterJson: { sourceKey, type: "AGENCY_TOUR", salesPartnerId: attribution.salesPartnerId, tourBookingId, fx, calculation, ...(blockedReason ? { blockedReason } : {}) },
      },
    });
  }
  return { created: wasCreated, commission: created };
}

export function tourIdFromSourceKey(sourceKey: string): number | null {
  const m = /^AGENCY_TOUR:(\d+)$/.exec(String(sourceKey || ""));
  return m ? Number(m[1]) : null;
}
