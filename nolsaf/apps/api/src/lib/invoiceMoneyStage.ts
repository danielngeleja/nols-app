import { isOwnerSubmittedInvoice } from "./accommodationPayout.js";

/**
 * Money stage of an invoice for reporting. Invoice.status alone cannot tell
 * "the guest paid NoLSAF" from "NoLSAF paid the owner": the payment webhook,
 * the manual mark-paid route and the payout ledger all write PAID, and both the
 * guest gateway and the payout ledger write PROCESSING. The Disbursement row
 * is the only proof money reached the payee, so the stage reads it first.
 */
export const MONEY_STAGES = [
  { key: "AWAITING_GUEST", label: "Awaiting guest payment" },
  { key: "GUEST_PAID", label: "Guest paid, not disbursed" },
  { key: "IN_REVIEW", label: "Payout claim in review" },
  { key: "DISBURSING", label: "Disbursement in progress" },
  { key: "ON_HOLD", label: "Payout on hold" },
  { key: "FAILED", label: "Disbursement failed" },
  { key: "DISBURSED", label: "Disbursed to payee" },
  { key: "REJECTED", label: "Rejected" },
  { key: "OTHER", label: "Draft or other" },
] as const;
export type MoneyStage = (typeof MONEY_STAGES)[number]["key"];
export const MONEY_STAGE_KEYS = new Set<string>(MONEY_STAGES.map((s) => s.key));

const DISBURSEMENT_HOLD = new Set(["SECURITY_REVIEW", "AMOUNT_MISMATCH", "CORRELATION_MISMATCH", "ERROR"]);
const DISBURSEMENT_DONE = new Set(["PAID", "FAILED", "CANCELLED", "CANCELED", "REJECTED"]);

type StageDisbursement = { status: string; paidAt: Date | null };

export function moneyStageOf(
  invoice: { status: string; invoiceNumber: string | null },
  disbursements: StageDisbursement[],
): { stage: MoneyStage; manual: boolean } {
  const status = String(invoice.status || "").toUpperCase();
  if (disbursements.some((d) => String(d.status).toUpperCase() === "PAID")) return { stage: "DISBURSED", manual: false };
  if (status === "REJECTED") return { stage: "REJECTED", manual: false };
  const latest = disbursements[0];
  if (latest) {
    const latestStatus = String(latest.status).toUpperCase();
    if (DISBURSEMENT_HOLD.has(latestStatus)) return { stage: "ON_HOLD", manual: false };
    if (latestStatus === "FAILED") return { stage: "FAILED", manual: false };
    if (!DISBURSEMENT_DONE.has(latestStatus)) return { stage: "DISBURSING", manual: false };
  }
  const ownerClaim = isOwnerSubmittedInvoice(invoice.invoiceNumber);
  switch (status) {
    case "PAID":
      // An owner claim (OINV-) has no guest side, so PAID there is a payout
      // settled outside the ledger. On a booking invoice PAID is the guest's
      // payment, whether the gateway or an admin recorded it.
      return ownerClaim ? { stage: "DISBURSED", manual: true } : { stage: "GUEST_PAID", manual: false };
    case "CUSTOMER_PAID":
      return { stage: "GUEST_PAID", manual: false };
    case "PENDING":
      return { stage: "AWAITING_GUEST", manual: false };
    case "PROCESSING":
      // Without a live disbursement, PROCESSING on a booking invoice is the
      // guest's gateway payment in flight.
      return ownerClaim ? { stage: "DISBURSING", manual: false } : { stage: "AWAITING_GUEST", manual: false };
    case "REQUESTED":
    case "VERIFIED":
    case "APPROVED":
      return { stage: "IN_REVIEW", manual: false };
    default:
      return { stage: "OTHER", manual: false };
  }
}
