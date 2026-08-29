import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const saved = {
    reservation: {
      id: 501, externalRef: "DIRECT-PLACEHOLDER", status: "HELD", holdExpiresAt: new Date("2026-09-12T10:30:00.000Z"),
      totalAmount: 200_000, depositAmount: 40_000, currency: "TZS",
    },
    payment: { id: 601, publicToken: "payment-capability-token", cancelledAt: null, createdAt: new Date("2026-08-25T08:00:00.000Z") },
  };
  const tx: any = {
    reservation: { findFirst: vi.fn(), create: vi.fn() },
    guestProfile: { create: vi.fn() },
    nrmsGuestPaymentRequest: { create: vi.fn() },
  };
  const prisma: any = {
    property: { findFirst: vi.fn() }, roomType: { findMany: vi.fn() }, nrmsRateRestriction: { findMany: vi.fn() }, nrmsRatePlan: { findFirst: vi.fn() },
    nrmsPublicMetric: { upsert: vi.fn() }, $transaction: vi.fn(),
  };
  return { saved, tx, prisma, lock: vi.fn(), getAvailability: vi.fn(), getAvailabilities: vi.fn(), restrictions: vi.fn() };
});

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/rateLimit.js", () => ({
  limitPublicNrmsDirectHold: (_req: any, _res: any, next: any) => next(),
  limitPublicNrmsDirectQuote: (_req: any, _res: any, next: any) => next(),
  limitPublicNrmsGuestCapability: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/nrmsAvailability.js", () => ({
  lockPropertyInventory: mocks.lock,
  getRoomTypeAvailability: mocks.getAvailability,
  getRoomTypesAvailability: mocks.getAvailabilities,
}));
vi.mock("../lib/nrmsRestrictions.js", async (importOriginal) => {
  const original = await importOriginal<any>();
  return { ...original, findRestrictionBlocks: mocks.restrictions };
});

import { router } from "./public.nrmsGuest.js";

describe("public direct hold route idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.property.findFirst.mockResolvedValue({ id: 19, ownerId: 4, title: "Test Hotel", currency: "TZS", nrmsGuestPayInstructions: {}, nrmsGuestContactSettings: {} });
    mocks.prisma.roomType.findMany.mockResolvedValue([{ id: 12, name: "Deluxe", description: null, capacityAdults: 2, capacityChildren: 1, images: null, baseRate: 100_000, currency: "TZS", ratePlans: [] }]);
    mocks.prisma.nrmsRateRestriction.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsRatePlan.findFirst.mockResolvedValue(null);
    mocks.getAvailabilities.mockResolvedValue(new Map([[12, { capacity: 2, consumed: 0, available: 2 }]]));
    mocks.getAvailability.mockResolvedValue({ capacity: 2, consumed: 0, available: 2 });
    mocks.restrictions.mockResolvedValue([]);
    mocks.tx.guestProfile.create.mockResolvedValue({ id: 88 });
    mocks.tx.reservation.create.mockImplementation(async ({ data }: any) => ({ ...mocks.saved.reservation, externalRef: data.externalRef }));
    mocks.tx.nrmsGuestPaymentRequest.create.mockResolvedValue(mocks.saved.payment);
    mocks.tx.reservation.findFirst
      .mockResolvedValueOnce(null)
      .mockImplementation(async ({ where }: any) => ({ ...mocks.saved.reservation, externalRef: where.externalRef, paymentRequests: [mocks.saved.payment] }));
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(mocks.tx));
  });

  it("creates once and replays the original hold on a repeated request", async () => {
    const app = express(); app.use(express.json()); app.use("/api/public/nrms/guest", router);
    const body = {
      clientRequestId: "71cff681-6fca-4384-b683-b12f487d560d", checkIn: "2026-09-12", checkOut: "2026-09-14", adults: 2, children: 0, source: "INSTAGRAM",
      roomTypeId: 12, ratePlanId: null, guest: { fullName: "Amina Hassan", phone: "+255700000001", email: "amina@example.com", nationality: "TZ" }, termsAccepted: true,
    };
    const first = await request(app).post("/api/public/nrms/guest/direct/19/hold").send(body).expect(201);
    const retry = await request(app).post("/api/public/nrms/guest/direct/19/hold").send(body).expect(200);

    expect(retry.body.replayed).toBe(true);
    expect(retry.body.hold.reference).toBe(first.body.hold.reference);
    expect(retry.body.hold.paymentToken).toBe(first.body.hold.paymentToken);
    expect(mocks.tx.guestProfile.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.reservation.create).toHaveBeenCalledTimes(1);
    expect(mocks.tx.nrmsGuestPaymentRequest.create).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.nrmsPublicMetric.upsert).toHaveBeenCalledTimes(1);
  });
});
