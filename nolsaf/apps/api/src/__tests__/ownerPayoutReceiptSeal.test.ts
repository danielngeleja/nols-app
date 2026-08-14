import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOwnerPayoutReceiptVerificationUrl,
  createOwnerPayoutReceiptSnapshot,
  maskPayoutDestination,
  signOwnerPayoutReceipt,
  verifyOwnerPayoutReceipt,
} from "../lib/ownerPayoutReceiptSeal";

function snapshot() {
  return createOwnerPayoutReceiptSnapshot({
    receiptNumber: "RCPT-202608-0000123",
    invoiceId: 123,
    invoiceNumber: "OINV-202608-000123-0042",
    ownerId: 44,
    ownerName: "Asha Mtumwa",
    ownerEmail: "owner@example.com",
    bookingId: 123,
    bookingCode: "BOOK-123",
    propertyName: "NoLSAF Lodge",
    checkIn: "2026-08-08T12:00:00.000Z",
    checkOut: "2026-08-10T12:00:00.000Z",
    totalRevenue: 160000,
    commissionPercent: 6.25,
    commissionAmount: 10000,
    taxPercent: null,
    taxAmount: null,
    netPayable: 150000,
    currency: "TZS",
    paymentMethod: "azampesa",
    payoutProvider: "azampay",
    providerReference: "FSP-77",
    nolsafReference: "NoLSAF-O-2608081645-D51QVX",
    maskedDestination: maskPayoutDestination("255700000001"),
    settledAt: "2026-08-08T13:00:00.000Z",
    issuedAt: "2026-08-08T13:00:00.000Z",
  });
}

describe("owner payout receipt seal", () => {
  beforeEach(() => {
    vi.stubEnv("PUBLIC_LINK_TOKEN_SECRET", "test-owner-payout-receipt-secret-at-least-32-bytes");
    vi.stubEnv("WEB_ORIGIN", "https://nolsaf.example");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("signs a permanent receipt snapshot and verifies its settlement facts", () => {
    const token = signOwnerPayoutReceipt(snapshot());
    const verified = verifyOwnerPayoutReceipt(token);

    expect(verified).toEqual(expect.objectContaining({
      typ: "OWNER_PAYOUT_RECEIPT",
      receiptNumber: "RCPT-202608-0000123",
      amount: 150000,
      providerReference: "FSP-77",
      maskedDestination: "•••••••• 0001",
      timeZone: "Africa/Dar_es_Salaam",
    }));
    expect(verified?.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects a token whose signed payload was altered", () => {
    const token = signOwnerPayoutReceipt(snapshot());
    const [header, payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.amount = 950000;
    const tamperedPayload = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url");

    expect(verifyOwnerPayoutReceipt(`${header}.${tamperedPayload}.${signature}`)).toBeNull();
  });

  it("builds a public verification URL without exposing the destination account", () => {
    const token = signOwnerPayoutReceipt(snapshot());
    const url = buildOwnerPayoutReceiptVerificationUrl(token);

    expect(url).toContain("https://nolsaf.example/verify/payout?t=");
    expect(url).not.toContain("255700000001");
  });
});
