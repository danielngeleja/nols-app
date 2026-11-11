import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./fx.js", () => ({
  BASE_CURRENCY: "TZS",
  getFxRates: vi.fn(async () => ({ tzsPerUnit: { TZS: 1, USD: 2600 } })),
}));

import {
  recognizeGroupStayRevenue,
  recognizeInvoiceRevenue,
  recognizeNrmsPaymentRevenue,
  recognizeTourRevenue,
  recognizeTransportRevenue,
  reverseAccommodationChargeback,
  reverseAccommodationRefund,
  reverseTourRefund,
} from "./revenueRecognition.js";

const PAID_AT = new Date("2026-11-03T21:10:00Z"); // 00:10 EAT on 4 November

/** Source tables plus an in-memory revenue_entry with UNIQUE(sourceKey). */
function fakeDb(seed: Partial<Record<string, any[]>> = {}) {
  const ledger: any[] = [];
  let nextId = 1;
  const table = (name: string) => seed[name] ?? [];
  const byId = (name: string) => vi.fn(async ({ where }: any) => table(name).find((r) => r.id === where.id) ?? null);
  return {
    ledger,
    invoice: {
      findUnique: byId("invoice"),
      findMany: vi.fn(async ({ where }: any) =>
        table("invoice").filter((r) => r.bookingId === where.bookingId && !String(r.invoiceNumber ?? "").startsWith("OINV-")).sort((a, b) => a.id - b.id)),
    },
    tourBooking: { findUnique: byId("tourBooking") },
    tourFinancialTransaction: { findUnique: byId("tourFinancialTransaction") },
    groupBooking: { findUnique: byId("groupBooking") },
    transportBooking: { findUnique: byId("transportBooking") },
    nrmsServicePayment: { findUnique: byId("nrmsServicePayment") },
    cancellationRequest: { findUnique: byId("cancellationRequest") },
    paymentEvent: {
      findFirst: vi.fn(async ({ where }: any) => {
        const rows = table("paymentEvent").filter((e) => e.status === where.status && Object.entries(where).every(([k, v]) => k === "status" || e[k] === v));
        return rows.sort((a, b) => b.id - a.id)[0] ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => table("paymentEvent").find((e) => e.eventId === where.eventId) ?? null),
    },
    revenueEntry: {
      findUnique: vi.fn(async ({ where }: any) => ledger.find((r) => r.sourceKey === where.sourceKey) ?? null),
      findMany: vi.fn(async ({ where }: any) => ledger.filter((r) => r.reversesId === where.reversesId)),
      create: vi.fn(async ({ data }: any) => {
        if (ledger.some((r) => r.sourceKey === data.sourceKey)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const row = { id: nextId++, ...data };
        ledger.push(row);
        return row;
      }),
    },
    $queryRaw: vi.fn(async () => []),
  };
}

const paidInvoice = { id: 10, bookingId: 500, invoiceNumber: "INV-202611-000500-0001", status: "PAID", total: 230000, commissionAmount: 30000, netPayable: 200000, paidAt: PAID_AT, issuedAt: new Date("2026-11-01T08:00:00Z") };

describe("accommodation", () => {
  let db: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    db = fakeDb({
      invoice: [paidInvoice, { id: 11, bookingId: 500, invoiceNumber: "OINV-202611-000500", status: "PAID", total: 200000, commissionAmount: null, netPayable: 200000, paidAt: PAID_AT }],
      paymentEvent: [{ id: 70, invoiceId: 10, status: "FAILED" }, { id: 71, invoiceId: 10, status: "SUCCESS" }],
      cancellationRequest: [{ id: 3, bookingId: 500, status: "REFUNDED", refundAmount: 115000, refundChargesJson: { netRefundAmount: 90000 }, refundedAt: new Date("2026-11-20T10:00:00Z") }],
    });
  });

  it("recognizes a paid booking invoice once, however many times the webhook is replayed", async () => {
    const first = await recognizeInvoiceRevenue(db, 10, { priorStatus: "PROCESSING" });
    const replay = await recognizeInvoiceRevenue(db, 10);
    expect(first.status).toBe("created");
    expect(replay.status).toBe("existing");
    expect(db.ledger).toHaveLength(1);
    expect(db.ledger[0]).toMatchObject({ sourceKey: "ACCOMMODATION:INVOICE:10", paymentEventId: 71, recognizedAt: PAID_AT });
    expect(db.ledger[0].businessDate.toISOString()).toBe("2026-11-04T00:00:00.000Z");
    expect(Number(db.ledger[0].commission)).toBe(30000);
  });

  it("does not treat an owner claim (OINV-) as revenue", async () => {
    expect(await recognizeInvoiceRevenue(db, 11)).toMatchObject({ status: "skipped", reason: "OWNER_CLAIM" });
    expect(db.ledger).toHaveLength(0);
  });

  it("does not treat PAID on an invoice the guest had already paid as new revenue", async () => {
    expect(await recognizeInvoiceRevenue(db, 10, { priorStatus: "APPROVED" })).toMatchObject({ status: "skipped", reason: "ALREADY_GUEST_PAID" });
    expect(db.ledger).toHaveLength(0);
  });

  it("reverses the net refund paid to the guest, in proportion, recognizing the invoice first when the ledger has not seen it", async () => {
    const result = await reverseAccommodationRefund(db, 3);
    expect(result.status).toBe("created");
    expect(db.ledger.map((r) => r.entryType)).toEqual(["RECOGNIZED", "REVERSAL"]);
    const reversal = db.ledger[1];
    expect(reversal.sourceKey).toBe("ACCOMMODATION:CANCELLATION_REFUND:3");
    expect(Number(reversal.gross)).toBe(-90000);
    expect(Number(reversal.commission)).toBe(-11739.13);
    expect(Number(reversal.partnerNet)).toBe(-78260.87);
    expect(reversal.businessDate.toISOString()).toBe("2026-11-20T00:00:00.000Z");
    expect((await reverseAccommodationRefund(db, 3)).status).toBe("existing");
    expect(db.ledger).toHaveLength(2);
  });

  it("reverses a chargeback against the same invoice", async () => {
    await recognizeInvoiceRevenue(db, 10);
    const result = await reverseAccommodationChargeback(db, { id: 8, bookingId: 500, guestAmount: 230000, createdAt: new Date("2026-11-25T09:00:00Z") });
    expect(result.entry).toMatchObject({ sourceKey: "ACCOMMODATION:CHARGEBACK:8", entryType: "REVERSAL" });
    expect(Number(result.entry.commissionTzs)).toBe(-30000);
  });
});

describe("tours", () => {
  const tour = { id: 40, paymentStatus: "PAID", currency: "USD", grossAmount: 1000, commissionAmount: 150, fxTzsPerUnit: 2550, paidAt: PAID_AT };

  it("recognizes in the booking currency at the rate frozen on the booking", async () => {
    const db = fakeDb({ tourBooking: [tour], paymentEvent: [{ id: 5, tourBookingId: 40, status: "SUCCESS" }] });
    await recognizeTourRevenue(db, 40);
    expect(db.ledger[0]).toMatchObject({ sourceKey: "TOUR:TOUR_BOOKING:40", currency: "USD", paymentEventId: 5 });
    expect(Number(db.ledger[0].partnerNet)).toBe(850);
    expect(Number(db.ledger[0].commissionTzs)).toBe(382500);
  });

  it("skips an unpaid booking", async () => {
    const db = fakeDb({ tourBooking: [{ ...tour, paymentStatus: "PENDING", paidAt: null }] });
    expect(await recognizeTourRevenue(db, 40)).toMatchObject({ status: "skipped", reason: "NOT_PAID" });
  });

  it("reverses a recorded refund by what actually went back, after channel charges", async () => {
    const db = fakeDb({
      tourBooking: [{ ...tour, paymentStatus: "REFUNDED" }],
      tourFinancialTransaction: [{ id: 77, tourBookingId: 40, kind: "REFUND", status: "REFUNDED", amount: 500, metadata: { recordedAt: "2026-11-21T22:00:00.000Z", channelCharges: { netRefundAmount: 400 } }, updatedAt: new Date() }],
    });
    const result = await reverseTourRefund(db, 77);
    expect(result.entry).toMatchObject({ sourceKey: "TOUR:TOUR_REFUND:77", currency: "USD" });
    expect(Number(result.entry.gross)).toBe(-400);
    expect(Number(result.entry.commission)).toBe(-60);
    expect(Number(result.entry.grossTzs)).toBe(-1020000);
    expect(result.entry.businessDate.toISOString()).toBe("2026-11-22T00:00:00.000Z");
  });
});

describe("group stay, transport and subscriptions", () => {
  it("recognizes a group stay at deposit with the overview's take rule", async () => {
    const db = fakeDb({ groupBooking: [{ id: 9, depositPaid: true, depositPaidAt: PAID_AT, totalAmount: 1150000, ownerAmount: 1000000, currency: "TZS" }] });
    await recognizeGroupStayRevenue(db, 9, { paymentEventId: null });
    expect(Number(db.ledger[0].commission)).toBe(150000);
    expect(Number(db.ledger[0].partnerNet)).toBe(1000000);
    expect(db.ledger[0].sourceKey).toBe("GROUP_STAY:GROUP_BOOKING:9");
  });

  it("recognizes transport only for a paid trip with a payout row", async () => {
    const payout = { id: 2, currency: "TZS", grossAmount: 40000, commissionAmount: 4000, netPaid: 36000, createdAt: PAID_AT };
    const unpaid = fakeDb({ transportBooking: [{ id: 6, paymentStatus: "PENDING", payout }] });
    expect(await recognizeTransportRevenue(unpaid, 6)).toMatchObject({ status: "skipped", reason: "NOT_PAID" });
    const noPayout = fakeDb({ transportBooking: [{ id: 6, paymentStatus: "PAID", payout: null }] });
    expect(await recognizeTransportRevenue(noPayout, 6)).toMatchObject({ status: "skipped", reason: "NO_PAYOUT" });
    const db = fakeDb({ transportBooking: [{ id: 6, paymentStatus: "PAID", payout }] });
    await recognizeTransportRevenue(db, 6);
    expect(db.ledger[0]).toMatchObject({ sourceKey: "TRANSPORT:TRANSPORT_BOOKING:6", recognizedAt: PAID_AT });
    expect(Number(db.ledger[0].commission)).toBe(4000);
  });

  it("books the whole NRMS payment as revenue and links the provider event", async () => {
    const db = fakeDb({
      nrmsServicePayment: [{ id: 4, amount: 25000, currency: "TZS", status: "VERIFIED", verifiedAt: PAID_AT, provider: "AZAMPAY", providerRef: "AZ-123" }],
      paymentEvent: [{ id: 12, eventId: "AZ-123", provider: "AZAMPAY", status: "SUCCESS" }],
    });
    await recognizeNrmsPaymentRevenue(db, 4);
    expect(db.ledger[0]).toMatchObject({ sourceKey: "SUBSCRIPTION:NRMS_SERVICE_PAYMENT:4", paymentEventId: 12 });
    expect(Number(db.ledger[0].commission)).toBe(25000);
    expect(Number(db.ledger[0].partnerNet)).toBe(0);
  });
});
