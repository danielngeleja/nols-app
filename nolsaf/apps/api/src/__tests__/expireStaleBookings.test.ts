import { describe, expect, it, vi } from "vitest";
import { purgeBookings } from "../workers/expireStaleBookings";

describe("expired booking purge", () => {
  it("preserves newly protected payments and writes durable evidence for deletable drafts", async () => {
    const purgedAt = new Date("2026-08-08T12:00:00.000Z");
    const tx = {
      invoice: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      booking: {
        findMany: vi.fn()
          .mockResolvedValueOnce([{ id: 10 }])
          .mockResolvedValueOnce([{ id: 10 }])
          .mockResolvedValueOnce([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      auditLog: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
      transportBooking: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) => operation(tx)) };

    await purgeBookings(
      [{
        id: 10,
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        invoices: [{ status: "PENDING" }],
      }],
      "expired draft",
      true,
      purgedAt,
      client
    );

    expect(tx.invoice.deleteMany).toHaveBeenCalledWith({
      where: {
        bookingId: { in: [10] },
        status: { notIn: ["PROCESSING", "PAID", "CUSTOMER_PAID"] },
      },
    });
    expect(tx.invoice.deleteMany.mock.invocationCallOrder[0]).toBeGreaterThan(
      tx.booking.findMany.mock.invocationCallOrder[0]
    );
    expect(tx.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        invoices: { none: { status: { in: ["PROCESSING", "PAID", "CUSTOMER_PAID"] } } },
      }),
    }));
    expect(tx.auditLog.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        action: "BOOKING_DRAFT_EXPIRED_PURGED",
        entity: "BOOKING",
        entityId: 10,
        retentionClass: "OPERATIONAL",
        expiresAt: new Date("2028-08-08T12:00:00.000Z"),
      })],
    });
    expect(tx.booking.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [10] }, status: "NEW", code: null, invoices: { none: {} } },
    });
    expect(client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { timeout: 15_000, isolationLevel: "Serializable" }
    );
  });

  it("does not delete invoices when a booking becomes payment protected", async () => {
    const tx = {
      invoice: { deleteMany: vi.fn() },
      booking: {
        findMany: vi.fn().mockResolvedValueOnce([]),
        deleteMany: vi.fn(),
      },
      auditLog: { createMany: vi.fn() },
      transportBooking: { deleteMany: vi.fn() },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => unknown) => operation(tx)) };

    await purgeBookings(
      [{
        id: 11,
        createdAt: new Date("2026-08-01T12:00:00.000Z"),
        invoices: [{ status: "PENDING" }],
      }],
      "expired draft",
      true,
      new Date("2026-08-08T12:00:00.000Z"),
      client
    );

    expect(tx.invoice.deleteMany).not.toHaveBeenCalled();
    expect(tx.booking.deleteMany).not.toHaveBeenCalled();
  });
});
