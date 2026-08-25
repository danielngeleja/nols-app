import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    nrmsGuestInquiry: { findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    nrmsGuestMessage: { create: vi.fn() },
    ownerPaygAccount: { findUnique: vi.fn() },
  },
  loadAccess: vi.fn(),
  createHold: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 19, role: "FRONT_DESK", name: "Reception A", email: "desk@example.com" }; next(); },
}));
vi.mock("../lib/nrmsPropertyAccess.js", () => ({ loadNrmsPropertyAccess: mocks.loadAccess }));
vi.mock("../lib/nrmsInquiryConversion.js", () => ({ createInquiryRoomHold: mocks.createHold }));
vi.mock("../lib/nrms.js", () => ({ NRMS_BILLING_BLOCKING_STATUSES: ["PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"], nrmsBillingBlockPayload: vi.fn() }));

import { router } from "./owner.nrms.inquiries.js";

describe("reception-safe inquiry conversion route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAccess.mockResolvedValue({ role: "FRONT_DESK", actorId: 19, ownerId: 2, property: { id: 7, ownerId: 2, title: "Hotel" } });
    mocks.prisma.nrmsGuestInquiry.findFirst.mockResolvedValue({ id: 41, propertyId: 7, ownerId: 2, reference: "INQ-7-TEST", status: "OPEN", version: 3, messages: [] });
    mocks.prisma.nrmsGuestInquiry.update.mockResolvedValue({ id: 41, version: 4 });
    mocks.prisma.nrmsGuestInquiry.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.nrmsGuestMessage.create.mockResolvedValue({ id: 90, direction: "OUTBOUND", deliveryStatus: "RECORDED" });
    mocks.prisma.$transaction.mockImplementation(async (callback: (client: any) => unknown) => callback(mocks.prisma));
    mocks.prisma.ownerPaygAccount.findUnique.mockResolvedValue({ id: 6, propertyId: 7, status: "ACTIVE" });
    mocks.createHold.mockResolvedValue({ ok: true, reservationId: 501, status: "HELD", expiresAt: new Date("2026-09-01T11:00:00.000Z"), totalAmount: 200_000, roomRate: 100_000, currency: "TZS" });
  });

  it("lets front desk respond and create a hold without opening the owner reservation endpoint", async () => {
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/inquiries", router);
    await request(app)
      .post("/api/owner/nrms/inquiries/property/7/41/messages")
      .send({ version: 3, body: "We have a Deluxe room available for your dates.", direction: "OUTBOUND", deliveryMode: "RECORD" })
      .expect(201);
    const response = await request(app)
      .post("/api/owner/nrms/inquiries/property/7/41/hold")
      .send({ version: 3, guestName: "Amina Hassan", guestPhone: "+255700000001", guestEmail: "amina@example.com", checkIn: "2026-09-12", checkOut: "2026-09-14", roomTypeId: 12, adults: 2, children: 0 })
      .expect(201);

    expect(response.body.hold).toMatchObject({ ok: true, reservationId: 501, status: "HELD" });
    expect(mocks.prisma.nrmsGuestMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ inquiryId: 41, direction: "OUTBOUND", body: "We have a Deluxe room available for your dates." }) }));
    expect(mocks.loadAccess).toHaveBeenCalledWith(expect.anything(), expect.anything(), 7, ["OWNER", "MANAGER", "FRONT_DESK"]);
    expect(mocks.createHold).toHaveBeenCalledWith(expect.objectContaining({ propertyId: 7, ownerId: 2, actorId: 19, inquiryId: 41, version: 3 }));
  });

  it("stops a stale receptionist reply before a duplicate message is created", async () => {
    mocks.prisma.nrmsGuestInquiry.updateMany.mockResolvedValue({ count: 0 });
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/inquiries", router);
    const response = await request(app)
      .post("/api/owner/nrms/inquiries/property/7/41/messages")
      .send({ version: 2, body: "This view is stale", direction: "OUTBOUND", deliveryMode: "RECORD" })
      .expect(409);
    expect(response.body.code).toBe("VERSION_CONFLICT");
    expect(mocks.prisma.nrmsGuestMessage.create).not.toHaveBeenCalled();
  });
});
