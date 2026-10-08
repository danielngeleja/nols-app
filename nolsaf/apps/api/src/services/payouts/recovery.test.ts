import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

const m = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    ownerPayoutRecovery: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findUniqueOrThrow: vi.fn() },
    ownerPayoutRecoveryApplication: { create: vi.fn(), aggregate: vi.fn() },
    invoice: { findFirst: vi.fn() },
    disbursement: { aggregate: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  collected: vi.fn(),
  notifyOwner: vi.fn(),
  notifyAdmins: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ prisma: m.prisma }));
vi.mock("./eligibility.js", () => ({ confirmedCustomerPaymentForBooking: m.collected }));
vi.mock("../../lib/notifications.js", () => ({ notifyOwner: m.notifyOwner, notifyAdmins: m.notifyAdmins }));

import { addBusinessDays, applyRecoveriesToClaim, ownerShareOfGuestAmount, recordRecovery } from "./recovery.js";

const NOW = new Date("2026-10-07T09:00:00Z"); // Wednesday

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.$transaction.mockImplementation(async (fn: any) => fn(m.prisma));
  m.prisma.auditLog.create.mockResolvedValue({});
  m.notifyOwner.mockResolvedValue(undefined);
  m.prisma.ownerPayoutRecovery.findUnique.mockResolvedValue(null);
  m.prisma.invoice.findFirst.mockResolvedValue({ id: 101, ownerId: 3, netPayable: new Prisma.Decimal(180000) });
  m.prisma.disbursement.aggregate.mockResolvedValue({ _sum: { amount: new Prisma.Decimal(180000) } });
  m.collected.mockResolvedValue(new Prisma.Decimal(200000));
  m.prisma.ownerPayoutRecovery.create.mockImplementation(async ({ data }: any) => ({ id: 1, ...data }));
});

describe("ownerShareOfGuestAmount", () => {
  it("is proportional to the owner's part of the guest payment", () => {
    // Guest paid 200,000; owner's net 180,000 (90%); refund 50,000 -> owner share 45,000.
    expect(ownerShareOfGuestAmount({ guestAmount: 50000, ownerNet: 180000, guestPaid: 200000, ownerPaid: 180000 })).toBe(45000);
  });

  it("never exceeds what the owner was paid", () => {
    expect(ownerShareOfGuestAmount({ guestAmount: 400000, ownerNet: 180000, guestPaid: 200000, ownerPaid: 180000 })).toBe(180000);
  });

  it("is zero when nothing was refunded or nothing was paid", () => {
    expect(ownerShareOfGuestAmount({ guestAmount: 0, ownerNet: 180000, guestPaid: 200000, ownerPaid: 180000 })).toBe(0);
    expect(ownerShareOfGuestAmount({ guestAmount: 50000, ownerNet: 180000, guestPaid: 200000, ownerPaid: 0 })).toBe(0);
  });
});

describe("addBusinessDays", () => {
  it("skips the weekend", () => {
    // Wednesday + 7 business days = the Friday of the following week.
    expect(addBusinessDays(NOW, 7).toISOString()).toBe("2026-10-16T09:00:00.000Z");
  });
});

describe("recordRecovery", () => {
  it("records the owner's share with a 7 business day due date", async () => {
    await recordRecovery({ kind: "REFUND", reference: "cx:9", bookingId: 501, guestAmount: 50000, createdById: 12, now: NOW });
    const data = m.prisma.ownerPayoutRecovery.create.mock.calls[0][0].data;
    expect(Number(data.amount)).toBe(45000);
    expect(data).toMatchObject({ ownerId: 3, sourceInvoiceId: 101, kind: "REFUND", reference: "cx:9" });
    expect(data.dueAt.toISOString()).toBe("2026-10-16T09:00:00.000Z");
    expect(m.notifyOwner).toHaveBeenCalledWith(3, "owner_payout_recovery_opened", expect.objectContaining({ amountText: "TZS 45,000" }));
  });

  it("refuses when the owner was not paid (the hold applies instead)", async () => {
    m.prisma.disbursement.aggregate.mockResolvedValue({ _sum: { amount: null } });
    await expect(recordRecovery({ kind: "REFUND", reference: "cx:9", bookingId: 501, guestAmount: 50000 })).rejects.toMatchObject({ code: "NOT_PAID" });
    expect(m.prisma.ownerPayoutRecovery.create).not.toHaveBeenCalled();
  });

  it("is idempotent per reference", async () => {
    m.prisma.ownerPayoutRecovery.findUnique.mockResolvedValue({ id: 7 });
    expect(await recordRecovery({ kind: "CHARGEBACK", reference: "cb:X1", bookingId: 501, guestAmount: 50000 })).toEqual({ id: 7 });
    expect(m.prisma.ownerPayoutRecovery.create).not.toHaveBeenCalled();
  });
});

describe("applyRecoveriesToClaim", () => {
  it("takes the oldest debts first, up to the claim, and closes what it covers", async () => {
    m.prisma.ownerPayoutRecovery.findMany.mockResolvedValue([
      { id: 1, amount: new Prisma.Decimal(30000), recoveredAmount: new Prisma.Decimal(0) },
      { id: 2, amount: new Prisma.Decimal(100000), recoveredAmount: new Prisma.Decimal(0) },
    ]);
    m.prisma.ownerPayoutRecovery.updateMany.mockResolvedValue({ count: 1 });
    const deducted = await applyRecoveriesToClaim(3, 202, 80000, NOW);
    expect(deducted).toBe(80000);
    expect(m.prisma.ownerPayoutRecovery.updateMany.mock.calls[0][0].data).toMatchObject({ status: "RECOVERED" });
    expect(m.prisma.ownerPayoutRecovery.updateMany.mock.calls[1][0].data).not.toHaveProperty("status");
    expect(m.prisma.ownerPayoutRecoveryApplication.create.mock.calls.map((c: any) => Number(c[0].data.amount))).toEqual([30000, 50000]);
  });

  it("skips a debt another withdrawal changed at the same moment", async () => {
    m.prisma.ownerPayoutRecovery.findMany.mockResolvedValue([
      { id: 1, amount: new Prisma.Decimal(30000), recoveredAmount: new Prisma.Decimal(0) },
    ]);
    m.prisma.ownerPayoutRecovery.updateMany.mockResolvedValue({ count: 0 });
    expect(await applyRecoveriesToClaim(3, 202, 80000, NOW)).toBe(0);
    expect(m.prisma.ownerPayoutRecoveryApplication.create).not.toHaveBeenCalled();
  });
});
