/**
 * Tour payout eligibility under the Tour Operator Disbursement Policy.
 *
 * A booking can now carry two disbursements: pre-trip advances (source
 * TOUR_ADVANCE) and the post-trip balance (source TOUR_BOOKING). These cases
 * pin the money rules so the two can never add up to more than the operator's
 * net share.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const mocks = vi.hoisted(() => ({
  findBooking: vi.fn(),
  findCase: vi.fn(),
  findTx: vi.fn(),
  listTx: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    tourBooking: { findUnique: mocks.findBooking },
    tourCase: { findFirst: mocks.findCase },
    tourFinancialTransaction: { findUnique: mocks.findTx, findMany: mocks.listTx },
  },
}));

import { loadEligiblePayoutSource } from "../services/payouts/eligibility";

const dec = (value: string | number) => new Prisma.Decimal(value);
const advanceRow = (id: number, status: string, amount: number) => ({
  id,
  tourBookingId: 9,
  status,
  amount: dec(amount),
  createdAt: new Date("2026-10-10T00:00:00Z"),
  metadata: { tranche: "ADVANCE" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCase.mockResolvedValue(null);
  mocks.listTx.mockResolvedValue([]);
});

describe("tour balance", () => {
  const booking = { id: 9, payoutStatus: "APPROVED", operatorPayoutAmount: dec("13000.00"), currency: "USD", operator: { userId: 5 } };

  it("pays the net share minus advances already paid", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listTx.mockResolvedValue([advanceRow(1, "DISBURSED", 9100), advanceRow(2, "REJECTED", 500)]);
    const source = await loadEligiblePayoutSource("TOUR_BOOKING", 9);
    expect(source.amount.toString()).toBe("3900");
  });

  it("waits while an advance is still being processed", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listTx.mockResolvedValue([advanceRow(1, "APPROVED", 3900)]);
    await expect(loadEligiblePayoutSource("TOUR_BOOKING", 9)).rejects.toThrow(/advance for this booking is still being processed/);
  });

  it("refuses when advances already cover the whole share", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listTx.mockResolvedValue([advanceRow(1, "DISBURSED", 13000)]);
    await expect(loadEligiblePayoutSource("TOUR_BOOKING", 9)).rejects.toThrow(/no balance to pay/);
  });
});

describe("tour advance", () => {
  const tx = (overrides: Record<string, unknown> = {}) => ({
    id: 3,
    kind: "PAYOUT",
    status: "APPROVED",
    amount: dec("3900.00"),
    currency: "USD",
    metadata: { tranche: "ADVANCE" },
    booking: { id: 9, status: "CONFIRMED", operatorPayoutAmount: dec("13000.00"), operator: { userId: 5 } },
    ...overrides,
  });

  it("pays an approved advance to the operator", async () => {
    mocks.findTx.mockResolvedValue(tx());
    const source = await loadEligiblePayoutSource("TOUR_ADVANCE", 3);
    expect(source).toMatchObject({ sourceType: "TOUR_ADVANCE", payeeUserId: 5, currency: "USD" });
    expect(source.amount.toString()).toBe("3900");
  });

  it("refuses an advance that would pass 70% of the net share", async () => {
    mocks.findTx.mockResolvedValue(tx({ amount: dec("4000.00") }));
    mocks.listTx.mockResolvedValue([advanceRow(1, "DISBURSED", 5200)]);
    await expect(loadEligiblePayoutSource("TOUR_ADVANCE", 3)).rejects.toThrow(/above the 70% cap/);
  });

  it("refuses unapproved advances, cancelled bookings, open cases and non-advance rows", async () => {
    mocks.findTx.mockResolvedValue(tx({ status: "VERIFIED" }));
    await expect(loadEligiblePayoutSource("TOUR_ADVANCE", 3)).rejects.toThrow(/expected APPROVED/);

    mocks.findTx.mockResolvedValue(tx({ booking: { id: 9, status: "CANCELED", operatorPayoutAmount: dec("13000.00"), operator: { userId: 5 } } }));
    await expect(loadEligiblePayoutSource("TOUR_ADVANCE", 3)).rejects.toThrow(/can no longer be paid/);

    mocks.findTx.mockResolvedValue(tx());
    mocks.findCase.mockResolvedValue({ id: 12, type: "ISSUE" });
    await expect(loadEligiblePayoutSource("TOUR_ADVANCE", 3)).rejects.toThrow(/case #12/);

    mocks.findCase.mockResolvedValue(null);
    mocks.findTx.mockResolvedValue(tx({ metadata: {} }));
    await expect(loadEligiblePayoutSource("TOUR_ADVANCE", 3)).rejects.toThrow(/advance record not found/);
  });
});
