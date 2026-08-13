import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { buildProFormaSnapshot, defaultProFormaDates } from "./nrmsProForma.js";
import { generateNrmsProFormaPdf } from "./pdfDocuments.js";

describe("NRMS agency Pro Forma", () => {
  it("quotes the agreed room block and active master extras, less net payments after refunds", () => {
    const snapshot = buildProFormaSnapshot({
      checkIn: new Date("2026-09-10T00:00:00.000Z"),
      checkOut: new Date("2026-09-13T00:00:00.000Z"),
      rooms: [
        { quantity: 4, nightlyRate: 120_000, roomType: { name: "Double" }, ratePlan: { name: "Half board" } },
        { quantity: 2, nightlyRate: 80_000, roomType: { name: "Single" }, ratePlan: null },
      ],
      masterFolio: {
        items: [
          { kind: "ROOM", amount: 120_000, description: "Picked-up room" },
          { kind: "EXTRA", amount: 35_000, description: "Airport transfer" },
          { kind: "EXTRA", amount: 20_000, description: "Voided lunch", voidedAt: new Date() },
        ],
        payments: [
          { amount: 400_000, method: "BANK", reference: "TRX-44", receiptNumber: "MFP-1", createdAt: new Date("2026-08-11T08:00:00Z") },
          { amount: 50_000, method: "CARD", receiptNumber: "MFP-2", createdAt: new Date(), voidedAt: new Date() },
        ],
        refunds: [
          { amount: 100_000, method: "BANK", reference: "RF-44", refundNumber: "MFR-1", createdAt: new Date("2026-08-12T08:00:00Z") },
        ],
      },
    });

    expect(snapshot.items).toEqual([
      expect.objectContaining({ description: "Double", detail: "Half board · 3 nights", quantity: 4, nights: 3, unitRate: 120_000, amount: 1_440_000 }),
      expect.objectContaining({ description: "Single", detail: "3 nights", quantity: 2, nights: 3, unitRate: 80_000, amount: 480_000 }),
      expect.objectContaining({ kind: "EXTRA", description: "Airport transfer", amount: 35_000 }),
    ]);
    expect(snapshot.payments).toHaveLength(2);
    expect(snapshot.payments[1]).toMatchObject({ method: "REFUND · BANK", receiptNumber: "MFR-1", amount: -100_000 });
    expect(snapshot.quotedTotal).toBe(1_955_000);
    expect(snapshot.paidAtIssue).toBe(300_000);
    expect(snapshot.balanceDue).toBe(1_655_000);
  });

  it("defaults payment due to the day before arrival when there is enough notice", () => {
    const dates = defaultProFormaDates("2026-09-10", new Date("2026-08-11T09:00:00Z"));
    expect(dates.dueAt.toISOString()).toBe("2026-09-09T00:00:00.000Z");
    expect(dates.validUntil.toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });

  it("uses tomorrow when the group is arriving too soon", () => {
    const dates = defaultProFormaDates("2026-08-11", new Date("2026-08-11T09:00:00Z"));
    expect(dates.dueAt.toISOString()).toBe("2026-08-12T00:00:00.000Z");
  });

  it("renders a complete, readable PDF document with bank instructions and QR", async () => {
    const qrPng = await QRCode.toBuffer("https://nolsaf.com/nrms/agency/pro-forma/test-token", { type: "png" });
    const pdf = await generateNrmsProFormaPdf({
      number: "PF-2026-000026-R1",
      revision: 1,
      issuedAt: "2026-08-11",
      dueAt: "2026-09-09",
      validUntil: "2026-09-09",
      propertyName: "NoLS Adventure Lodge",
      propertyLocation: "Moshi, Kilimanjaro, Tanzania",
      propertyTin: "123-456-789",
      propertyEmail: "accounts@example.test",
      propertyPhone: "+255 700 000 000",
      billToName: "Serengeti Adventures Limited",
      contactName: "Agency Accounts",
      contactEmail: "accounts@agency.test",
      contactPhone: "+255 710 000 000",
      groupName: "Kilimanjaro September Group",
      groupReference: "BLK-TEST-PF",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      currency: "TZS",
      items: [
        { description: "Double room", detail: "Half board · 3 nights", quantity: 4, nights: 3, unitRate: 120_000, amount: 1_440_000 },
        { description: "Airport transfer", detail: "Agency-billed incidental", quantity: 1, unitRate: 35_000, amount: 35_000 },
      ],
      payments: [{ date: "2026-08-11", method: "BANK", reference: "TRX-44", receiptNumber: "MFP-1", amount: 400_000 }],
      quotedTotal: 1_475_000,
      paidAtIssue: 400_000,
      balanceDue: 1_075_000,
      bankName: "CRDB BANK",
      bankAccountName: "NoLS Adventure Lodge Limited",
      bankAccountNumber: "0150123456789",
      bankBranch: "Moshi",
      bankSource: "MANUAL_UNVERIFIED",
      bankCurrency: "USD",
      bankAddress: "Moshi, Tanzania",
      bankSwiftCode: "TESTTZTZ",
      bankIban: "TZ00TEST00000150123456789",
      bankRoutingCode: "001",
      bankInstructions: "Confirm these manual instructions directly with the property before transferring funds.",
      paymentReference: "PF-2026-000026-R1",
      notes: "Please send the transfer advice to the property after payment.",
      verificationUrl: "https://nolsaf.com/nrms/agency/pro-forma/test-token",
      qrPng,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});
