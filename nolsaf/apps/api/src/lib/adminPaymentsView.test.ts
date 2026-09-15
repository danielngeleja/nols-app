import { describe, expect, it } from "vitest";
import { extractPaymentMetadata, extractRecordedPayerAccount, formatPaymentExportTimestamp, maskPaymentAccount } from "./adminPaymentsView.js";

describe("admin payments view privacy", () => {
  it("exports timestamps in EAT with seconds and handles midnight date rollover", () => {
    expect(formatPaymentExportTimestamp("2026-02-27T22:05:40Z")).toBe("2026-02-28 01:05:40 EAT (UTC+3)");
    expect(formatPaymentExportTimestamp(null)).toBe("");
    expect(formatPaymentExportTimestamp("invalid")).toBe("");
  });
  it("returns only recorded bank and transaction metadata", () => {
    expect(extractPaymentMetadata({ bankName: "Example Bank", transactionId: "TX-123", accountNumber: "secret" }))
      .toEqual({ bankName: "Example Bank", providerReference: "TX-123" });
  });

  it("does not confuse event or merchant identifiers with provider transactions", () => {
    expect(extractPaymentMetadata({ eventId: "EVENT-1", paymentRef: "INTERNAL-1" }))
      .toEqual({ bankName: null, providerReference: null });
    expect(extractPaymentMetadata(null, "CHECKOUT-1").providerReference).toBe("CHECKOUT-1");
  });
  it("uses the recorded payment payload before the invoice payer phone", () => {
    expect(extractRecordedPayerAccount(
      { payerPhone: "+255700000000" },
      { payload: { msisdn: "+255765123456" } },
    )).toBe("+255765123456");
  });

  it("does not invent an account from unrelated owner profile data", () => {
    expect(extractRecordedPayerAccount({}, { payload: { ownerPhone: "+255700000000" } })).toBeNull();
  });

  it("masks phone, bank, and short identifiers", () => {
    expect(maskPaymentAccount("+255 765 123 456")).toBe("076*****56");
    expect(maskPaymentAccount("ABCD123456789")).toBe("ABC*****89");
    expect(maskPaymentAccount("1234")).toBe("••••");
  });
});
