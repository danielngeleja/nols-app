/**
 * Payout eligibility amount selection
 *
 * Two classes of defect are covered here, both of which paid out MORE than
 * was owed and neither of which needed an attacker to trigger:
 *
 *  1. The net payable was optional. Sales read `approvedAmount ?? requestedAmount`
 *     and owner read `netPayable ?? total`, so a missing net figure fell back
 *     to a gross one instead of refusing.
 *  2. The owner claim (OINV-*) and customer checkout invoice (INV-*) are
 *     separate rows for one booking. Collection evidence must follow bookingId
 *     to the customer invoice without weakening the provider-confirmed gate.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findInvoice: vi.fn(),
  findSalesPayout: vi.fn(),
  groupPaymentEvents: vi.fn(),
  recoveredSum: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    invoice: { findUnique: mocks.findInvoice },
    salesPayoutRequest: { findUnique: mocks.findSalesPayout },
    paymentEvent: { groupBy: mocks.groupPaymentEvents },
    ownerPayoutRecoveryApplication: { aggregate: mocks.recoveredSum },
  },
}));

import { loadEligiblePayoutSource } from "../services/payouts/eligibility";

const dec = (value: string | number) => new Prisma.Decimal(value);

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 123,
    ownerId: 44,
    bookingId: 987,
    status: "APPROVED",
    netPayable: dec("150000.00"),
    total: dec("180000.00"),
    ...overrides,
  };
}

function salesPayout(overrides: Record<string, unknown> = {}) {
  return {
    id: 55,
    status: "APPROVED",
    approvedAmount: dec("400000.00"),
    deductionAmount: dec("50000.00"),
    netPaidAmount: dec("350000.00"),
    requestedAmount: dec("400000.00"),
    currency: "TZS",
    salesPartner: { userId: 77 },
    ...overrides,
  };
}

/** Confirmed customer money on file for the booking's INV-* checkout invoice. */
function collected(amount: string | number | null, currency = "TZS") {
  mocks.groupPaymentEvents.mockResolvedValue(
    amount == null ? [] : [{ currency, _sum: { amount: dec(amount) } }]
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  collected("180000.00");
  mocks.recoveredSum.mockResolvedValue({ _sum: { amount: null } });
});

describe("owner invoice recovery deduction (policy 6.3.3)", () => {
  it("pays the claim minus what was used to recover an earlier refund", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    mocks.recoveredSum.mockResolvedValue({ _sum: { amount: dec("40000.00") } });
    const source = await loadEligiblePayoutSource("OWNER_INVOICE", 123);
    expect(source.amount.toString()).toBe("110000");
  });

  it("refuses a claim that was used up entirely by a recovery", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    mocks.recoveredSum.mockResolvedValue({ _sum: { amount: dec("150000.00") } });
    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(/used to recover/);
  });
});

describe("sales payout amount", () => {
  it("disburses the net amount, not the gross approved amount", async () => {
    // The regression: a 50,000 deduction was recorded at approval, audited,
    // and returned in the API response, then silently not applied to the
    // money that actually left.
    mocks.findSalesPayout.mockResolvedValue(salesPayout());

    const source = await loadEligiblePayoutSource("SALES_PAYOUT", 55);

    expect(source.amount.toString()).toBe("350000");
    expect(Number(source.amount)).not.toBe(400000);
  });

  it("refuses rather than falling back to a gross figure when the net is missing", async () => {
    mocks.findSalesPayout.mockResolvedValue(salesPayout({ netPaidAmount: null }));

    await expect(loadEligiblePayoutSource("SALES_PAYOUT", 55)).rejects.toThrow(/netPaidAmount is not set/);
  });

  it("refuses a row whose amounts no longer reconcile", async () => {
    // approved 400,000 minus deduction 50,000 is 350,000, but the stored net
    // says 400,000 — the row was changed outside the approval path.
    mocks.findSalesPayout.mockResolvedValue(salesPayout({ netPaidAmount: dec("400000.00") }));

    await expect(loadEligiblePayoutSource("SALES_PAYOUT", 55)).rejects.toThrow(/do not reconcile/);
  });

  it("still pays a clean request with no deduction", async () => {
    mocks.findSalesPayout.mockResolvedValue(
      salesPayout({ deductionAmount: dec("0.00"), netPaidAmount: dec("400000.00") })
    );

    const source = await loadEligiblePayoutSource("SALES_PAYOUT", 55);
    expect(source.amount.toString()).toBe("400000");
  });
});

describe("owner invoice amount", () => {
  it("refuses rather than falling back to the customer-paid total", async () => {
    // `total` is gross of NoLSAF's commission AND the driver's transport fare.
    // Falling back to it did not overpay slightly, it paid both away.
    mocks.findInvoice.mockResolvedValue(invoice({ netPayable: null }));

    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(/netPayable is not set/);
  });

  it("disburses the owner share when the booking was genuinely paid", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());

    const source = await loadEligiblePayoutSource("OWNER_INVOICE", 123);

    expect(source.amount.toString()).toBe("150000");
    expect(source.payeeUserId).toBe(44);
  });
});

describe("owner invoice solvency gate", () => {
  it("refuses an approved invoice with no confirmed customer payment", async () => {
    // Approval and check-in are not substitutes for a provider-confirmed event.
    mocks.findInvoice.mockResolvedValue(invoice());
    collected(null);

    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(
      /confirmed customer payment is 0 but the owner payout is 150000/
    );
  });

  it("refuses when the collected amount does not cover the payout", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    collected("149000.00");

    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(
      /no disbursement may exceed the money actually collected/
    );
  });

  it("loads SUCCESS payment events from the booking's separate INV-* invoice", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    collected("180000.00");

    await loadEligiblePayoutSource("OWNER_INVOICE", 123);

    expect(mocks.groupPaymentEvents).toHaveBeenCalledWith({
      by: ["currency"],
      where: {
        invoice: {
          is: {
            bookingId: 987,
            invoiceNumber: { startsWith: "INV-" },
          },
        },
        status: "SUCCESS",
      },
      _sum: { amount: true },
    });
  });

  it("does not look for customer payment on the OINV-* source id", async () => {
    mocks.findInvoice.mockResolvedValue(invoice({ id: 123, bookingId: 987 }));
    collected("180000.00");

    await loadEligiblePayoutSource("OWNER_INVOICE", 123);

    const query = mocks.groupPaymentEvents.mock.calls[0]?.[0];
    expect(query.where.invoiceId).toBeUndefined();
    expect(query.where.invoice.is.bookingId).toBe(987);
  });

  it("rejects a successful payment recorded in the wrong currency", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    collected("150000.00", "USD");

    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(
      /successful payment events in USD, but its payout currency is TZS/
    );
  });

  it("rejects mixed successful-payment currencies instead of adding unlike amounts", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    mocks.groupPaymentEvents.mockResolvedValue([
      { currency: "TZS", _sum: { amount: dec("150000.00") } },
      { currency: "USD", _sum: { amount: dec("50.00") } },
    ]);

    await expect(loadEligiblePayoutSource("OWNER_INVOICE", 123)).rejects.toThrow(
      /successful payment events in USD, but its payout currency is TZS/
    );
  });

  it("allows a payout exactly covered by the collected amount", async () => {
    mocks.findInvoice.mockResolvedValue(invoice());
    collected("150000.00");

    const source = await loadEligiblePayoutSource("OWNER_INVOICE", 123);
    expect(source.amount.toString()).toBe("150000");
  });
});
