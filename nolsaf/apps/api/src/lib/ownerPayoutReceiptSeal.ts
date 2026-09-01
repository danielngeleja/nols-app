import { createHash } from "node:crypto";
import jwt, { type Algorithm } from "jsonwebtoken";
import { publicLinkSigningSecret, verifyWithAnyPublicLinkSecret } from "./publicLinkSecrets.js";

export const OWNER_PAYOUT_RECEIPT_TIME_ZONE = "Africa/Dar_es_Salaam";
export const OWNER_PAYOUT_RECEIPT_DISCLAIMER =
  "This is a NoLSAF payout confirmation, not an AzamPay, bank, or mobile-network-issued receipt.";

export type OwnerPayoutReceiptSnapshot = {
  version: 1;
  documentType: "OWNER_PAYOUT_CONFIRMATION";
  issuer: "NoLS Africa Co Ltd";
  receiptNumber: string;
  invoiceId: number;
  invoiceNumber: string;
  ownerId: number;
  ownerName: string;
  ownerEmail: string | null;
  bookingId: number;
  bookingCode: string | null;
  propertyName: string;
  checkIn: string;
  checkOut: string;
  totalRevenue: number;
  commissionPercent: number | null;
  commissionAmount: number | null;
  taxPercent: number | null;
  taxAmount: number | null;
  netPayable: number;
  currency: string;
  paymentMethod: string;
  payoutProvider: string;
  providerReference: string;
  nolsafReference: string;
  maskedDestination: string;
  settledAt: string;
  issuedAt: string;
  timeZone: typeof OWNER_PAYOUT_RECEIPT_TIME_ZONE;
  disclaimer: typeof OWNER_PAYOUT_RECEIPT_DISCLAIMER;
};

export type OwnerPayoutReceiptSealPayload = {
  typ: "OWNER_PAYOUT_RECEIPT";
  issuer: "NoLS Africa Co Ltd";
  receiptNumber: string;
  invoiceNumber: string;
  amount: number;
  currency: string;
  provider: string;
  providerReference: string;
  nolsafReference: string;
  maskedDestination: string;
  propertyName: string;
  settledAt: string;
  issuedAt: string;
  timeZone: typeof OWNER_PAYOUT_RECEIPT_TIME_ZONE;
  snapshotHash: string;
  disclaimer: typeof OWNER_PAYOUT_RECEIPT_DISCLAIMER;
};

export type CreateOwnerPayoutReceiptSnapshotInput = Omit<
  OwnerPayoutReceiptSnapshot,
  "version" | "documentType" | "issuer" | "timeZone" | "disclaimer"
>;

const ISSUER = "nolsaf-public";
const AUDIENCE = "owner-payout-receipt-verification";
const ALGORITHMS: Algorithm[] = ["HS256"];
const MAX_TOKEN_LENGTH = 4096;

function signingSecret(): string {
  return publicLinkSigningSecret("owner_payout_receipt_seal_secret_missing");
}

export function maskPayoutDestination(value: string): string {
  const clean = String(value || "").replace(/\s+/g, "");
  if (!clean) return "Not recorded";
  const visible = clean.slice(-4);
  return `${"•".repeat(Math.max(4, Math.min(8, clean.length - visible.length)))} ${visible}`;
}

export function createOwnerPayoutReceiptSnapshot(
  input: CreateOwnerPayoutReceiptSnapshotInput
): OwnerPayoutReceiptSnapshot {
  return {
    version: 1,
    documentType: "OWNER_PAYOUT_CONFIRMATION",
    issuer: "NoLS Africa Co Ltd",
    ...input,
    timeZone: OWNER_PAYOUT_RECEIPT_TIME_ZONE,
    disclaimer: OWNER_PAYOUT_RECEIPT_DISCLAIMER,
  };
}

export function ownerPayoutReceiptSnapshotHash(snapshot: OwnerPayoutReceiptSnapshot): string {
  return createHash("sha256").update(JSON.stringify(snapshot), "utf8").digest("hex");
}

export function signOwnerPayoutReceipt(snapshot: OwnerPayoutReceiptSnapshot): string {
  const payload: OwnerPayoutReceiptSealPayload = {
    typ: "OWNER_PAYOUT_RECEIPT",
    issuer: snapshot.issuer,
    receiptNumber: snapshot.receiptNumber,
    invoiceNumber: snapshot.invoiceNumber,
    amount: snapshot.netPayable,
    currency: snapshot.currency,
    provider: snapshot.payoutProvider,
    providerReference: snapshot.providerReference,
    nolsafReference: snapshot.nolsafReference,
    maskedDestination: snapshot.maskedDestination,
    propertyName: snapshot.propertyName,
    settledAt: snapshot.settledAt,
    issuedAt: snapshot.issuedAt,
    timeZone: snapshot.timeZone,
    snapshotHash: ownerPayoutReceiptSnapshotHash(snapshot),
    disclaimer: snapshot.disclaimer,
  };
  // Payout receipts are permanent accounting records, so the seal has no expiry.
  return jwt.sign(payload, signingSecret(), {
    issuer: ISSUER,
    audience: AUDIENCE,
    algorithm: "HS256",
    noTimestamp: true,
  });
}

export function verifyOwnerPayoutReceipt(token: string): OwnerPayoutReceiptSealPayload | null {
  try {
    if (!token || token.length > MAX_TOKEN_LENGTH) return null;
    const decoded = verifyWithAnyPublicLinkSecret<OwnerPayoutReceiptSealPayload>(token, {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ALGORITHMS,
    });
    if (!decoded) return null;
    if (
      decoded?.typ !== "OWNER_PAYOUT_RECEIPT" ||
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
  return String(
    process.env.WEB_ORIGIN ||
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      "https://nolsaf.com"
  ).replace(/\/+$/, "");
}

export function buildOwnerPayoutReceiptVerificationUrl(token: string): string {
  return `${webOrigin()}/verify/payout?t=${encodeURIComponent(token)}`;
}
