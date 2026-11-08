// Closing a payment case by hand: "not paid" never marks anything paid, and a
// provider-statement confirmation settles only a matching, unused transaction.
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const fn = () => vi.fn();
  const db: any = {
    bookingPaymentCase: { findUnique: fn(), updateMany: fn(), update: fn() },
    bookingPaymentCaseEvent: { create: fn() },
    invoice: { updateMany: fn(), findFirst: fn(), findUnique: fn() },
    paymentEvent: { findFirst: fn(), create: fn(), update: fn() },
    booking: { findUnique: fn() },
  };
  db.$transaction = vi.fn(async (operation: (tx: any) => unknown) => operation(db));
  return {
    db,
    audit: vi.fn(async () => undefined),
    notifyUser: vi.fn(async () => undefined),
    markInvoicePaid: vi.fn(async () => undefined),
    deliver: vi.fn(async () => ({ channels: ["SMS"], destinationMasked: "+255 7** *** 123", ownerPhoneOverlap: false })),
    generateCode: vi.fn(async () => undefined),
    confirmBooking: vi.fn(async () => undefined),
  };
});

vi.mock("@nolsaf/prisma", () => ({ prisma: h.db }));
vi.mock("../lib/audit.js", () => ({ audit: h.audit }));
vi.mock("../lib/notifications.js", () => ({ notifyUser: h.notifyUser, notifyAdmins: vi.fn() }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middleware/financeGrant.js", () => ({ requireAdminFinanceGrant: (_req: any, _res: any, next: any) => next() }));
vi.mock("../lib/bookingPaymentCaseReference.js", () => ({
  bookingPaymentCaseReference: (id: number) => `pc_case${id}`,
  resolveBookingPaymentCaseReference: async (reference: string) => (reference === "pc_case5" ? 5 : null),
}));
vi.mock("../lib/adminBookingReference.js", () => ({ adminBookingReference: (id: number) => `bk_${id}` }));
vi.mock("../lib/customerBookingReference.js", () => ({ customerBookingReference: (id: number) => `cb_${id}` }));
vi.mock("../lib/guestCodeRequests.js", () => ({ maskPhone: () => null }));
vi.mock("../lib/bookingPaymentCaseDelivery.js", () => ({ deliverBookingCaseConfirmation: h.deliver }));
vi.mock("../lib/bookingCodeService.js", () => ({ generateBookingCodeForBooking: h.generateCode }));
vi.mock("../lib/nolsafMarketplaceNrms.js", () => ({
  confirmNoLsafBooking: h.confirmBooking,
  MARKETPLACE_CONNECT_TX_OPTIONS: {},
  NoLsafInventoryConflictError: class extends Error {},
}));
vi.mock("./webhooks.payments.js", () => ({ markInvoicePaid: h.markInvoicePaid }));
vi.mock("../routes/webhooks.payments.js", () => ({ markInvoicePaid: h.markInvoicePaid }));

import router from "../routes/admin.bookingPaymentCases.js";

const app = express();
app.use(express.json());
app.use("/cases", router);

const longAgo = new Date("2026-10-19T18:30:00Z");
const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

function caseRow(overrides: { status?: string; invoice?: any; booking?: any } = {}) {
  const invoice = {
    id: 44, invoiceNumber: "INV-202610-000044-0044", status: "PROCESSING", total: 1_568_000, netPayable: 1_400_000,
    paymentMethod: "CARD", paymentRef: null, receiptNumber: null, paidAt: null, createdAt: longAgo, updatedAt: longAgo,
    paymentEvents: [
      { id: 2, eventId: "INVREF-44-postback-FAILED", provider: "CORALCOMMERCE", status: "FAILED", amount: 1_568_000, currency: "TZS", phone: null, payload: null, createdAt: longAgo },
    ],
    ...overrides.invoice,
  };
  return {
    id: 5, bookingId: 90, customerId: 301, status: overrides.status ?? "AWAITING_PROVIDER", resolution: null,
    customerReference: "1234567GGHYF", createdAt: longAgo, updatedAt: new Date("2026-11-08T07:26:00Z"), resolvedAt: null,
    events: [],
    booking: {
      id: 90, status: "NEW", totalAmount: 1_568_000, guestName: "Pavel", guestPhone: null, checkIn: future, checkOut: future,
      property: { title: "Great Wall Apartment", owner: { phone: null } }, user: { id: 301, name: "Pavel", email: null }, code: null,
      invoices: [invoice],
      ...overrides.booking,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.db.$transaction.mockImplementation(async (operation: (tx: any) => unknown) => operation(h.db));
  h.db.bookingPaymentCaseEvent.create.mockResolvedValue({});
  h.db.bookingPaymentCase.update.mockResolvedValue({});
  h.db.paymentEvent.update.mockResolvedValue({});
});

describe("close-not-paid", () => {
  const body = { note: "Coral confirmed the card was declined, no funds captured", confirmNoMoney: true };

  it("closes the case, releases the stuck invoice and tells the traveller, without marking anything paid", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow());
    h.db.bookingPaymentCase.updateMany.mockResolvedValue({ count: 1 });
    h.db.invoice.updateMany.mockResolvedValue({ count: 1 });
    const res = await request(app).post("/cases/pc_case5/close-not-paid").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "RESOLVED", resolution: "NOT_PAID", releasedInvoices: 1 });
    expect(h.db.bookingPaymentCase.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: 5, status: "AWAITING_PROVIDER" }, data: { status: "RESOLVED", resolution: "NOT_PAID", resolvedById: 7 } });
    expect(h.db.invoice.updateMany.mock.calls[0][0]).toMatchObject({ where: { id: { in: [44] }, status: "PROCESSING", paymentEvents: { none: { status: "SUCCESS" } } }, data: { status: "PENDING" } });
    expect(h.markInvoicePaid).not.toHaveBeenCalled();
    expect(h.notifyUser).toHaveBeenCalledWith(301, "booking_payment_case_closed_not_paid", expect.objectContaining({ caseReference: "pc_case5" }));
    expect(h.audit).toHaveBeenCalledWith(expect.anything(), "BOOKING_PAYMENT_CASE_CLOSED_NOT_PAID", "BOOKING_PAYMENT_CASE", expect.anything(), expect.objectContaining({ resolution: "NOT_PAID" }), 5);
  });

  it("refuses without the confirmation tick or a real note", async () => {
    expect((await request(app).post("/cases/pc_case5/close-not-paid").send({ note: "Coral confirmed the decline" })).status).toBe(400);
    expect((await request(app).post("/cases/pc_case5/close-not-paid").send({ note: "short", confirmNoMoney: true })).status).toBe(400);
  });

  it("refuses when any money is recorded on the booking", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow({ invoice: { paymentEvents: [{ id: 3, eventId: "az-1", provider: "AZAMPAY", status: "SUCCESS", amount: 1_568_000, currency: "TZS", createdAt: longAgo }] } }));
    const res = await request(app).post("/cases/pc_case5/close-not-paid").send(body);
    expect(res.status).toBe(409);
    expect(h.db.bookingPaymentCase.updateMany).not.toHaveBeenCalled();
  });

  it("refuses while a payment attempt is still inside its window", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow({ invoice: { updatedAt: new Date(), paymentEvents: [] } }));
    expect((await request(app).post("/cases/pc_case5/close-not-paid").send(body)).status).toBe(409);
    expect(h.db.bookingPaymentCase.updateMany).not.toHaveBeenCalled();
  });

  it("refuses an already closed case", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow({ status: "RESOLVED" }));
    expect((await request(app).post("/cases/pc_case5/close-not-paid").send(body)).status).toBe(409);
  });
});

describe("confirm-statement", () => {
  const body = { provider: "CORALCOMMERCE", transactionId: "CC-TX-778899", amount: 1_568_000, note: "Coral merchant portal shows it settled", confirmStatement: true };

  it("records a labelled statement event and settles through markInvoicePaid, then sends the code", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow());
    h.db.paymentEvent.findFirst.mockResolvedValue(null);
    h.db.invoice.findFirst.mockResolvedValue(null);
    h.db.bookingPaymentCase.updateMany.mockResolvedValue({ count: 1 });
    h.db.paymentEvent.create.mockResolvedValue({ id: 77 });
    h.db.booking.findUnique.mockResolvedValue({ status: "CONFIRMED", code: { status: "ACTIVE" } });
    const res = await request(app).post("/cases/pc_case5/confirm-statement").send(body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "RESOLVED", deliveredVia: ["SMS"] });
    expect(h.db.paymentEvent.create.mock.calls[0][0].data).toMatchObject({ provider: "MANUAL_STATEMENT", eventId: "STATEMENT:CORALCOMMERCE:CC-TX-778899", invoiceId: 44, status: "SUCCESS" });
    expect(h.markInvoicePaid).toHaveBeenCalledWith(44, "CORALCOMMERCE", "CC-TX-778899", undefined, "CORALCOMMERCE", "CC-TX-778899", 1_568_000);
    expect(h.db.bookingPaymentCase.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RESOLVED", resolution: "PROVIDER_STATEMENT" }) }));
  });

  it("refuses an amount that does not match the invoice", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow());
    const res = await request(app).post("/cases/pc_case5/confirm-statement").send({ ...body, amount: 1_000_000 });
    expect(res.status).toBe(409);
    expect(h.db.paymentEvent.create).not.toHaveBeenCalled();
    expect(h.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("refuses a transaction ID already recorded anywhere on NoLSAF", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow());
    h.db.paymentEvent.findFirst.mockResolvedValue({ id: 12 });
    const res = await request(app).post("/cases/pc_case5/confirm-statement").send(body);
    expect(res.status).toBe(409);
    expect(h.markInvoicePaid).not.toHaveBeenCalled();
  });

  it("sends a cancelled booking to refund review instead of issuing a code", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow({ booking: { status: "CANCELED" } }));
    h.db.paymentEvent.findFirst.mockResolvedValue(null);
    h.db.invoice.findFirst.mockResolvedValue(null);
    h.db.bookingPaymentCase.updateMany.mockResolvedValue({ count: 1 });
    h.db.paymentEvent.create.mockResolvedValue({ id: 78 });
    const res = await request(app).post("/cases/pc_case5/confirm-statement").send(body);
    expect(res.body.status).toBe("REFUND_REQUIRED");
    expect(h.markInvoicePaid).not.toHaveBeenCalled();
    expect(h.generateCode).not.toHaveBeenCalled();
  });

  it("voids the statement record when settlement fails, so it never counts as money", async () => {
    h.db.bookingPaymentCase.findUnique.mockResolvedValue(caseRow());
    h.db.paymentEvent.findFirst.mockResolvedValue(null);
    h.db.invoice.findFirst.mockResolvedValue(null);
    h.db.bookingPaymentCase.updateMany.mockResolvedValue({ count: 1 });
    h.db.paymentEvent.create.mockResolvedValue({ id: 79 });
    h.markInvoicePaid.mockRejectedValueOnce(new Error("amount mismatch"));
    h.db.invoice.findUnique.mockResolvedValue({ status: "PROCESSING" });
    const res = await request(app).post("/cases/pc_case5/confirm-statement").send(body);
    expect(res.status).toBe(500);
    expect(h.db.paymentEvent.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 79 }, data: expect.objectContaining({ status: "VOIDED" }) }));
    expect(h.db.bookingPaymentCase.update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { status: "AWAITING_PROVIDER" } }));
  });
});
