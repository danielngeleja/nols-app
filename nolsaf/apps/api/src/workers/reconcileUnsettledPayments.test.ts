import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  eventFindMany: vi.fn(),
  invoiceFindUnique: vi.fn(),
  notificationFindFirst: vi.fn(),
  notifyAdmins: vi.fn(),
  markInvoicePaid: vi.fn(),
  markTourBookingPaid: vi.fn(),
  markGroupBookingDepositPaid: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: {
  paymentEvent: { findMany: mocks.eventFindMany },
  invoice: { findUnique: mocks.invoiceFindUnique },
  notification: { findFirst: mocks.notificationFindFirst },
} }));
vi.mock("../lib/notifications.js", () => ({ notifyAdmins: mocks.notifyAdmins }));
vi.mock("../routes/webhooks.payments.js", () => ({
  markInvoicePaid: mocks.markInvoicePaid,
  markTourBookingPaid: mocks.markTourBookingPaid,
  markGroupBookingDepositPaid: mocks.markGroupBookingDepositPaid,
}));

import { reconcileUnsettledPayments } from "./reconcileUnsettledPayments.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

/** A SUCCESS callback that was recorded but whose invoice never reached PAID. */
function strandedInvoiceEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 501,
    provider: "AZAMPAY",
    eventId: "azam-txn-9001",
    amount: 120000,
    phone: "+255712345678",
    createdAt: minutesAgo(20),
    payload: { paymentRef: "INV-77" },
    invoiceId: 77,
    tourBookingId: null,
    groupBookingId: null,
    invoice: { id: 77, status: "APPROVED", paymentMethod: "AZAMPAY", total: 120000, netPayable: 100000 },
    tourBooking: null,
    groupBooking: null,
    ...overrides,
  };
}

describe("reconcileUnsettledPayments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.eventFindMany.mockResolvedValue([]);
    mocks.notificationFindFirst.mockResolvedValue(null);
    mocks.notifyAdmins.mockResolvedValue(undefined);
    mocks.markInvoicePaid.mockResolvedValue({});
    // Default: the retry succeeds and the invoice comes back PAID.
    mocks.invoiceFindUnique.mockResolvedValue({ status: "PAID" });
  });

  it("re-runs settlement for a SUCCESS event whose invoice never reached PAID", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent()]);

    const result = await reconcileUnsettledPayments(NOW);

    expect(mocks.markInvoicePaid).toHaveBeenCalledTimes(1);
    // The amount the provider confirmed must be passed through, not re-derived.
    expect(mocks.markInvoicePaid).toHaveBeenCalledWith(
      77, "AZAMPAY", "INV-77", "+255712345678", "AZAMPAY", "azam-txn-9001", 120000
    );
    expect(result).toMatchObject({ checked: 1, settled: 1, stillStuck: 0, escalated: 0, errors: 0 });
  });

  it("does not escalate a payment that settles on retry", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent({ createdAt: minutesAgo(400) })]);

    const result = await reconcileUnsettledPayments(NOW);

    expect(result.settled).toBe(1);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("never settles an invoice whose SUCCESS event carries the wrong amount", async () => {
    mocks.eventFindMany.mockResolvedValue([
      strandedInvoiceEvent({ amount: 100, createdAt: minutesAgo(90) }),
    ]);

    const result = await reconcileUnsettledPayments(NOW);

    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
    expect(result).toMatchObject({ settled: 0, stillStuck: 1, escalated: 1 });
  });

  it("holds without alerting while a stuck payment is still inside the escalation window", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent({ createdAt: minutesAgo(20) })]);
    mocks.invoiceFindUnique.mockResolvedValue({ status: "APPROVED" }); // retry did not settle it

    const result = await reconcileUnsettledPayments(NOW);

    expect(result).toMatchObject({ stillStuck: 1, escalated: 0 });
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("escalates to admins once a stuck payment passes the escalation window", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent({ createdAt: minutesAgo(90) })]);
    mocks.invoiceFindUnique.mockResolvedValue({ status: "APPROVED" });

    const result = await reconcileUnsettledPayments(NOW);

    expect(result).toMatchObject({ stillStuck: 1, escalated: 1 });
    expect(mocks.notifyAdmins).toHaveBeenCalledWith(
      "payment_stuck_unsettled",
      expect.objectContaining({ paymentEventId: 501, target: "Invoice 77", amount: 120000 })
    );
  });

  it("alerts only once per event, however many times the worker runs", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent({ createdAt: minutesAgo(90) })]);
    mocks.invoiceFindUnique.mockResolvedValue({ status: "APPROVED" });
    mocks.notificationFindFirst.mockResolvedValue({ id: 9 }); // an alert already exists

    const result = await reconcileUnsettledPayments(NOW);

    expect(result.escalated).toBe(0);
    expect(mocks.notifyAdmins).not.toHaveBeenCalled();
  });

  it("counts a settlement failure as an error and leaves the payment stuck", async () => {
    mocks.eventFindMany.mockResolvedValue([strandedInvoiceEvent()]);
    mocks.markInvoicePaid.mockRejectedValue(new Error("receipt number collision"));

    const result = await reconcileUnsettledPayments(NOW);

    expect(result).toMatchObject({ checked: 1, settled: 0, stillStuck: 1, errors: 1 });
  });

  it("settles a stranded tour booking through the tour path", async () => {
    mocks.eventFindMany.mockResolvedValue([
      strandedInvoiceEvent({
        invoiceId: null, invoice: null,
        tourBookingId: 42, tourBooking: { id: 42, paymentStatus: "PENDING" },
      }),
    ]);
    mocks.markTourBookingPaid.mockResolvedValue({ ok: true });

    const result = await reconcileUnsettledPayments(NOW);

    expect(mocks.markTourBookingPaid).toHaveBeenCalledWith(42, 120000, "AZAMPAY");
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
    expect(result.settled).toBe(1);
  });

  it("respects a settlement helper that refuses on an amount mismatch", async () => {
    mocks.eventFindMany.mockResolvedValue([
      strandedInvoiceEvent({
        invoiceId: null, invoice: null,
        tourBookingId: 42, tourBooking: { id: 42, paymentStatus: "PENDING" },
        createdAt: minutesAgo(90),
      }),
    ]);
    // The worker must never override the helper's own amount check.
    mocks.markTourBookingPaid.mockResolvedValue({ ok: false, reason: "amount_mismatch" });

    const result = await reconcileUnsettledPayments(NOW);

    expect(result).toMatchObject({ settled: 0, stillStuck: 1, escalated: 1 });
  });

  it("does nothing when there is no stranded payment", async () => {
    const result = await reconcileUnsettledPayments(NOW);
    expect(result).toMatchObject({ checked: 0, settled: 0, escalated: 0 });
    expect(mocks.markInvoicePaid).not.toHaveBeenCalled();
  });
});
