import { beforeEach, describe, expect, it, vi } from "vitest";
import { queueNrmsCheckInWelcome } from "./nrmsCheckInWelcome.js";

function eligibleReservation(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    propertyId: 7,
    guestProfileId: 12,
    status: "CHECKED_IN",
    property: { title: "NoLSAF Hotel", nrmsActivatedAt: new Date("2026-01-01T00:00:00Z"), nrmsQrOrderingFrozenAt: null },
    guestProfile: { fullName: "Daniel Ngeleja", phone: "+255700000000" },
    allocations: [{ roomUnitId: 204 }],
    ...overrides,
  };
}

function fakeDb(reservation = eligibleReservation()) {
  return {
    reservation: { findUnique: vi.fn().mockResolvedValue(reservation) },
    nrmsOrderPoint: { findFirst: vi.fn().mockResolvedValue({ id: 8, token: "secure-room-token" }) },
    nrmsOutlet: { findMany: vi.fn().mockResolvedValue([{ type: "RESTAURANT" }, { type: "BAR" }]) },
    nrmsJourneyTemplate: { upsert: vi.fn().mockResolvedValue({ id: 9 }) },
    nrmsJourneyDelivery: {
      findUnique: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 10 }),
    },
  };
}

describe("NRMS automatic check-in welcome", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("WEB_ORIGIN", "https://app.nolsaf.test/");
  });

  it("queues one personalized room-ordering SMS for an eligible check-in", async () => {
    const db = fakeDb();
    const result = await queueNrmsCheckInWelcome(db, 41);

    expect(result).toEqual({ status: "QUEUED", deliveryId: 10, orderPointId: 8 });
    expect(db.nrmsOrderPoint.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: "ROOM", roomUnitId: { in: [204] }, active: true, orderingEnabled: true }),
    }));
    expect(db.nrmsJourneyDelivery.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({
        reservationId: 41,
        guestProfileId: 12,
        renderedMessage: "Welcome Daniel Ngeleja to NoLSAF Hotel! Don't worry about food and drinks. We have them here. Tap to order from your room: https://app.nolsaf.test/menu/secure-room-token\nQuality Stay for Every Wallet",
      }),
      update: {},
    }));
  });

  it("is idempotent when the same check-in is retried", async () => {
    const db = fakeDb();
    db.nrmsJourneyDelivery.findUnique.mockResolvedValue({ id: 10 });

    const result = await queueNrmsCheckInWelcome(db, 41);

    expect(result.status).toBe("ALREADY_QUEUED");
    expect(db.nrmsJourneyDelivery.upsert).toHaveBeenCalledTimes(1);
  });

  it("skips when the assigned room does not have an active QR ordering point", async () => {
    const db = fakeDb();
    db.nrmsOrderPoint.findFirst.mockResolvedValue(null);

    await expect(queueNrmsCheckInWelcome(db, 41)).resolves.toEqual({ status: "SKIPPED", reason: "NO_ACTIVE_ROOM_QR" });
    expect(db.nrmsJourneyTemplate.upsert).not.toHaveBeenCalled();
  });

  it("skips properties without an active restaurant or bar", async () => {
    const db = fakeDb();
    db.nrmsOutlet.findMany.mockResolvedValue([]);

    await expect(queueNrmsCheckInWelcome(db, 41)).resolves.toEqual({ status: "SKIPPED", reason: "NO_ACTIVE_OUTLET" });
    expect(db.nrmsJourneyDelivery.upsert).not.toHaveBeenCalled();
  });

  it("skips checkout and other non-active stay states", async () => {
    const db = fakeDb(eligibleReservation({ status: "CHECKED_OUT" }));

    await expect(queueNrmsCheckInWelcome(db, 41)).resolves.toEqual({ status: "SKIPPED", reason: "NOT_CHECKED_IN" });
    expect(db.nrmsOrderPoint.findFirst).not.toHaveBeenCalled();
  });
});
