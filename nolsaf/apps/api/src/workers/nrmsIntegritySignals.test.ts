import { beforeEach, describe, expect, it, vi } from "vitest";

const upsert = vi.fn();
const reservationEvents = vi.fn();

vi.mock("@nolsaf/prisma", () => ({
  prisma: {
    ownerPaygAccount: { findMany: vi.fn().mockResolvedValue([{ propertyId: 19 }]) },
    nrmsOutletOrder: { findMany: vi.fn().mockResolvedValue([]) },
    reservationCharge: { findMany: vi.fn().mockResolvedValue([]) },
    nrmsNightAuditRun: { findFirst: vi.fn().mockResolvedValue(null) },
    nrmsCashierShift: { findMany: vi.fn().mockResolvedValue([]) },
    reservationEvent: { findMany: reservationEvents },
    nrmsPublicMetric: { findMany: vi.fn().mockResolvedValue([]) },
    nrmsIntegritySignal: { upsert },
  },
}));

describe("NRMS checkout integrity signals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    reservationEvents.mockResolvedValue([]);
  });

  it("raises a high-severity signal when a checked-out room remains active through its QR point", async () => {
    reservationEvents.mockResolvedValue([
      { id: 81, type: "POST_CHECKOUT_ROOM_ACTIVITY", reservationId: 41, data: { orderId: 900 } },
    ]);
    const { computeNrmsIntegritySignals } = await import("./nrmsIntegritySignals.js");

    await computeNrmsIntegritySignals(new Date("2026-09-10T08:00:00.000Z"));

    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        propertyId: 19,
        kind: "POST_CHECKOUT_ROOM_ACTIVITY",
        severity: "HIGH",
        metricValue: 1,
        details: expect.objectContaining({ reservationIds: [41], eventIds: [81] }),
      }),
    }));
  });
});
