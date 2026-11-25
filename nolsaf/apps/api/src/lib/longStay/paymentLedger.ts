/**
 * The long-stay payments ledger (docs/LONG_STAY_RENTALS.md sections 4 and 5),
 * one row per tenancy, worked out only from the tenancy's frozen figures:
 *   - the card payment to NoLSAF (first month + tenant fee): expected, paid, when, reference;
 *   - where that money went (fee, commission, card cost, landlord payout, refund);
 *   - the balance paid to the landlord at move-in, as each side confirmed it;
 *   - what remains under the lease after the prepaid months;
 *   - a risk assessment with the reasons, so an admin sees why a row is red.
 * Pure: the route loads the rows, this file only reads them.
 */

export type RiskLevel = "HIGH" | "MEDIUM" | "LOW";
export type RiskFlag = { code: string; level: "HIGH" | "MEDIUM"; text: string };

export type LedgerContext = {
  now: Date;
  /** Card gateway rate in percent (systemSetting.gatewayFeeRates.CARD). */
  cardFeePercent: number;
  /** Landlords who have been paid on an earlier long stay. */
  landlordsPaidBefore: Set<number>;
  /** Landlords whose long stays are paused. */
  landlordsPaused: Set<number>;
  /** Open claim totals owed by each landlord, across tenancies. */
  landlordOpenClaims: Map<number, number>;
  /** Tenant long-stay ID expiry (YYYY-MM-DD) by tenant user id. */
  tenantIdExpiry: Map<number, string | null>;
};

const num = (v: unknown) => (v == null ? null : Number(v));
const day = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString().slice(0, 10) : null);
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);
const round = (amount: number, currency: string) => (currency === "TZS" ? Math.round(amount) : Math.round(amount * 100) / 100);

/** Thresholds above which a single booking payment deserves a second look. */
export const LARGE_BOOKING: Record<string, number> = { USD: 5000, TZS: 12_000_000 };

function addMonthsDay(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

export function balanceState(t: any): "NOT_DUE" | "AWAITING" | "CONFIRMED" | "ONE_SIDE" | "MISMATCH" | "NONE" {
  const due = Number(t.balanceDue ?? 0);
  if (!(due > 0)) return "NONE";
  if (t.balanceMismatch) return "MISMATCH";
  const l = t.landlordConfirmedAt != null;
  const tn = t.tenantConfirmedAt != null;
  if (l && tn) return "CONFIRMED";
  if (l || tn) return "ONE_SIDE";
  if (["MOVE_IN", "ACTIVE", "DISPUTED", "ENDING", "ENDED", "OVERDUE"].includes(t.status)) return "AWAITING";
  return "NOT_DUE";
}

export function assessRisk(t: any, ctx: LedgerContext): { level: RiskLevel; score: number; flags: RiskFlag[] } {
  const flags: RiskFlag[] = [];
  const currency = String(t.currency || "TZS");
  const expected = num(t.bookingAmount);
  const paid = num(t.paidAmount);
  if (paid != null && expected != null && Math.abs(paid - expected) > (currency === "TZS" ? 1 : 0.01)) {
    flags.push({ code: "AMOUNT_MISMATCH", level: "HIGH", text: `Paid ${paid} against ${expected} expected` });
  }
  if (isPaid(t) && t.payoutStatus === "REFUND_DUE") flags.push({ code: "REFUND_OWED", level: "HIGH", text: "Money received that must go back to the tenant" });
  if (t.balanceMismatch) flags.push({ code: "BALANCE_MISMATCH", level: "HIGH", text: "Landlord and tenant reported different move-in balances" });
  if (t.status === "DISPUTED") flags.push({ code: "DISPUTED", level: "HIGH", text: "A problem was reported; money is on hold" });
  if (t.status === "OVERDUE") flags.push({ code: "OVERSTAY", level: "HIGH", text: "Past the lease end with no move-out" });
  if (t.tenantMatchesListing === false) flags.push({ code: "NOT_AS_LISTED", level: "HIGH", text: "Tenant said the home does not match the listing" });
  if (t.tenantKeysReceived === false) flags.push({ code: "NO_KEYS", level: "HIGH", text: "Tenant said the keys were not handed over" });

  const expiry = ctx.tenantIdExpiry.get(t.tenantId);
  const end = day(t.endDate);
  if (expiry && end && expiry < end && !["CANCELLED", "ENDED"].includes(t.status)) {
    flags.push({ code: "ID_EXPIRES", level: "MEDIUM", text: `Tenant ID expires ${expiry}, before the lease ends ${end}` });
  }
  if (t.status === "AWAITING_PAYMENT" && t.paymentDueAt) {
    const left = new Date(t.paymentDueAt).getTime() - ctx.now.getTime();
    if (left < 0) flags.push({ code: "PAYMENT_LATE", level: "MEDIUM", text: "Payment window has passed" });
    else if (left < 6 * 3_600_000) flags.push({ code: "PAYMENT_DUE_SOON", level: "MEDIUM", text: "Less than 6 hours left to pay" });
  }
  const moveIn = day(t.moveInDate);
  const today = ctx.now.toISOString().slice(0, 10);
  if (moveIn && !t.moveInConfirmedAt && ["RESERVED", "MOVE_IN"].includes(t.status) && moveIn < today) {
    const daysLate = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${moveIn}T00:00:00Z`).getTime()) / 86_400_000);
    if (daysLate >= 3) flags.push({ code: "MOVE_IN_UNCONFIRMED", level: "MEDIUM", text: `Move-in not confirmed ${daysLate} days after the date` });
  }
  if (isPaid(t) && !ctx.landlordsPaidBefore.has(t.landlordId) && !["RELEASED", "REFUNDED"].includes(t.payoutStatus)) {
    flags.push({ code: "FIRST_PAYOUT", level: "MEDIUM", text: "Landlord's first long-stay payout: check by hand" });
  }
  if (ctx.landlordsPaused.has(t.landlordId)) flags.push({ code: "LANDLORD_PAUSED", level: "MEDIUM", text: "Landlord's long stays are paused" });
  const owed = ctx.landlordOpenClaims.get(t.landlordId) ?? 0;
  if (owed > 0) flags.push({ code: "LANDLORD_OWES", level: "MEDIUM", text: "Landlord has open refund claims" });
  if (expected != null && expected >= (LARGE_BOOKING[currency] ?? Number.POSITIVE_INFINITY)) {
    flags.push({ code: "LARGE_AMOUNT", level: "MEDIUM", text: "Large card payment" });
  }

  const score = Math.min(100, flags.reduce((s, f) => s + (f.level === "HIGH" ? 35 : 15), 0));
  const level: RiskLevel = flags.some((f) => f.level === "HIGH") ? "HIGH" : flags.length ? "MEDIUM" : "LOW";
  return { level, score, flags };
}

/** Where a tenancy's money stands, for the ledger. */
/** Paid, by any record we have: the time, the amount, or a status only reachable by paying. */
export function isPaid(t: any): boolean {
  return Boolean(t.paidAt || t.paidAmount != null || ["RESERVED", "MOVE_IN", "ACTIVE", "ENDING", "ENDED", "DISPUTED", "OVERDUE"].includes(t.status) || ["HELD", "READY", "REVIEW", "APPROVED", "RELEASED"].includes(t.payoutStatus));
}

export function paymentStage(t: any): "AWAITING" | "OVERDUE" | "HELD" | "TO_RELEASE" | "RELEASED" | "REFUND_DUE" | "REFUNDED" | "LAPSED" {
  if (t.payoutStatus === "REFUND_DUE") return "REFUND_DUE";
  if (t.payoutStatus === "REFUNDED") return "REFUNDED";
  if (t.payoutStatus === "RELEASED") return "RELEASED";
  if (["READY", "REVIEW", "APPROVED"].includes(t.payoutStatus)) return "TO_RELEASE";
  if (isPaid(t)) return "HELD";
  if (t.status === "AWAITING_PAYMENT") return t.paymentDueAt && new Date(t.paymentDueAt).getTime() < Date.now() ? "OVERDUE" : "AWAITING";
  return "LAPSED";
}

export function ledgerRow(t: any, ctx: LedgerContext, landlordPayout: number) {
  const currency = String(t.currency || "TZS");
  const rent = num(t.monthlyRent) ?? 0;
  const term = Number(t.termMonths ?? 0);
  const upfront = Number(t.upfrontMonths ?? 0);
  // A paid tenancy without a stored amount paid exactly what it owed (checked at settlement).
  const paid = num(t.paidAmount) ?? (isPaid(t) ? num(t.bookingAmount) : null);
  const tenantFee = num(t.tenantFee) ?? 0;
  const commission = num(t.landlordCommission) ?? 0;
  const cardFee = paid != null ? round((paid * ctx.cardFeePercent) / 100, currency) : 0;
  const refunded = t.payoutStatus === "REFUNDED";
  const nolsafKeeps = isPaid(t) && !refunded && t.payoutStatus !== "REFUND_DUE" ? round(tenantFee + commission - cardFee, currency) : 0;
  const remainingMonths = Math.max(0, term - upfront);
  const moveIn = day(t.moveInDate);
  const risk = assessRisk(t, ctx);
  return {
    ref: t.publicRef,
    status: t.status,
    stage: paymentStage(t),
    payoutStatus: t.payoutStatus,
    currency,
    home: t.property?.title ?? null,
    area: [t.property?.district, t.property?.regionName].filter(Boolean).join(", "),
    tenant: { name: t.tenant?.fullName || t.tenant?.name || null, phone: t.tenant?.phone ?? null },
    landlord: { name: t.landlord?.fullName || t.landlord?.name || null, phone: t.landlord?.phone ?? null },
    term: { months: term, prepaidMonths: upfront, moveIn, end: day(t.endDate), monthlyRent: rent },
    booking: {
      expected: num(t.bookingAmount),
      paid,
      paidAt: iso(t.paidAt),
      dueAt: iso(t.paymentDueAt),
      method: isPaid(t) || t.paymentRef ? "Card" : null,
      gateway: t.paymentRef ? "Coral (card)" : null,
      reference: t.paymentRef ?? null,
      firstMonth: rent,
      tenantFee,
    },
    split: {
      tenantFee,
      landlordCommission: commission,
      cardFee,
      cardFeePercent: ctx.cardFeePercent,
      landlordPayout,
      payoutDeduction: num(t.payoutDeduction) ?? 0,
      payoutReleasedAt: iso(t.payoutReleasedAt),
      nolsafKeeps,
      refund: t.payoutStatus === "REFUND_DUE" || refunded ? { amount: paid ?? 0, done: refunded } : null,
    },
    balance: {
      expected: num(t.balanceDue) ?? 0,
      state: balanceState(t),
      landlord: t.landlordConfirmedAt ? { amount: num(t.landlordBalanceAmount), method: t.landlordBalanceMethod ?? null, at: iso(t.landlordConfirmedAt) } : null,
      tenant: t.tenantConfirmedAt ? { amount: num(t.tenantBalanceAmount), method: t.tenantBalanceMethod ?? null, at: iso(t.tenantConfirmedAt) } : null,
    },
    remaining: {
      months: remainingMonths,
      amount: round(rent * remainingMonths, currency),
      // Rent after the prepaid months is paid as the parties agree (lease 5.4).
      firstDueOn: remainingMonths > 0 && moveIn ? addMonthsDay(moveIn, upfront) : null,
      paidTo: remainingMonths > 0 ? "Landlord directly, monthly in advance" : null,
    },
    totals: {
      leaseRent: round(rent * term, currency),
      collectedByNolsaf: paid ?? 0,
      paidToLandlordAtMoveIn: num(t.tenantBalanceAmount ?? t.landlordBalanceAmount) ?? 0,
    },
    risk,
  };
}
