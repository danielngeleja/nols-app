import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoiceFindMany: vi.fn(),
  invoiceFindFirst: vi.fn(),
  invoiceUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  invoice: { findMany: mocks.invoiceFindMany, findFirst: mocks.invoiceFindFirst, updateMany: mocks.invoiceUpdateMany },
  auditLog: { create: mocks.auditCreate },
} }));

import { bookingPaymentOutcome, releaseFailedBookingPayment, releaseSilentBookingPayments } from "./bookingPaymentAttempt.js";

const NOW = new Date("2026-11-08T12:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  // releaseFailedBookingPayment reads the real clock, so pin it to NOW.
  // Without this the "newer attempt still waiting" case started failing once
  // real time passed NOW plus the 5 minute mobile money window.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  mocks.invoiceUpdateMany.mockResolvedValue({ count: 1 });
  mocks.auditCreate.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("bookingPaymentOutcome", () => {
  const invoice = (over: Record<string, unknown> = {}) => ({ status: "PROCESSING", paymentMethod: "Mpesa", updatedAt: ago(1), paymentEvents: [], ...over }) as any;

  it("is processing, then slow, then no result for mobile money", () => {
    expect(bookingPaymentOutcome(invoice(), NOW).state).toBe("PROCESSING");
    expect(bookingPaymentOutcome(invoice({ updatedAt: ago(3) }), NOW).state).toBe("SLOW");
    expect(bookingPaymentOutcome(invoice({ updatedAt: ago(6) }), NOW).state).toBe("NO_RESULT");
  });

  it("gives card payments 15 minutes", () => {
    expect(bookingPaymentOutcome(invoice({ paymentMethod: "CARD", updatedAt: ago(10) }), NOW).state).toBe("SLOW");
    expect(bookingPaymentOutcome(invoice({ paymentMethod: "CARD", updatedAt: ago(16) }), NOW).state).toBe("NO_RESULT");
  });

  it("reads a provider failure as failed at once, even on a still-processing invoice", () => {
    const events = [{ status: "PENDING", createdAt: ago(3) }, { status: "FAILED", createdAt: ago(1) }];
    expect(bookingPaymentOutcome(invoice({ paymentMethod: "CARD", paymentEvents: events }), NOW).state).toBe("FAILED");
  });

  it("says nothing once any success is recorded", () => {
    expect(bookingPaymentOutcome(invoice({ updatedAt: ago(60), paymentEvents: [{ status: "SUCCESS", createdAt: ago(50) }] }), NOW).state).toBeNull();
  });

  it("explains a released attempt and stays silent for an untouched invoice", () => {
    expect(bookingPaymentOutcome(invoice({ status: "PENDING", paymentEvents: [{ status: "PENDING", createdAt: ago(9) }] }), NOW).state).toBe("NO_RESULT");
    expect(bookingPaymentOutcome(invoice({ status: "PENDING", paymentMethod: null }), NOW).state).toBeNull();
  });
});

describe("releaseSilentBookingPayments", () => {
  it("releases a silent mobile money attempt after 5 minutes but keeps a card one until 15", async () => {
    mocks.invoiceFindMany.mockResolvedValue([
      { id: 1, bookingId: 10, paymentMethod: "Tigo", updatedAt: ago(6), paymentEvents: [{ createdAt: ago(6) }] },
      { id: 2, bookingId: 11, paymentMethod: "CARD", updatedAt: ago(6), paymentEvents: [] },
      { id: 3, bookingId: 12, paymentMethod: "CARD", updatedAt: ago(20), paymentEvents: [] },
    ]);
    const result = await releaseSilentBookingPayments(NOW);
    expect(result).toEqual({ checked: 3, released: 2 });
    const released = mocks.invoiceUpdateMany.mock.calls.map((call) => call[0].where.id);
    expect(released).toEqual([1, 3]);
    expect(mocks.invoiceUpdateMany.mock.calls[0][0]).toMatchObject({
      where: { status: "PROCESSING", invoiceNumber: { startsWith: "INV-" }, booking: { is: { status: "NEW" } }, paymentEvents: { none: { status: "SUCCESS" } } },
      data: { status: "PENDING" },
    });
    expect(mocks.auditCreate.mock.calls[0][0].data.action).toBe("BOOKING_PAYMENT_NO_RESULT_RELEASED");
  });

  it("only looks at recent attempts and never deletes", async () => {
    mocks.invoiceFindMany.mockResolvedValue([]);
    await releaseSilentBookingPayments(NOW);
    const where = mocks.invoiceFindMany.mock.calls[0][0].where;
    expect(where.updatedAt.gte.getTime()).toBe(NOW.getTime() - 48 * 60 * 60_000);
  });

  it("keeps an attempt alive while a newer push is inside its limit", async () => {
    mocks.invoiceFindMany.mockResolvedValue([{ id: 4, bookingId: 13, paymentMethod: "Airtel", updatedAt: ago(8), paymentEvents: [{ createdAt: ago(2) }] }]);
    expect((await releaseSilentBookingPayments(NOW)).released).toBe(0);
    expect(mocks.invoiceUpdateMany).not.toHaveBeenCalled();
  });

  it("does not audit when another writer changed the invoice first", async () => {
    mocks.invoiceFindMany.mockResolvedValue([{ id: 5, bookingId: 14, paymentMethod: "Mpesa", updatedAt: ago(7), paymentEvents: [] }]);
    mocks.invoiceUpdateMany.mockResolvedValue({ count: 0 });
    expect((await releaseSilentBookingPayments(NOW)).released).toBe(0);
    expect(mocks.auditCreate).not.toHaveBeenCalled();
  });
});

describe("releaseFailedBookingPayment", () => {
  it("releases the invoice when the failed attempt is the only one", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ id: 44, bookingId: 9, paymentMethod: "CARD", updatedAt: ago(3), paymentEvents: [{ eventId: "INVREF-44-1-INIT", createdAt: ago(3) }] });
    expect(await releaseFailedBookingPayment(44, ["INVREF-44-1-postback-FAILED", "INVREF-44-1"], "CORALCOMMERCE")).toBe(true);
    expect(mocks.invoiceUpdateMany.mock.calls[0][0].data).toEqual({ status: "PENDING" });
    expect(mocks.auditCreate.mock.calls[0][0].data.action).toBe("BOOKING_PAYMENT_FAILED_RELEASED");
  });

  it("leaves it alone while a different, newer attempt is still waiting", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({ id: 44, bookingId: 9, paymentMethod: "Mpesa", updatedAt: ago(1), paymentEvents: [{ eventId: "TX-NEW", createdAt: ago(1) }] });
    expect(await releaseFailedBookingPayment(44, ["TX-OLD-123", "INV-44-111"], "AZAMPAY")).toBe(false);
    expect(mocks.invoiceUpdateMany).not.toHaveBeenCalled();
  });

  it("ignores invoices that are not releasable (paid, confirmed, owner invoices)", async () => {
    mocks.invoiceFindFirst.mockResolvedValue(null);
    expect(await releaseFailedBookingPayment(44, ["TX-1"], "AZAMPAY")).toBe(false);
    expect(await releaseFailedBookingPayment(null, ["TX-1"], "AZAMPAY")).toBe(false);
    expect(mocks.invoiceUpdateMany).not.toHaveBeenCalled();
  });
});
