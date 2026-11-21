/**
 * What one tenancy is worth to NoLSAF, in one place, so the revenue ledger,
 * the finance overview and the daily reconciliation can never disagree
 * (docs/REVENUE_LEDGER.md, LONG_STAY).
 *
 *  - Moved in: both fees are earned at confirmed move-in.
 *  - Cancelled after payment (section 6.4): what NoLSAF keeps is earned at
 *    the cancellation; what goes back to the tenant was never revenue.
 *  - A first month refunded after move-in is not revenue (the ledger records
 *    the recognition and then its reversal).
 */
const n = (v: unknown) => {
  const x = Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
};

export type LongStayCancellation = {
  by: "TENANT" | "LANDLORD";
  daysToMoveIn: number;
  refundToTenant: number;
  landlordPayout: number;
  nolsafKeeps: number;
};

export function cancellationOf(tenancy: any): LongStayCancellation | null {
  const c = (tenancy?.termsSnapshot as any)?.cancellation;
  return c && typeof c === "object" ? (c as LongStayCancellation) : null;
}

export type LongStayFigures = { at: Date; currency: string; gross: number; commission: number; partnerNet: number; kind: "MOVE_IN" | "CANCELLATION" };

export function longStayRevenueFigures(t: any): LongStayFigures | null {
  if (!t?.paidAt) return null;
  const cancellation = cancellationOf(t);
  if (cancellation) {
    if (!(cancellation.nolsafKeeps > 0) || !t.cancelledAt) return null;
    return {
      at: new Date(t.cancelledAt),
      currency: t.currency,
      gross: Math.max(0, n(t.bookingAmount) - n(cancellation.refundToTenant)),
      commission: n(cancellation.nolsafKeeps),
      partnerNet: n(cancellation.landlordPayout),
      kind: "CANCELLATION",
    };
  }
  if (!t.moveInConfirmedAt) return null;
  if (t.payoutStatus === "REFUND_DUE" || t.payoutStatus === "REFUNDED") return null;
  return {
    at: new Date(t.moveInConfirmedAt),
    currency: t.currency,
    gross: n(t.bookingAmount),
    commission: n(t.tenantFee) + n(t.landlordCommission),
    partnerNet: Math.max(0, n(t.monthlyRent) - n(t.landlordCommission)),
    kind: "MOVE_IN",
  };
}

/** Fields the figures need, for selects. */
export const LONG_STAY_FIGURE_FIELDS = {
  id: true, publicRef: true, currency: true, bookingAmount: true, tenantFee: true, landlordCommission: true, monthlyRent: true,
  moveInConfirmedAt: true, paidAt: true, cancelledAt: true, payoutStatus: true, termsSnapshot: true,
} as const;
