import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendSms: vi.fn(),
  journeyFind: vi.fn(), journeyClaim: vi.fn(), journeyUpdate: vi.fn(),
  reviewFind: vi.fn(), reviewClaim: vi.fn(), reviewUpdate: vi.fn(),
  paymentFind: vi.fn(), paymentUpdate: vi.fn(),
  reservationFind: vi.fn(), reservationUpdateMany: vi.fn(), transaction: vi.fn(), paymentUpdateMany: vi.fn(), reservationEventCreate: vi.fn(),
}));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: {
  nrmsJourneyDelivery: { findMany: mocks.journeyFind, updateMany: mocks.journeyClaim, update: mocks.journeyUpdate },
  nrmsReviewRequest: { findMany: mocks.reviewFind, updateMany: mocks.reviewClaim, update: mocks.reviewUpdate },
  nrmsGuestPaymentRequest: { findMany: mocks.paymentFind, update: mocks.paymentUpdate, updateMany: mocks.paymentUpdateMany },
  reservation: { findMany: mocks.reservationFind, updateMany: mocks.reservationUpdateMany },
  reservationEvent: { create: mocks.reservationEventCreate },
  $transaction: mocks.transaction,
} }));
vi.mock("../lib/sms.js", () => ({ sendSms: mocks.sendSms }));
vi.mock("../lib/nrmsWorkerHealth.js", () => ({ runNrmsWorker: vi.fn((_name, task) => task()) }));

import { processNrmsGuestAutomation } from "./nrmsGuestAutomation.js";

describe("NRMS guest automation", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.journeyFind.mockResolvedValue([]); mocks.reviewFind.mockResolvedValue([]); mocks.paymentFind.mockResolvedValue([]); mocks.reservationFind.mockResolvedValue([]); mocks.transaction.mockResolvedValue([]); mocks.paymentUpdateMany.mockResolvedValue({ count: 0 }); mocks.reservationEventCreate.mockResolvedValue({ id: 1 });
    mocks.journeyClaim.mockResolvedValue({ count: 1 }); mocks.reviewClaim.mockResolvedValue({ count: 1 }); mocks.sendSms.mockResolvedValue({ success: true, provider: "test", messageId: "msg-1" });
  });

  it("claims and sends due journey deliveries once", async () => {
    mocks.journeyFind.mockResolvedValue([{ id: 7, renderedMessage: "Welcome Asha", template: { channel: "SMS" }, guestProfile: { phone: "+255700000000" } }]);
    const result = await processNrmsGuestAutomation(new Date("2026-07-22T10:00:00Z"));
    expect(result.journeys).toBe(1); expect(mocks.sendSms).toHaveBeenCalledWith("+255700000000", "Welcome Asha");
    expect(mocks.journeyUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT", providerMessageId: "msg-1" }) }));
  });

  it("expires unpaid direct holds and cancels their payment request", async () => {
    mocks.reservationFind.mockResolvedValue([{ id: 9 }]); mocks.reservationUpdateMany.mockResolvedValue({ count: 1 });
    const result = await processNrmsGuestAutomation(new Date("2026-07-22T10:00:00Z"));
    expect(result.expiredHolds).toBe(1); expect(mocks.paymentUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { reservationId: 9, status: "PENDING" } }));
    expect(mocks.reservationEventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reservationId: 9, type: "EXPIRED" }) }));
  });

  it("creates private token links for review and hotel-direct payment messages", async () => {
    mocks.reviewFind.mockResolvedValue([{ id: 2, publicToken: "review-token", guestProfile: { phone: "+255711111111" }, property: { title: "Lake Hotel" } }]);
    mocks.paymentFind.mockResolvedValue([{ id: 3, amount: 50000, currency: "TZS", publicToken: "pay-token", reservation: { guestProfile: { phone: "+255722222222" }, property: { title: "Lake Hotel" } } }]);
    const result = await processNrmsGuestAutomation(new Date("2026-07-22T10:00:00Z"));
    expect(result).toEqual({ expiredHolds: 0, journeys: 0, reviews: 1, payments: 1 });
    expect(mocks.sendSms.mock.calls[0][1]).toContain("/nrms/guest/review/review-token"); expect(mocks.sendSms.mock.calls[1][1]).toContain("/nrms/guest/payment/pay-token");
    expect(mocks.paymentUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ reminderCount: { increment: 1 } }) }));
  });
});
