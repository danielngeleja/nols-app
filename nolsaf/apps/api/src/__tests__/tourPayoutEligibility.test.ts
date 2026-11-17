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
  listRecoveries: vi.fn(),
  listDisbursements: vi.fn(),
  listBookings: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    tourBooking: { findUnique: mocks.findBooking, findMany: mocks.listBookings },
    tourCase: { findFirst: mocks.findCase },
    // Recovery lookups (kind PAYOUT_RECOVERY) are answered separately from advance rows.
    tourFinancialTransaction: {
      findUnique: mocks.findTx,
      findMany: (args: any) => (args?.where?.kind === "PAYOUT_RECOVERY" ? mocks.listRecoveries(args) : mocks.listTx(args)),
    },
    disbursement: { findMany: mocks.listDisbursements },
  },
}));

import { BalanceFullyOffsetError, loadEligiblePayoutSource } from "../services/payouts/eligibility";

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
  mocks.listRecoveries.mockResolvedValue([]);
  mocks.listDisbursements.mockResolvedValue([]);
  mocks.listBookings.mockResolvedValue([]);
});

const recoveryRow = (id: number, amount: number, offsetApplied = 0) => ({
  id,
  tourBookingId: 40 + id,
  amount: dec(amount),
  metadata: offsetApplied ? { offsetApplied } : {},
  createdAt: new Date(`2026-10-0${id}T00:00:00Z`),
});

describe("tour balance", () => {
  const booking = { id: 9, payoutStatus: "APPROVED", operatorPayoutAmount: dec("13000.00"), operatorAgentId: 7, currency: "USD", operator: { userId: 5 } };

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

  it("takes an unpaid recovery from the balance before paying (policy 6.4)", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listTx.mockResolvedValue([advanceRow(1, "DISBURSED", 9100)]);
    mocks.listRecoveries.mockResolvedValue([recoveryRow(1, 1000, 400)]);
    const source = await loadEligiblePayoutSource("TOUR_BOOKING", 9);
    // 3900 balance, 600 still owed.
    expect(source.amount.toString()).toBe("3300");
  });

  it("does not take a debt another balance payout in flight already reserved", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listRecoveries.mockResolvedValue([recoveryRow(1, 1000)]);
    // Booking 22 owes nothing in advances, balance 5000, paying 4400: 600 reserved.
    mocks.listDisbursements.mockResolvedValue([{ sourceId: 22, amount: dec(4400) }]);
    mocks.listBookings.mockResolvedValue([{ id: 22, operatorPayoutAmount: dec(5000) }]);
    const source = await loadEligiblePayoutSource("TOUR_BOOKING", 9);
    expect(source.amount.toString()).toBe("12600");
  });

  it("reports a balance the debt absorbs entirely, so approval settles it as an offset", async () => {
    mocks.findBooking.mockResolvedValue(booking);
    mocks.listTx.mockResolvedValue([advanceRow(1, "DISBURSED", 9100)]);
    mocks.listRecoveries.mockResolvedValue([recoveryRow(1, 5000)]);
    await expect(loadEligiblePayoutSource("TOUR_BOOKING", 9)).rejects.toBeInstanceOf(BalanceFullyOffsetError);
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
