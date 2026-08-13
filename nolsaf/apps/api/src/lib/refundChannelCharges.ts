export const REFUND_CHANNEL_POLICY = {
  /** Card acquiring fees are not returned by the gateway when a payment is refunded. */
  cardSurchargePercent: 6,
  /** Flat administrative charge per processed refund, in the booking currency (TZS). */
  adminChargeFlat: 25_000,
  /** Refunds inside the 24h cooling-off window stay a true 100 percent refund. */
  fullGraceExempt: true,
} as const;

export type RefundChannel = "CARD" | "MOBILE_MONEY" | "BANK" | "CASH_MANUAL";

export type RefundChannelCharges = {
  channel: RefundChannel;
  exempt: boolean;
  exemptReason: "FULL_GRACE" | "OPERATOR_CAUSED" | "PRE_POLICY_BOOKING" | null;
  grossRefundAmount: number;
  cardSurcharge: number;
  bankCharges: number;
  adminCharge: number;
  totalCharges: number;
  netRefundAmount: number;
  policyVersion: string;
};

export const REFUND_CHANNEL_POLICY_VERSION = "2026-07-12";

const round2 = (value: number) => Math.round(value * 100) / 100;

const MOBILE_MONEY_PROVIDERS = new Set(["AIRTEL", "TIGO", "MPESA", "M-PESA", "HALOPESA", "AZAMPESA", "MIXX", "MIXX BY YAS"]);

/**
 * CoralCommerce is card-only; AzamPay covers mobile money (payer phone
 * recorded), bank, and card rails. Accommodation invoices store the method as
 * the network or instrument name instead of the gateway, so those are
 * recognised directly.
 */
export function inferRefundChannel(paymentProvider: string | null | undefined, payerPhone?: string | null): RefundChannel {
  const provider = String(paymentProvider || "").trim().toUpperCase();
  if (provider === "CORALCOMMERCE") return "CARD";
  if (provider === "AZAMPAY") return payerPhone ? "MOBILE_MONEY" : "BANK";
  if (MOBILE_MONEY_PROVIDERS.has(provider) || provider.includes("MOBILE")) return "MOBILE_MONEY";
  if (provider.includes("CARD") || provider.includes("VISA") || provider.includes("MASTERCARD")) return "CARD";
  if (provider.includes("BANK")) return "BANK";
  return "CASH_MANUAL";
}

/**
 * Method-specific refund costs, openly itemised:
 *  - Card: fixed surcharge percent (gateway acquiring fees are not returned) plus the admin charge.
 *  - Mobile money / bank / forex: the actual charges debited by NoLSAF's bankers, entered at
 *    refund-recording time, plus the admin charge.
 *  - Cash or manual: the admin charge plus any actual bank charges incurred.
 *  - Exempt: FULL_GRACE cooling-off refunds, operator-caused cancellations
 *    (policy 4A.7: no fee or cost is deducted from an operator-caused refund),
 *    and bookings made before this charges policy existed (policy 10.2: the
 *    version accepted at booking time governs).
 */
export function calculateRefundChannelCharges(input: {
  grossRefundAmount: number;
  channel: RefundChannel;
  eligibilityCode?: string | null;
  actualBankCharges?: number | null;
  operatorCaused?: boolean;
  chargesAcceptedAtBooking?: boolean;
}): RefundChannelCharges {
  const gross = Math.max(0, Number(input.grossRefundAmount) || 0);
  const exemptReason: RefundChannelCharges["exemptReason"] =
    input.chargesAcceptedAtBooking === false ? "PRE_POLICY_BOOKING"
    : input.operatorCaused ? "OPERATOR_CAUSED"
    : REFUND_CHANNEL_POLICY.fullGraceExempt && ["FULL_GRACE", "FREE_24H_72H"].includes(String(input.eligibilityCode || "").toUpperCase()) ? "FULL_GRACE"
    : null;
  const exempt = exemptReason !== null;
  if (exempt || gross === 0) {
    return {
      channel: input.channel, exempt, exemptReason, grossRefundAmount: gross,
      cardSurcharge: 0, bankCharges: 0, adminCharge: 0, totalCharges: 0,
      netRefundAmount: gross, policyVersion: REFUND_CHANNEL_POLICY_VERSION,
    };
  }
  const cardSurcharge = input.channel === "CARD" ? round2(gross * REFUND_CHANNEL_POLICY.cardSurchargePercent / 100) : 0;
  const bankCharges = input.channel === "CARD" ? 0 : round2(Math.max(0, Number(input.actualBankCharges) || 0));
  const adminCharge = REFUND_CHANNEL_POLICY.adminChargeFlat;
  const totalCharges = round2(Math.min(gross, cardSurcharge + bankCharges + adminCharge));
  return {
    channel: input.channel, exempt, exemptReason, grossRefundAmount: gross,
    cardSurcharge, bankCharges, adminCharge, totalCharges,
    netRefundAmount: round2(gross - totalCharges), policyVersion: REFUND_CHANNEL_POLICY_VERSION,
  };
}
