import { describe, expect, it } from "vitest";
import { masterStatementMeta, renderMasterStatementPdf } from "./nrmsMasterStatement.js";

function block(status: "OPEN" | "SETTLED" = "OPEN") {
  return {
    id: 3,
    name: "Kilimanjaro Agency Group",
    reference: "BLK-TEST-1",
    checkIn: new Date("2026-09-10T00:00:00.000Z"),
    checkOut: new Date("2026-09-13T00:00:00.000Z"),
    property: { title: "Sheraton Hotel", city: "Dar es Salaam", country: "Tanzania" },
    owner: { email: "accounts@property.test", phone: "+255700000000" },
    masterFolio: {
      id: 8,
      reference: "MF-BLK-TEST-1",
      billingMode: "SPLIT",
      billToName: "Serengeti Adventures Limited",
      contactName: "Agency Accounts",
      contactEmail: "accounts@agency.test",
      currency: "TZS",
      status,
      settledAt: status === "SETTLED" ? new Date("2026-09-13T09:00:00.000Z") : null,
      items: [
        { kind: "ROOM", description: "Room stay 101", amount: 450_000, createdAt: new Date("2026-09-10T08:00:00.000Z") },
      ],
      payments: [
        { method: "BANK", amount: status === "SETTLED" ? 500_000 : 300_000, receiptNumber: "MFP-8-1", createdAt: new Date("2026-09-09T08:00:00.000Z") },
      ],
      refunds: status === "SETTLED"
        ? [{ method: "BANK", amount: 50_000, reason: "Room adjustment", refundNumber: "MFR-8-1", createdAt: new Date("2026-09-13T08:00:00.000Z") }]
        : [],
    },
  };
}

describe("NRMS master account statement", () => {
  it("uses a statement while money is due and a stable final receipt after settlement", () => {
    expect(masterStatementMeta(block("OPEN"), new Date("2026-09-11T10:00:00.000Z"))).toMatchObject({
      settled: false,
      title: "AGENCY ACCOUNT STATEMENT",
      number: "MFS-000008-20260911",
    });
    expect(masterStatementMeta(block("SETTLED"), new Date("2026-09-14T10:00:00.000Z"))).toMatchObject({
      settled: true,
      title: "FINAL PAYMENT RECEIPT",
      number: "MFR-000008-20260913",
    });
  });

  it("renders the consolidated final receipt as a readable PDF", async () => {
    const rendered = await renderMasterStatementPdf(block("SETTLED"), new Date("2026-09-14T10:00:00.000Z"));
    expect(rendered.title).toBe("FINAL PAYMENT RECEIPT");
    expect(rendered.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(rendered.pdf.length).toBeGreaterThan(3_000);
  });
});
