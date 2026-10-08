/**
 * Payout Release — qualification after a verified stay starts
 *
 * See docs/OWNER_PAYOUT_WITHDRAWAL_PLAN.md. A PayoutRelease row is created
 * when a guest's check-in code is validated and decides WHEN the owner may
 * withdraw. It never moves money: once the owner withdraws (Phase 2), the
 * existing Disbursement pipeline (ledger.ts, batching.ts) pays as before.
 *
 * Phase 1 runs in shadow mode. Releases are created and unlocked, but owners
 * are still paid through the existing manual claim, so a release whose claim
 * was paid that way is simply marked RELEASED with lane MANUAL. All payment
 * channels use validated check-in as the earliest eligibility time; the live
 * payment, guest alert, dispute and payout-account checks still apply.
 */

import { prisma } from "@nolsaf/prisma";
import { Prisma } from "@prisma/client";
import {
  getEffectiveCommissionPercent,
  resolveOwnerPayoutAmount,
} from "../../lib/accommodationPayout.js";
import { confirmedCustomerPaymentForBooking, PaymentCurrencyMismatchError } from "./eligibility.js";
import { loadPayoutSafeguards } from "./riskScoring.js";
import { ensureGuestCheckInConfirmation, guestCheckInAlertAccepted } from "../../lib/checkInConfirmationSms.js";

export type PayoutReleaseStatus = "LOCKED" | "HELD" | "AVAILABLE" | "WITHDRAWING" | "RELEASED" | "CANCELLED";
export type PayoutReleaseRule = "CHECKIN_CONFIRMED";

const HOUR_MS = 60 * 60 * 1000;
/**
 * Tanzania observes no daylight saving, so East Africa Time is a fixed UTC+3.
 * A fixed offset keeps the unlock time deterministic on any host timezone.
 */
const EAT_OFFSET_MS = 3 * HOUR_MS;
const OWNER_INVOICE_PREFIX = "OINV-";
const AMOUNT_TOLERANCE = 0.01;

/** Booking statuses under which a stay has really started. */
const STAY_STARTED_STATUSES = new Set(["CHECKED_IN", "CHECKED_OUT"]);
/** Cancellation requests that are still being decided or already granted. */
const OPEN_CANCELLATION_STATUSES = ["SUBMITTED", "REVIEWING", "NEED_INFO", "APPROVED", "REFUND_PENDING"];
/** Owner claims the legacy manual flow has already taken past approval. */
const LEGACY_PAID_INVOICE_STATUSES = new Set(["APPROVED", "PROCESSING", "PAID", "DISBURSED"]);

/** Statuses the release worker re-evaluates. HELD only moves when an admin clears it. */
export const EVALUATED_RELEASE_STATUSES: PayoutReleaseStatus[] = ["LOCKED", "AVAILABLE"];

/** Feature flag for Phase 1. Off until the migration is applied, so deploying code first is safe. */
export function payoutReleaseEnabled(): boolean {
  return ["1", "true", "yes", "on"].includes(String(process.env.PAYOUT_RELEASE_ENABLED || "").trim().toLowerCase());
}

/** Midnight East Africa Time of the EAT calendar day containing `date`, as a UTC instant. */
export function startOfEatDay(date: Date): Date {
  const shifted = new Date(date.getTime() + EAT_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - EAT_OFFSET_MS);
}

/**
 * Pure eligibility-time rule. A provider-confirmed guest payment remains a
 * separate mandatory gate for every channel, including cards.
 */
export function computeReleaseAt(input: {
  codeUsedAt: Date;
  checkIn: Date;
  checkOut: Date;
  paymentChannels: Array<string | null>;
}): { rule: PayoutReleaseRule; releaseAt: Date } {
  return { rule: "CHECKIN_CONFIRMED", releaseAt: input.codeUsedAt };
}

/**
 * Finds the owner's claim for a booking by booking and prefix. Never by the
 * month-stamped invoice number: a claim made in one month must be found again
 * in the next, or the same stay gets a second claim and can be paid twice.
 */
export async function findOwnerClaim(
  ownerId: number,
  bookingId: number,
  client: Prisma.TransactionClient | typeof prisma = prisma
) {
  return client.invoice.findFirst({
    where: { ownerId, bookingId, invoiceNumber: { startsWith: OWNER_INVOICE_PREFIX } },
    orderBy: { id: "asc" },
    select: { id: true, status: true, netPayable: true, invoiceNumber: true },
  });
}

function ownerClaimNumber(bookingId: number, codeId: number, at: Date): string {
  const eat = new Date(at.getTime() + EAT_OFFSET_MS);
  const ym = `${eat.getUTCFullYear()}${String(eat.getUTCMonth() + 1).padStart(2, "0")}`;
  return `${OWNER_INVOICE_PREFIX}${ym}-${String(bookingId).padStart(6, "0")}-${String(codeId).padStart(4, "0")}`;
}

/**
 * Creates the owner's claim as DRAFT if none exists. DRAFT on purpose: in
 * shadow mode the admin queue must not change, and the owner's existing
 * "send invoice" action still moves it to REQUESTED exactly as before.
 * Same amount rules as owner.booking.ts and owner.invoices.ts.
 */
export async function ensureOwnerClaimDraft(bookingId: number) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      property: { select: { ownerId: true, basePrice: true, services: true } },
      code: { select: { id: true } },
    },
  });
  if (!booking?.property || !booking.code) return null;
  const ownerId = booking.property.ownerId;

  const existing = await findOwnerClaim(ownerId, bookingId);
  if (existing) return { ownerId, claim: existing };

  const nights = Math.max(1, Math.ceil((+booking.checkOut - +booking.checkIn) / (24 * HOUR_MS)));
  const transportFare = booking.includeTransport ? Number(booking.transportFare || 0) : 0;
  const pricePerNight = booking.property.basePrice != null ? Number(booking.property.basePrice) : null;
  const accommodationGross = booking.totalAmount
    ? Math.max(0, Number(booking.totalAmount) - transportFare)
    : pricePerNight ? pricePerNight * nights : 0;

  const invoiceNumber = ownerClaimNumber(booking.id, booking.code.id, new Date());
  const commissionPercent = await getEffectiveCommissionPercent(booking.property.services);
  const ownerPayout = resolveOwnerPayoutAmount({
    invoiceNumber,
    invoiceTotal: accommodationGross,
    bookingTotalAmount: booking.totalAmount,
    transportFare,
    commissionPercent,
  });

  try {
    const claim = await prisma.$transaction(async (tx) => {
      const raced = await findOwnerClaim(ownerId, bookingId, tx);
      if (raced) return raced;
      return tx.invoice.create({
        data: {
          invoiceNumber,
          ownerId,
          bookingId: booking.id,
          status: "DRAFT",
          total: ownerPayout as any,
          taxPercent: 0 as any,
          commissionPercent: null,
          commissionAmount: null,
          netPayable: ownerPayout as any,
        },
        select: { id: true, status: true, netPayable: true, invoiceNumber: true },
      });
    });
    return { ownerId, claim };
  } catch (err: any) {
    // Lost a race on the unique invoice number: the other writer's claim stands.
    if (err?.code === "P2002") {
      const claim = await findOwnerClaim(ownerId, bookingId);
      if (claim) return { ownerId, claim };
    }
    throw err;
  }
}

/**
 * Idempotently creates the release for a checked-in booking. Returns null when
 * the booking has not really started (not CHECKED_IN/CHECKED_OUT, or the code
 * is not USED); the sweeper retries later.
 */
export async function ensurePayoutRelease(bookingId: number) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      status: true,
      checkIn: true,
      checkOut: true,
      code: { select: { status: true, usedAt: true, usedByOwner: true } },
    },
  });
  if (!booking || !STAY_STARTED_STATUSES.has(String(booking.status).toUpperCase())) return null;
  if (booking.code?.status !== "USED" || !booking.code.usedAt || booking.code.usedByOwner !== true) return null;

  const ensured = await ensureOwnerClaimDraft(bookingId);
  if (!ensured) return null;

  const existing = await prisma.payoutRelease.findUnique({
    where: { sourceType_sourceId: { sourceType: "OWNER_INVOICE", sourceId: ensured.claim.id } },
  });
  if (existing) return existing;

  const { rule, releaseAt } = computeReleaseAt({
    codeUsedAt: booking.code.usedAt,
    checkIn: booking.checkIn,
    checkOut: booking.checkOut,
    paymentChannels: [],
  });

  try {
    return await prisma.payoutRelease.create({
      data: {
        sourceType: "OWNER_INVOICE",
        sourceId: ensured.claim.id,
        bookingId,
        ownerId: ensured.ownerId,
        status: "LOCKED",
        rule,
        releaseAt,
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return prisma.payoutRelease.findUnique({
        where: { sourceType_sourceId: { sourceType: "OWNER_INVOICE", sourceId: ensured.claim.id } },
      });
    }
    throw err;
  }
}

/**
 * True when this stay's payout must go through Withdraw (OTP) rather than the
 * legacy owner "submit claim" routes: the feature is on and the booking has a
 * payout lock. Stays from before the feature have no lock and keep the old path.
 */
export async function claimRequiresWithdrawal(bookingId: number): Promise<boolean> {
  if (!payoutReleaseEnabled()) return false;
  const release = await prisma.payoutRelease.findFirst({ where: { bookingId }, select: { id: true } });
  return !!release;
}

export const USE_WITHDRAW_RESPONSE = {
  code: "USE_WITHDRAW",
  error: "Payouts for this stay are requested with Withdraw on My Payouts, confirmed by a one-time code.",
} as const;

/**
 * Check-in hook. Called after the check-in transaction has committed and
 * never awaited by the desk: a payout problem must never turn a guest away.
 * The release worker's sweeper creates anything this misses.
 */
export function onBookingCheckedIn(bookingId: number): void {
  void (async () => {
    await ensureGuestCheckInConfirmation(bookingId);
    if (!payoutReleaseEnabled()) return;
    const release = await ensurePayoutRelease(bookingId);
    if (!release) return;
    const decision = decideRelease(await loadReleaseContext(release));
    await applyReleaseDecision(release, decision);
  })().catch((err) => {
    console.error("[payout-release] check-in follow-up failed", {
      bookingId,
      code: err?.code,
      message: err?.message,
    });
  });
}

/**
 * The one word an owner sees for a payout, used by every owner screen so the
 * same state is never described two ways:
 *   UNLOCKING     waiting for the unlock time
 *   WAITING       unlock time passed, waiting on payment confirmation or a payout account
 *   ON_HOLD       held (cancellation, refund, guest matches owner...)
 *   READY         can be withdrawn
 *   SENDING       withdrawn, on its way (automatic lane or in flight)
 *   UNDER_REVIEW  withdrawn, with NoLSAF's payments team (manual lane)
 *   PAID          money confirmed sent
 *   SETTLED       used in full to settle an earlier refund, nothing sent
 *   CANCELLED     booking cancelled or claim rejected
 */
export type OwnerPayoutStage =
  | "UNLOCKING"
  | "WAITING"
  | "ON_HOLD"
  | "READY"
  | "SENDING"
  | "UNDER_REVIEW"
  | "PAID"
  | "SETTLED"
  | "CANCELLED";

export function ownerPayoutStage(input: {
  status: string;
  lane: string | null;
  holdReason: string | null;
  claimStatus: string | null;
}): OwnerPayoutStage {
  const claim = String(input.claimStatus ?? "").toUpperCase();
  switch (input.status) {
    case "LOCKED":
      return input.holdReason ? "WAITING" : "UNLOCKING";
    case "HELD":
      return "ON_HOLD";
    case "AVAILABLE":
      return "READY";
    case "WITHDRAWING":
      return "SENDING";
    case "CANCELLED":
      return "CANCELLED";
    case "RELEASED":
      if (input.lane === "OFFSET") return "SETTLED";
      if (claim === "PAID") return "PAID";
      if (claim === "REJECTED") return "CANCELLED";
      return input.lane === "AUTO" ? "SENDING" : "UNDER_REVIEW";
    default:
      return "UNLOCKING";
  }
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface ReleaseContext {
  now: Date;
  releaseAt: Date;
  bookingStatus: string;
  claimStatus: string | null;
  /** A non-failed disbursement already exists for the claim (legacy manual payout). */
  hasActiveDisbursement: boolean;
  openCancellationStatus: string | null;
  refunded: boolean;
  guestIsOwner: boolean;
  currencyMismatch: boolean;
  guestAlertAccepted: boolean;
  collectedEnough: boolean;
  payoutAccountProblem: string | null;
}

export type ReleaseDecision =
  | { next: "CANCELLED"; reason: string }
  | { next: "RELEASED"; reason: string }
  | { next: "HELD"; reason: string }
  | { next: "LOCKED"; reason: string | null }
  | { next: "AVAILABLE"; reason: null };

/**
 * Pure decision for a LOCKED or AVAILABLE release. Order matters: terminal
 * outcomes first, then anything a person must look at (HELD), then the clock,
 * then conditions that clear on their own (stay LOCKED with a reason).
 */
export function decideRelease(ctx: ReleaseContext): ReleaseDecision {
  const booking = ctx.bookingStatus.toUpperCase();
  const claim = (ctx.claimStatus ?? "").toUpperCase();

  if (!ctx.claimStatus) return { next: "CANCELLED", reason: "The owner claim for this booking no longer exists" };
  if (claim === "REJECTED") return { next: "CANCELLED", reason: "The owner claim was rejected" };
  if (booking === "CANCELED" || booking === "CANCELLED") return { next: "CANCELLED", reason: "The booking was cancelled" };

  if (ctx.hasActiveDisbursement || LEGACY_PAID_INVOICE_STATUSES.has(claim)) {
    return { next: "RELEASED", reason: "Paid through the manual claim flow" };
  }

  if (ctx.openCancellationStatus) {
    return { next: "HELD", reason: `A cancellation or refund request is open (${ctx.openCancellationStatus.toLowerCase()})` };
  }
  if (ctx.refunded) return { next: "HELD", reason: "A refund was paid on this booking" };
  if (!STAY_STARTED_STATUSES.has(booking)) {
    return { next: "HELD", reason: `The booking is ${booking.toLowerCase().replace(/_/g, " ")}` };
  }
  if (ctx.guestIsOwner) return { next: "HELD", reason: "The guest matches the property owner" };
  if (ctx.currencyMismatch) return { next: "HELD", reason: "The guest payment currency does not match the payout currency" };

  if (ctx.now.getTime() < ctx.releaseAt.getTime()) return { next: "LOCKED", reason: null };

  if (!ctx.collectedEnough) return { next: "LOCKED", reason: "Waiting for the guest payment to be confirmed" };
  if (!ctx.guestAlertAccepted) return { next: "LOCKED", reason: "Waiting for the guest check-in alert to be accepted by SMS or email" };
  if (ctx.payoutAccountProblem) return { next: "LOCKED", reason: ctx.payoutAccountProblem };

  return { next: "AVAILABLE", reason: null };
}

/** Last 9 digits: compares +255712..., 0712... and 712... as the same number. */
function phoneKey(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

function emailKey(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** The owner's usable payout destinations, the one payouts go to first. */
export async function verifiedPayoutAccounts(ownerId: number) {
  return prisma.payoutAccount.findMany({
    where: { userId: ownerId, isActive: true, isVerified: true, type: "MOBILE_MONEY" },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
    select: { id: true, userId: true, provider: true, accountNumber: true, destinationChangedAt: true, createdAt: true },
  });
}

/** Why the owner cannot be paid yet, or null when a usable destination exists. */
async function payoutAccountProblem(ownerId: number, now: Date): Promise<{ problem: string | null; accountNumbers: string[] }> {
  const accounts = await verifiedPayoutAccounts(ownerId);
  const accountNumbers = accounts.map((a) => a.accountNumber);
  const primary = accounts[0];
  if (!primary) return { problem: "Add and verify a mobile money payout account", accountNumbers };

  const { recentChangeHours } = await loadPayoutSafeguards();
  const changedAt = primary.destinationChangedAt ?? primary.createdAt;
  const unlockAt = changedAt.getTime() + recentChangeHours * HOUR_MS;
  if (now.getTime() < unlockAt) {
    return { problem: `Payout account changed recently, usable after ${new Date(unlockAt).toISOString()}`, accountNumbers };
  }
  return { problem: null, accountNumbers };
}

/** Loads everything decideRelease needs for one release. Reads only. */
export async function loadReleaseContext(
  release: { id: number; sourceId: number; bookingId: number; ownerId: number; releaseAt: Date },
  now = new Date()
): Promise<ReleaseContext> {
  const [booking, claim, disbursement, cancellations, owner, guestAlertAccepted] = await Promise.all([
    prisma.booking.findUnique({
      where: { id: release.bookingId },
      select: { status: true, userId: true, guestPhone: true, user: { select: { phone: true, email: true } } },
    }),
    prisma.invoice.findUnique({ where: { id: release.sourceId }, select: { status: true, netPayable: true } }),
    prisma.disbursement.findFirst({
      where: { sourceType: "OWNER_INVOICE", sourceId: release.sourceId, status: { notIn: ["FAILED"] } },
      select: { id: true },
    }),
    prisma.cancellationRequest.findMany({
      where: { bookingId: release.bookingId },
      select: { status: true },
      orderBy: { id: "desc" },
    }),
    prisma.user.findUnique({ where: { id: release.ownerId }, select: { phone: true, email: true } }),
    guestCheckInAlertAccepted(release.bookingId),
  ]);

  const statuses = cancellations.map((c) => String(c.status).toUpperCase());
  const openCancellationStatus = statuses.find((s) => OPEN_CANCELLATION_STATUSES.includes(s)) ?? null;
  const refunded = statuses.includes("REFUNDED");

  const account = await payoutAccountProblem(release.ownerId, now);

  const ownerPhones = new Set(
    [phoneKey(owner?.phone), ...account.accountNumbers.map(phoneKey)].filter((v): v is string => !!v)
  );
  const guestPhones = [phoneKey(booking?.guestPhone), phoneKey(booking?.user?.phone)].filter((v): v is string => !!v);
  const ownerEmail = emailKey(owner?.email);
  const guestIsOwner =
    booking?.userId === release.ownerId ||
    guestPhones.some((p) => ownerPhones.has(p)) ||
    (!!ownerEmail && emailKey(booking?.user?.email) === ownerEmail);

  let collectedEnough = false;
  let currencyMismatch = false;
  const netPayable = claim?.netPayable != null ? Number(claim.netPayable) : null;
  if (netPayable != null && netPayable > 0) {
    try {
      const collected = await confirmedCustomerPaymentForBooking(release.bookingId, "TZS");
      collectedEnough = Number(collected) + AMOUNT_TOLERANCE >= netPayable;
    } catch (err) {
      if (err instanceof PaymentCurrencyMismatchError) currencyMismatch = true;
      else throw err;
    }
  }

  return {
    now,
    releaseAt: release.releaseAt,
    bookingStatus: String(booking?.status ?? ""),
    claimStatus: claim?.status ?? null,
    hasActiveDisbursement: !!disbursement,
    openCancellationStatus,
    refunded,
    guestIsOwner,
    currencyMismatch,
    guestAlertAccepted,
    collectedEnough,
    payoutAccountProblem: account.problem,
  };
}

/**
 * Applies a decision with a conditional update, so a release that changed
 * state in the meantime (for example an owner withdrawal in Phase 2) is
 * never overwritten by a stale worker pass. Returns true when it moved.
 */
export async function applyReleaseDecision(
  release: { id: number; status: string; holdReason: string | null },
  decision: ReleaseDecision,
  now = new Date()
): Promise<boolean> {
  // Nothing changed: skip the write so a quiet pass costs no updates.
  if (decision.next === release.status && (decision.reason ?? null) === (release.holdReason ?? null)) return false;

  const data: Prisma.PayoutReleaseUpdateManyMutationInput = { status: decision.next, holdReason: decision.reason };
  if (decision.next === "AVAILABLE") data.availableAt = now;
  if (decision.next === "HELD") data.heldAt = now;
  if (decision.next === "CANCELLED") data.cancelledAt = now;
  if (decision.next === "RELEASED") {
    data.releasedAt = now;
    data.lane = "MANUAL";
  }

  const moved = await prisma.payoutRelease.updateMany({
    where: { id: release.id, status: release.status },
    data,
  });
  return moved.count === 1 && decision.next !== release.status;
}
