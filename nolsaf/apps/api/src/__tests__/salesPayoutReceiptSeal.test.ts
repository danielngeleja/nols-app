import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.PUBLIC_LINK_TOKEN_SECRET = process.env.PUBLIC_LINK_TOKEN_SECRET || "test-public-link-secret-at-least-32-chars";
  process.env.WEB_ORIGIN = "https://nolsaf.com";
});

const input = () => ({
  referenceNumber: "SP-2026-11-4F2A9C",
  partnerName: "Amina Mushi",
  agentCode: "SP-24017",
  earningsCount: 3,
  approvedAmount: 200000,
  requestedAmount: 200000,
  deductionAmount: 0,
  withholdingTaxRate: 5,
  withholdingTaxAmount: 10000,
  netPaidAmount: 190000,
  currency: "TZS",
  payoutMethod: "Vodacom",
  payoutAccount: "255754123456",
  paymentReference: "S-AZP-77Q1",
  providerReference: "MPESA-QK81Z",
  paidAt: new Date("2026-11-08T10:15:00Z"),
});

describe("sales payout receipt seal", () => {
  it("builds the same snapshot every time, with no database id and a masked account", async () => {
    const { buildSalesPayoutReceiptSnapshot } = await import("../lib/salesPayoutReceiptSeal.js");
    const a = buildSalesPayoutReceiptSnapshot(input());
    const b = buildSalesPayoutReceiptSnapshot(input());
    expect(a).toEqual(b);
    expect(a.receiptNumber).toBe("RCPT-2026-11-4F2A9C");
    expect(a.maskedDestination).not.toContain("255754");
    expect(a.maskedDestination.endsWith("3456")).toBe(true);
    expect(a.netPaid).toBe(190000);
  });

  it("verifies its own seal, rejects a tampered one, and never passes as an owner receipt", async () => {
    const seal = await import("../lib/salesPayoutReceiptSeal.js");
    const owner = await import("../lib/ownerPayoutReceiptSeal.js");
    const token = seal.signSalesPayoutReceipt(seal.buildSalesPayoutReceiptSnapshot(input()));
    expect(seal.verifySalesPayoutReceipt(token)).toMatchObject({ typ: "SALES_PAYOUT_RECEIPT", amount: 190000, receiptNumber: "RCPT-2026-11-4F2A9C" });
    const [header, payload, signature] = token.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), amount: 9_000_000 })).toString("base64url");
    expect(seal.verifySalesPayoutReceipt(`${header}.${tampered}.${signature}`)).toBeNull();
    expect(owner.verifyOwnerPayoutReceipt(token)).toBeNull();
    expect(seal.buildSalesPayoutReceiptVerificationUrl(token)).toMatch(/^https:\/\/nolsaf\.com\/verify\/payout\?t=/);
  });

  it("draws the receipt as a PDF", async () => {
    const { generateSalesPayoutReceiptPdf } = await import("../lib/pdfDocuments.js");
    const { buildSalesPayoutReceiptSnapshot } = await import("../lib/salesPayoutReceiptSeal.js");
    const s = buildSalesPayoutReceiptSnapshot(input());
    const pdf = await generateSalesPayoutReceiptPdf({ ...s, paidAt: s.settledAt });
    expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
  });
});
