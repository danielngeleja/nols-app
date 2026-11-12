/**
 * Sales Agency Desk: demand-side distribution for hand-picked sales partners.
 *
 * Security model (private plan: docs/SALES_AGENCY_DISTRIBUTION_STRATEGY.md):
 * - Nothing here is public. There is no application, no join link and no
 *   public lookup endpoint. The only public touch point is an optional link
 *   token on the normal booking request, and it can only ever attribute a
 *   booking, never create one, change a price or move money.
 * - The capability is granted by an admin only, to an existing sales partner
 *   only, and is usable only after the partner accepts the addendum.
 * - The gate is re-evaluated on every request and at every money step:
 *   kill switch, partner status, contract window, payout hold, capability.
 * - Link tokens are HMAC-derived (256 bits), never stored, carry no partner
 *   id, and are looked up by SHA-256. Guessing one is not feasible.
 * - Commission is earned only on a PAID invoice, on NoLSAF's own commission
 *   (never the booking value), only after the stay, never on the partner's own
 *   stay or own property, never alongside a driver referral, and capped when a
 *   supply-side partner also earns on the same invoice.
 */
import { createHash, createHmac, randomBytes } from "node:crypto";
import { publicLinkSecrets } from "./publicLinkSecrets.js";
import { CONTRACT_EARNING_STATUSES, commissionSourceKey, isContractEarning } from "./salesPartner.js";
import { loadPartnerIdentity, partnerBookedStayReason, partnerOwnsPropertyReason } from "./salesSelfDealing.js";
import {
  bookingWasCancelled,
  calculateSalesCommission,
  exclusiveTaxAmount,
  marketplaceEligibleAt,
  roundSalesMoney,
  type CommissionAccrualResult,
} from "./salesCommission.js";

export const AGENCY_CAPABILITY = "AGENCY" as const;

export const AGENCY_CAPABILITY_STATUSES = ["PENDING_ACCEPTANCE", "ACTIVE", "SUSPENDED", "REVOKED"] as const;
export type AgencyCapabilityStatus = (typeof AGENCY_CAPABILITY_STATUSES)[number];

export const AGENCY_ATTRIBUTION_STATUSES = ["ACTIVE", "BLOCKED", "VOID"] as const;

/** Bounds an admin may set. Open decision 1 in the plan; the rate is per grant. */
export const AGENCY_STAY_RATE_MIN = 1;
export const AGENCY_STAY_RATE_MAX = 40;

/**
 * Supply plus demand partners together never receive more than this share of
 * NoLSAF's eligible net revenue on one invoice. Open decision 2 in the plan.
 */
export const AGENCY_STACKING_CAP_PERCENT = 40;

/** Agency accrual waits this long after payment (see accrueAgencySalesCommission). */
export const AGENCY_SETTLE_MS = 15 * 60 * 1000;

/** Link lifetime limits, in days. */
export const AGENCY_LINK_MAX_DAYS = 90;
export const AGENCY_LINK_DEFAULT_DAYS = 30;
/** Hard ceiling on live links, whatever the admin sets per partner. */
export const AGENCY_LINK_HARD_CAP = 100;

/** Server-side kill switch. Off unless explicitly enabled. */
export function isAgencyDeskEnabled(): boolean {
  return String(process.env.SALES_AGENCY_ENABLED || "").trim().toLowerCase() === "true";
}

// ---------------------------------------------------------------------------
// Addendum
// ---------------------------------------------------------------------------

export const AGENCY_TERMS_VERSION = "2026-11-v1";

/** The addendum the partner accepts. The rate is part of the signed text. */
export function agencyAddendumText(stayRate: number): string {
  const rate = roundSalesMoney(stayRate);
  return [
    `NoLSAF Agency Desk Addendum, version ${AGENCY_TERMS_VERSION}`,
    "",
    "1. This addendum adds to your NoLSAF Sales Partner Agreement and ends when that agreement ends, is suspended or is terminated.",
    "2. NoLSAF granted the Agency Desk to you personally. You may not share your account, your links or this access with anyone.",
    "3. Every client pays NoLSAF directly through NoLSAF payment pages. You must never collect cash, mobile money or any payment from a client, for any reason.",
    `4. You earn ${rate}% of NoLSAF's eligible net revenue on stays booked through your Agency Desk links, after the guest has paid and checked out.`,
    "5. You earn nothing on your own stays, on stays at a property you own or are paid through, on cancelled or refunded stays, or on bookings already credited to another referral.",
    "6. You may not offer discounts, prices or terms that NoLSAF has not approved, and you may not sign anything on behalf of NoLSAF.",
    "7. You may not give gifts, payments or any benefit to a client's employees or officials. Doing so ends this access and forfeits unpaid agency earnings tied to that client.",
    "8. Client information you see belongs to NoLSAF and its clients. Use it only to serve that client, and never copy, export or share it.",
    "9. NoLSAF may suspend or end this access at any time. Clients and bookings stay with NoLSAF.",
  ].join("\n");
}

export function agencyTermsHash(stayRate: number): string {
  return createHash("sha256").update(agencyAddendumText(stayRate)).digest("hex");
}

// ---------------------------------------------------------------------------
// Link tokens
// ---------------------------------------------------------------------------

function signingSecret(): string {
  const [first] = publicLinkSecrets();
  if (!first) throw new Error("agency_link_secret_missing");
  return first;
}

export function newAgencyLinkSalt(): string {
  return randomBytes(16).toString("hex");
}

export function newAgencyLinkReference(): string {
  return `al_${randomBytes(10).toString("hex")}`;
}

/** The token inside the link. Recomputed for display, never stored. */
export function agencyLinkToken(link: { id: number; salt: string }): string {
  return createHmac("sha256", signingSecret()).update(`sales-agency-link:v1:${link.id}:${link.salt}`).digest("base64url");
}

export function hashAgencyToken(token: string): string {
  return createHash("sha256").update(String(token)).digest("hex");
}

/** Only well-formed tokens reach the database. base64url of 32 bytes is 43 chars. */
export function isWellFormedAgencyToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

export function agencyLinkUrl(webOrigin: string, token: string, propertySlug?: string | null): string {
  const path = propertySlug ? `/public/properties/${encodeURIComponent(propertySlug)}` : "/public/properties";
  return `${webOrigin}${path}?ag=${encodeURIComponent(token)}`;
}

/** Extract a property public key from a pasted property URL or slug. */
export function propertyKeyFromInput(input: string): string | null {
  const raw = String(input || "").trim();
  if (!raw) return null;
  let last = raw;
  try {
    const url = new URL(raw);
    last = url.pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    last = raw.split("/").filter(Boolean).pop() || "";
  }
  const key = last.split("-").pop() || "";
  return /^[A-Za-z0-9]{8,40}$/.test(key) ? key : null;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export type AgencyGateInput = {
  enabled: boolean;
  partner: { status: string; payoutHoldAt: Date | null } | null;
  contract: { id?: number; status: string; startsAt: Date; expiresAt: Date } | null;
  capability: { status: string } | null;
};

/**
 * Why this partner may not use the Agency Desk right now, or null when they may.
 * `allowPending` admits a partner who still has to accept the addendum, for the
 * status and accept endpoints only.
 */
export function agencyGateFailure(input: AgencyGateInput, opts: { allowPending?: boolean; at?: Date } = {}): string | null {
  if (!input.enabled) return "DISABLED";
  if (!input.partner) return "NO_PARTNER";
  if (String(input.partner.status).toUpperCase() !== "ACTIVE") return "PARTNER_NOT_ACTIVE";
  if (input.partner.payoutHoldAt) return "PAYOUT_HOLD";
  if (!isContractEarning(input.contract, opts.at)) return "CONTRACT_NOT_ACTIVE";
  const status = String(input.capability?.status || "").toUpperCase();
  if (status === "ACTIVE") return null;
  if (opts.allowPending && status === "PENDING_ACCEPTANCE") return null;
  return "NO_CAPABILITY";
}

/** Load everything the gate needs for one partner, from the database. */
export async function loadAgencyGateInput(db: any, salesPartnerId: number, at: Date = new Date()): Promise<AgencyGateInput & { capabilityRow: any | null }> {
  const partner = await db.salesPartnerProfile.findUnique({
    where: { id: salesPartnerId },
    select: {
      status: true,
      payoutHoldAt: true,
      contracts: {
        where: { status: { in: CONTRACT_EARNING_STATUSES as unknown as string[] }, startsAt: { lte: at }, expiresAt: { gt: at } },
        orderBy: { expiresAt: "desc" },
        take: 1,
        select: { id: true, status: true, startsAt: true, expiresAt: true },
      },
      capabilities: { where: { capability: AGENCY_CAPABILITY }, take: 1 },
    },
  });
  const capabilityRow = partner?.capabilities?.[0] ?? null;
  return {
    enabled: isAgencyDeskEnabled(),
    partner: partner ? { status: partner.status, payoutHoldAt: partner.payoutHoldAt ?? null } : null,
    contract: partner?.contracts?.[0] ?? null,
    capability: capabilityRow ? { status: capabilityRow.status } : null,
    capabilityRow,
  };
}

// ---------------------------------------------------------------------------
// Booking attribution
// ---------------------------------------------------------------------------

export type AgencyAttributionOutcome =
  | { recorded: false; reason: string }
  | { recorded: true; status: "ACTIVE" | "BLOCKED"; blockedReason?: string };

/**
 * Attribute a just-created booking to the partner behind an agency link.
 *
 * Called by the public booking route after the booking exists. Never throws to
 * the caller and never affects the booking: a bad, expired or foreign token is
 * simply ignored. A self-booking is recorded BLOCKED so admins can see the
 * attempt, and it earns nothing.
 */
export async function recordAgencyAttribution(db: any, input: { bookingId: number; token: unknown; now?: Date }): Promise<AgencyAttributionOutcome> {
  const now = input.now ?? new Date();
  if (!isAgencyDeskEnabled()) return { recorded: false, reason: "DISABLED" };
  if (!isWellFormedAgencyToken(input.token)) return { recorded: false, reason: "MALFORMED" };

  const link = await db.salesAgencyLink.findUnique({ where: { tokenHash: hashAgencyToken(input.token) } });
  if (!link) return { recorded: false, reason: "UNKNOWN_LINK" };
  if (link.revokedAt) return { recorded: false, reason: "LINK_REVOKED" };
  if (new Date(link.expiresAt).getTime() <= now.getTime()) return { recorded: false, reason: "LINK_EXPIRED" };
  if (link.maxUses != null && link.useCount >= link.maxUses) return { recorded: false, reason: "LINK_USED_UP" };
  // A tour link only ever credits its own tour.
  if (link.operatorAgentId != null) return { recorded: false, reason: "TOUR_LINK" };

  const gate = await loadAgencyGateInput(db, link.salesPartnerId, now);
  const failure = agencyGateFailure(gate, { at: now });
  if (failure) return { recorded: false, reason: failure };

  const booking = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, propertyId: true, userId: true, guestPhone: true, createdAt: true, user: { select: { email: true, phone: true } } },
  });
  if (!booking) return { recorded: false, reason: "NO_BOOKING" };
  // Only a booking created moments ago can be attributed. This stops anyone
  // from replaying a token against an older booking id.
  if (now.getTime() - new Date(booking.createdAt).getTime() > 10 * 60 * 1000) return { recorded: false, reason: "BOOKING_TOO_OLD" };
  if (link.propertyId != null && link.propertyId !== booking.propertyId) return { recorded: false, reason: "WRONG_PROPERTY" };

  const identity = await loadPartnerIdentity(db, link.salesPartnerId);
  const blockedReason =
    (identity ? partnerBookedStayReason(identity, booking) : null) ??
    (identity ? await partnerOwnsPropertyReason(db, identity, booking.propertyId) : null);

  try {
    await db.$transaction(async (tx: any) => {
      // Counts only real uses; the conditional update also enforces maxUses under concurrency.
      if (!blockedReason) {
        const bumped = await tx.salesAgencyLink.updateMany({
          where: {
            id: link.id,
            revokedAt: null,
            ...(link.maxUses != null ? { useCount: { lt: link.maxUses } } : {}),
          },
          data: { useCount: { increment: 1 }, lastUsedAt: now },
        });
        if (bumped.count !== 1) throw new Error("AGENCY_LINK_RACE");
      }
      await tx.bookingChannelAttribution.create({
        data: {
          bookingId: booking.id,
          salesPartnerId: link.salesPartnerId,
          linkId: link.id,
          channel: "AGENCY_LINK",
          status: blockedReason ? "BLOCKED" : "ACTIVE",
          blockedReason: blockedReason ?? null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: null,
          actorRole: "SYSTEM",
          action: blockedReason ? "SALES_AGENCY_ATTRIBUTION_BLOCKED" : "SALES_AGENCY_ATTRIBUTION",
          entity: "BOOKING",
          entityId: booking.id,
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
 * Accrue the Agency Desk commission for a paid invoice. Idempotent on
 * AGENCY_INVOICE:<id>. Must run after the supply-side marketplace accrual for
 * the same invoice so the stacking cap sees it (the lifecycle worker does).
 */
export async function accrueAgencySalesCommission(tx: any, invoiceId: number, now: Date = new Date()): Promise<CommissionAccrualResult> {
  const sourceKey = commissionSourceKey("AGENCY_INVOICE", invoiceId);
  const replay = await tx.salesCommission.findUnique({ where: { sourceKey } });
  if (replay) return { created: false, commission: replay };

  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true,
      status: true,
      commissionPercent: true,
      commissionAmount: true,
      taxPercent: true,
      paidAt: true,
      bookingId: true,
      booking: {
        select: {
          propertyId: true,
          status: true,
          checkOut: true,
          userId: true,
          guestPhone: true,
          user: { select: { email: true, phone: true } },
          cancellationRequests: { select: { status: true } },
          property: { select: { title: true, currency: true } },
        },
      },
    },
  });
  if (!invoice || invoice.status !== "PAID" || !invoice.paidAt) return { created: false, skippedReason: "SOURCE_NOT_PAID" };
  // Let the payment settle first, so the supply-side accrual that runs inline at
  // payment time is already on the ledger when the stacking cap is computed.
  if (now.getTime() - new Date(invoice.paidAt).getTime() < AGENCY_SETTLE_MS) return { created: false, skippedReason: "SETTLING" };

  const attribution = await tx.bookingChannelAttribution.findUnique({ where: { bookingId: invoice.bookingId } });
  if (!attribution || attribution.status !== "ACTIVE") return { created: false, skippedReason: "NO_AGENCY_ATTRIBUTION" };

  const grossCommission = Number(invoice.commissionAmount || 0);
  if (grossCommission <= 0 || Number(invoice.commissionPercent || 0) <= 0) return { created: false, skippedReason: "COMMISSION_BASIS_MISSING" };

  // Gate at the moment the money was collected, not today.
  const paidAt: Date = invoice.paidAt;
  const gate = await loadAgencyGateInput(tx, attribution.salesPartnerId, paidAt);
  const capability = gate.capabilityRow;
  // Kill switch and payout hold are about today's access, not about money already
  // collected: an earning still accrues (and waits) if the desk was live at paidAt.
  const failure = agencyGateFailure({ ...gate, enabled: true, partner: gate.partner ? { ...gate.partner, payoutHoldAt: null } : null }, { at: paidAt });
  if (failure || !gate.contract?.id || !capability) return { created: false, skippedReason: `AGENCY_NOT_LIVE_AT_PAYMENT:${failure ?? "NO_CONTRACT"}` };
  if (capability.acceptedAt && new Date(capability.acceptedAt).getTime() > paidAt.getTime()) {
    return { created: false, skippedReason: "AGENCY_NOT_LIVE_AT_PAYMENT:NOT_ACCEPTED" };
  }

  const base = calculateSalesCommission({
    grossAmount: grossCommission,
    taxAmount: exclusiveTaxAmount(grossCommission, Number(invoice.taxPercent || 0)),
    processingFeeAmount: 0,
    commissionRate: Number(capability.stayRate),
  });

  // Stacking cap with the supply-side partner on the same invoice.
  const supply = await tx.salesCommission.findUnique({ where: { sourceKey: commissionSourceKey("INVOICE", invoiceId) } });
  const supplyAmount = supply && !["REVERSED", "CANCELLED"].includes(supply.status) ? Math.max(0, Number(supply.commissionAmount)) : 0;
  const capTotal = roundSalesMoney(base.eligibleNetRevenue * (AGENCY_STACKING_CAP_PERCENT / 100));
  const commissionAmount = roundSalesMoney(Math.max(0, Math.min(base.commissionAmount, capTotal - supplyAmount)));
  const calculation = { ...base, commissionAmount };

  const identity = await loadPartnerIdentity(tx, attribution.salesPartnerId);
  const referral = await tx.referralEarning.findFirst({ where: { OR: [{ bookingId: invoice.bookingId }, { invoiceId: invoice.id }] }, select: { id: true } });
  const blockedReason =
    (identity ? partnerBookedStayReason(identity, invoice.booking) : null) ??
    (identity ? await partnerOwnsPropertyReason(tx, identity, invoice.booking.propertyId) : null) ??
    (referral ? "This booking already earns a driver referral." : null) ??
    (bookingWasCancelled(invoice.booking) ? "The booking was cancelled or refunded." : null) ??
    (commissionAmount <= 0 ? "The combined partner share cap is already reached on this invoice." : null);

  let created: any;
  let wasCreated = true;
  try {
    created = await tx.salesCommission.create({
      data: {
        salesPartnerId: attribution.salesPartnerId,
        propertyId: invoice.booking.propertyId,
        attributionId: null,
        contractId: gate.contract.id,
        type: "AGENCY_STAY",
        status: blockedReason ? "REVERSED" : "VALIDATING",
        ...(blockedReason ? { reversedAt: now, reversalReason: blockedReason } : {}),
        sourceKey,
        sourceInvoiceId: invoice.id,
        sourceBookingId: invoice.bookingId,
        ...calculation,
        currency: invoice.booking.property.currency || "TZS",
        description: `Agency Desk booking, paid invoice #${invoice.id}`,
        earnedAt: paidAt,
        eligibleAt: marketplaceEligibleAt(paidAt, invoice.booking.checkOut),
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
        afterJson: {
          sourceKey,
          type: "AGENCY_STAY",
          salesPartnerId: attribution.salesPartnerId,
          propertyId: invoice.booking.propertyId,
          calculation,
          stackingCap: { capPercent: AGENCY_STACKING_CAP_PERCENT, supplyAmount, uncappedAmount: base.commissionAmount },
          ...(blockedReason ? { blockedReason } : {}),
        },
      },
    });
  }
  return { created: wasCreated, commission: created, propertyTitle: invoice.booking.property.title };
}

/** Mask a phone for partner views: keep the last three digits. */
export function maskClientPhone(value: string | null | undefined): string | null {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  return `••• ${digits.slice(-3)}`;
}
