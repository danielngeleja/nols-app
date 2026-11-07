/**
 * Sales partner payout receipt seal: the same receipt flow as owner payouts
 * (ownerPayoutReceiptSeal.ts). The receipt is built from a snapshot of the
 * PAID payout, the snapshot is hashed and signed, and the QR on the receipt
 * opens /verify/payout, where anyone can check the signed facts.
 *
 * A PAID payout never changes again (amount, account, provider reference and
 * paid time are final), so the snapshot is rebuilt deterministically from the
 * row each time and always produces the same seal. Nothing extra is stored.
 */
import { createHash } from "node:crypto";
import jwt, { type Algorithm } from "jsonwebtoken";
import { publicLinkSigningSecret, verifyWithAnyPublicLinkSecret } from "./publicLinkSecrets.js";
import { maskPayoutDestination } from "./ownerPayoutReceiptSeal.js";

export const SALES_PAYOUT_RECEIPT_TIME_ZONE = "Africa/Dar_es_Salaam";
export const SALES_PAYOUT_RECEIPT_DISCLAIMER =
  "This is a NoLSAF payout confirmation, not an AzamPay, bank, or mobile-network-issued receipt.";

export type SalesPayoutReceiptSnapshot = {
  version: 1;
  documentType: "SALES_PAYOUT_CONFIRMATION";
  issuer: "NoLS Africa Co Ltd";
  receiptNumber: string;
  withdrawalReference: string;
  partnerName: string;
  agentCode: string;
  earningsCount: number;
  grossAmount: number;
  deductionAmount: number;
  withholdingTaxRate: number | null;
  withholdingTaxAmount: number;
  netPaid: number;
  currency: string;
  paymentMethod: string;
  providerReference: string;
  nolsafReference: string;
  maskedDestination: string;
  settledAt: string;
  issuedAt: string;
  timeZone: typeof SALES_PAYOUT_RECEIPT_TIME_ZONE;
  disclaimer: typeof SALES_PAYOUT_RECEIPT_DISCLAIMER;
};

export type SalesPayoutReceiptSealPayload = {
  typ: "SALES_PAYOUT_RECEIPT";
  issuer: "NoLS Africa Co Ltd";
  receiptNumber: string;
  withdrawalReference: string;
  partnerName: string;
  amount: number;
  currency: string;
  paymentMethod: string;
  providerReference: string;
  nolsafReference: string;
  maskedDestination: string;
  settledAt: string;
  issuedAt: string;
  timeZone: typeof SALES_PAYOUT_RECEIPT_TIME_ZONE;
  snapshotHash: string;
  disclaimer: typeof SALES_PAYOUT_RECEIPT_DISCLAIMER;
};

const ISSUER = "nolsaf-public";
const AUDIENCE = "sales-payout-receipt-verification";
const ALGORITHMS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 4096;

/** RCPT-2026-11-4F2A9C from SP-2026-11-4F2A9C: no database id on the document. */
export function salesReceiptNumber(referenceNumber: string): string {
  return `RCPT-${String(referenceNumber).replace(/^SP-/, "")}`;
}

export function buildSalesPayoutReceiptSnapshot(input: {
  referenceNumber: string;
  partnerName: string;
  agentCode: string;
  earningsCount: number;
  approvedAmount: unknown;
  requestedAmount: unknown;
  deductionAmount: unknown;
  withholdingTaxRate: unknown;
  withholdingTaxAmount: unknown;
  netPaidAmount: unknown;
  currency: string;
  payoutMethod: string;
  payoutAccount: string;
  paymentReference: string;
  providerReference?: string | null;
  paidAt: Date;
}): SalesPayoutReceiptSnapshot {
  const settledAt = input.paidAt.toISOString();
  return {
    version: 1,
    documentType: "SALES_PAYOUT_CONFIRMATION",
    issuer: "NoLS Africa Co Ltd",
    receiptNumber: salesReceiptNumber(input.referenceNumber),
    withdrawalReference: input.referenceNumber,
    partnerName: input.partnerName,
    agentCode: input.agentCode,
    earningsCount: input.earningsCount,
    grossAmount: Number(input.approvedAmount ?? input.requestedAmount ?? 0),
    deductionAmount: Number(input.deductionAmount ?? 0),
    withholdingTaxRate: input.withholdingTaxRate == null ? null : Number(input.withholdingTaxRate),
    withholdingTaxAmount: Number(input.withholdingTaxAmount ?? 0),
    netPaid: Number(input.netPaidAmount ?? 0),
    currency: input.currency || "TZS",
    paymentMethod: input.payoutMethod || "Not recorded",
    providerReference: input.providerReference || input.paymentReference || "Not recorded",
    nolsafReference: input.paymentReference || input.referenceNumber,
    maskedDestination: input.payoutAccount ? maskPayoutDestination(input.payoutAccount) : "Not recorded",
    settledAt,
    issuedAt: settledAt,
    timeZone: SALES_PAYOUT_RECEIPT_TIME_ZONE,
    disclaimer: SALES_PAYOUT_RECEIPT_DISCLAIMER,
  };
}

export function salesPayoutReceiptSnapshotHash(snapshot: SalesPayoutReceiptSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

export function signSalesPayoutReceipt(snapshot: SalesPayoutReceiptSnapshot): string {
  const payload: SalesPayoutReceiptSealPayload = {
    typ: "SALES_PAYOUT_RECEIPT",
    issuer: snapshot.issuer,
    receiptNumber: snapshot.receiptNumber,
    withdrawalReference: snapshot.withdrawalReference,
    partnerName: snapshot.partnerName,
    amount: snapshot.netPaid,
    currency: snapshot.currency,
    paymentMethod: snapshot.paymentMethod,
    providerReference: snapshot.providerReference,
    nolsafReference: snapshot.nolsafReference,
    maskedDestination: snapshot.maskedDestination,
    settledAt: snapshot.settledAt,
    issuedAt: snapshot.issuedAt,
    timeZone: snapshot.timeZone,
    snapshotHash: salesPayoutReceiptSnapshotHash(snapshot),
    disclaimer: snapshot.disclaimer,
  };
  // Payout receipts are permanent accounting records, so the seal has no expiry.
  return jwt.sign(payload, publicLinkSigningSecret("sales_payout_receipt_seal_secret_missing"), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
    noTimestamp: true,
  });
}

export function verifySalesPayoutReceipt(token: string): SalesPayoutReceiptSealPayload | null {
  try {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = verifyWithAnyPublicLinkSecret<SalesPayoutReceiptSealPayload>(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
    });
    if (
      !decoded ||
      decoded.typ !== "SALES_PAYOUT_RECEIPT" ||
      decoded.issuer !== "NoLS Africa Co Ltd" ||
      !decoded.receiptNumber ||
      !decoded.snapshotHash ||
      !Number.isFinite(Number(decoded.amount))
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function webOrigin(): string {
  return String(process.env.WEB_ORIGIN || process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://nolsaf.com").replace(/\/+$/, "");
}

/** Same verification page as owner payouts. */
export function buildSalesPayoutReceiptVerificationUrl(token: string): string {
  return `${webOrigin()}/verify/payout?t=${encodeURIComponent(token)}`;
}
