import { describe, expect, it } from "vitest";
import { buildNrmsDocumentNumber, generateNrmsInvoicePdf } from "./pdfDocuments.js";

describe("NRMS receipt documents", () => {
  it("builds the enforced room-random-timestamp-bill reference", () => {
    const receiptNumber = buildNrmsDocumentNumber(5, "2026-07-15T08:30:00.000Z", "Double", "10", "K7Q");
    expect(receiptNumber).toBe("ND10-K7Q-26071511-00005");
    expect(receiptNumber).toMatch(/^N[A-Z0-9][A-Z0-9]{2}-[A-HJ-NP-Z2-9]{3}-\d{8}-[A-Z0-9]{5}$/);
  });

  it("renders a paid A5 receipt with the structured reference and barcode", async () => {
    const pdf = await generateNrmsInvoicePdf({
      invoiceNumber: "ND10-K7Q-26071511-00005",
      issuedAt: "2026-07-15T08:30:00.000Z",
      reservationId: 5,
      status: "CHECKED_OUT",
      propertyName: "Sheraton Hotel",
      propertyLocation: "Temeke, Dar es Salaam, TZ",
      guestName: "Adam Hawa",
      guestPhone: "+255 736 766 312",
      checkIn: "2026-07-15T12:00:00.000Z",
      checkOut: "2026-07-16T10:00:00.000Z",
      rooms: [{ label: "Double-10" }],
      currency: "TZS",
      roomTotal: 66_000,
      charges: [{ date: "2026-07-15T18:00:00.000Z", category: "BAR", description: "Bar drinks", amount: 50_000 }],
      payments: [
        { date: "2026-07-15T08:30:00.000Z", method: "CASH", reference: "CASH-0005", amount: 101_000 },
        { date: "2026-07-15T18:15:00.000Z", method: "MOBILE_MONEY", reference: "MM-0005", amount: 15_000 },
      ],
      outletPayments: [
        {
          date: "2026-07-15T18:30:00.000Z",
          orderNumber: "BAR-260715-434482",
          outlet: "Sheraton Bar",
          method: "CARD",
          items: "1× Jack Daniels",
          amount: 20_000,
        },
        {
          date: "2026-07-15T19:30:00.000Z",
          orderNumber: "BAR-260715-434483",
          outlet: "Sheraton Bar",
          method: "MOBILE_MONEY",
          items: "2× Fresh juice",
          amount: 9_000,
        },
      ],
      chargesTotal: 50_000,
      amountPaid: 116_000,
      balanceDue: 0,
    });

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(3_000);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(1);
  });

  it("paginates long receipt descriptions without producing an oversized PDF", async () => {
    const outletPayments = Array.from({ length: 32 }, (_, index) => ({
      date: `2026-07-${String(10 + (index % 8)).padStart(2, "0")}T18:30:00.000Z`,
      orderNumber: `RST-260717-${String(index + 1).padStart(6, "0")}`,
      outlet: "Sheraton Main Restaurant",
      method: index % 2 ? "MOBILE_MONEY" : "CARD",
      items: "3× Nyama Choma with seasonal vegetables, 2× Chips Kuku and fresh juice",
      amount: 25_000,
    }));
    const outletTotal = outletPayments.reduce((sum, payment) => sum + payment.amount, 0);
    const pdf = await generateNrmsInvoicePdf({
      invoiceNumber: "NF13-K7Q-26071811-00006",
      issuedAt: "2026-07-18T08:30:00.000Z",
      reservationId: 6,
      status: "CHECKED_OUT",
      propertyName: "Sheraton Hotel",
      guestName: "Large Folio Guest",
      checkIn: "2026-07-11T12:00:00.000Z",
      checkOut: "2026-07-18T10:00:00.000Z",
      rooms: [{ label: "Family-13" }],
      currency: "TZS",
      roomTotal: 525_000,
      charges: [],
      payments: [{ date: "2026-07-18T08:30:00.000Z", method: "CASH", amount: 525_000 }],
      outletPayments,
      chargesTotal: 0,
      amountPaid: 525_000,
      balanceDue: 0,
    });

    expect(outletTotal).toBe(800_000);
    expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)?.length ?? 0).toBeGreaterThan(1);
    expect(pdf.length).toBeLessThan(2_000_000);
  });
});
