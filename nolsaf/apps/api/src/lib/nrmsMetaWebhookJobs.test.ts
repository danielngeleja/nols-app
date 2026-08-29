import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(), jobFindMany: vi.fn(), jobUpdateMany: vi.fn(), jobUpdate: vi.fn(), jobDeleteMany: vi.fn(),
  messageFindFirst: vi.fn(), messageFindMany: vi.fn(), messageUpdateMany: vi.fn(), messageFindUnique: vi.fn(), messageCreate: vi.fn(),
  connectionFindFirst: vi.fn(), connectionUpdate: vi.fn(),
  inquiryFindUnique: vi.fn(), inquiryFindFirst: vi.fn(), inquiryCreate: vi.fn(), inquiryUpdate: vi.fn(),
  emitInboxUpdate: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => {
  const client = {
    nrmsMetaWebhookJob: { createMany: mocks.createMany, findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany, update: mocks.jobUpdate, deleteMany: mocks.jobDeleteMany },
    nrmsGuestMessage: { findFirst: mocks.messageFindFirst, findMany: mocks.messageFindMany, updateMany: mocks.messageUpdateMany, findUnique: mocks.messageFindUnique, create: mocks.messageCreate },
    nrmsGuestInquiry: { findUnique: mocks.inquiryFindUnique, findFirst: mocks.inquiryFindFirst, create: mocks.inquiryCreate, update: mocks.inquiryUpdate },
    nrmsMessagingConnection: { findFirst: mocks.connectionFindFirst, update: mocks.connectionUpdate },
    $transaction: async (arg: any) => (typeof arg === "function" ? arg(client) : Promise.all(arg)),
  };
  return { typedPrisma: client };
});
vi.mock("../sockets/index.js", () => ({ emitNrmsInboxUpdate: mocks.emitInboxUpdate }));
vi.mock("./nrmsMetaMessaging.js", () => ({ sendMetaText: vi.fn() }));

import { enqueueMetaWebhookEvents, isWhatsAppCustomerWindowOpen, processMetaMessagingJobs } from "./nrmsMetaWebhookJobs.js";

/** The connected Namibia Villa record: routing is keyed on the Meta phone-number ID. */
const CONNECTED_PHONE_NUMBER_ID = "778001122334455";
const connectedProperty = {
  id: 12,
  propertyId: 1,
  ownerId: 4,
  provider: "WHATSAPP",
  status: "CONNECTED",
  phoneNumberId: CONNECTED_PHONE_NUMBER_ID,
  property: { id: 1, ownerId: 4, title: "Namibia Villa", nrmsGuestContactSettings: null },
};

function inboundJob(overrides: { id?: number; providerMessageId?: string; accountId?: string } = {}) {
  return {
    id: overrides.id ?? 77,
    status: "PENDING",
    propertyId: null,
    attemptCount: 0,
    availableAt: new Date("2026-08-25T11:00:00Z"),
    payload: {
      kind: "MESSAGE",
      provider: "WHATSAPP",
      accountId: overrides.accountId ?? CONNECTED_PHONE_NUMBER_ID,
      senderId: "255700000001",
      providerMessageId: overrides.providerMessageId ?? "wamid.HBgMMjU1NzAwMDAwMDAx",
      senderName: "Amina",
      body: "Do you have a room for 2026-09-01 to 2026-09-04?",
      attachment: null,
      occurredAt: "2026-08-25T11:00:00.000Z",
    },
  };
}

describe("durable Meta messaging jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createMany.mockResolvedValue({ count: 1 });
    mocks.jobFindMany.mockResolvedValue([]);
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.jobUpdate.mockResolvedValue({});
    mocks.jobDeleteMany.mockResolvedValue({ count: 0 });
    mocks.messageFindMany.mockResolvedValue([]);
    mocks.messageUpdateMany.mockResolvedValue({ count: 0 });
    mocks.messageFindUnique.mockResolvedValue(null);
    mocks.messageCreate.mockResolvedValue({ id: 1 });
    mocks.connectionFindFirst.mockResolvedValue(null);
    mocks.connectionUpdate.mockResolvedValue({});
    mocks.inquiryFindUnique.mockResolvedValue(null);
    mocks.inquiryFindFirst.mockResolvedValue(null);
    mocks.inquiryCreate.mockResolvedValue(null);
    mocks.inquiryUpdate.mockResolvedValue({});
  });

  it("stores normalized events with deterministic idempotency keys", async () => {
    const event = { kind: "MESSAGE" as const, provider: "WHATSAPP" as const, accountId: "phone-1", senderId: "255700000001", providerMessageId: "wamid.1", senderName: "Amina", body: "Hello", attachment: null, occurredAt: new Date("2026-08-25T12:00:00Z") };
    await enqueueMetaWebhookEvents([event]);
    await enqueueMetaWebhookEvents([event]);
    const first = mocks.createMany.mock.calls[0][0].data[0];
    const second = mocks.createMany.mock.calls[1][0].data[0];
    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(first.payload).toMatchObject({ providerMessageId: "wamid.1", occurredAt: "2026-08-25T12:00:00.000Z" });
    expect(mocks.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true }));
  });

  it("allows free-form WhatsApp replies only inside the 24-hour customer window", async () => {
    const now = new Date("2026-08-25T12:00:00Z");
    mocks.messageFindFirst.mockResolvedValueOnce({ createdAt: new Date("2026-08-24T13:00:00Z") }).mockResolvedValueOnce({ createdAt: new Date("2026-08-24T11:59:59Z") });
    await expect(isWhatsAppCustomerWindowOpen(9, now)).resolves.toBe(true);
    await expect(isWhatsAppCustomerWindowOpen(9, now)).resolves.toBe(false);
    expect(mocks.messageFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { inquiryId: 9, direction: "INBOUND", channel: "WHATSAPP" } }));
  });

  it("recovers expired claims and retries a webhook that cannot yet resolve its connection", async () => {
    mocks.jobFindMany.mockResolvedValue([{ id: 44, status: "PENDING", propertyId: null, attemptCount: 0, availableAt: new Date("2026-08-25T11:00:00Z"), payload: { kind: "MESSAGE", provider: "WHATSAPP", accountId: "phone-1", senderId: "255700000001", providerMessageId: "wamid.2", senderName: null, body: "Hello", attachment: null, occurredAt: "2026-08-25T11:00:00.000Z" } }]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const result = await processMetaMessagingJobs(new Date("2026-08-25T12:00:00Z"));
    expect(result.inbound).toEqual({ completed: 0, retried: 1, dead: 0 });
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 44 }, data: expect.objectContaining({ status: "RETRY", lastError: "META_CONNECTION_NOT_FOUND" }) }));
    expect(mocks.messageUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ deliveryStatus: "SENDING" }), data: expect.objectContaining({ deliveryStatus: "RETRY" }) }));
  });

  it("routes a queued WhatsApp message to the property that owns the Meta phone-number ID", async () => {
    mocks.jobFindMany.mockResolvedValue([inboundJob()]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.connectionFindFirst.mockResolvedValue(connectedProperty);
    mocks.inquiryCreate.mockResolvedValue({ id: 501, propertyId: 1, guestName: "Amina", guestPhone: "255700000001", checkIn: null, checkOut: null, status: "OPEN" });

    const result = await processMetaMessagingJobs(new Date("2026-08-25T12:00:00Z"));

    expect(mocks.connectionFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { provider: "WHATSAPP", phoneNumberId: CONNECTED_PHONE_NUMBER_ID, status: "CONNECTED" },
    }));
    expect(result.inbound).toEqual({ completed: 1, retried: 0, dead: 0 });
    expect(mocks.inquiryCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ propertyId: 1, ownerId: 4, channel: "WHATSAPP", guestPhone: "255700000001", externalConversationId: "255700000001" }),
    }));
    expect(mocks.messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ inquiryId: 501, direction: "INBOUND", channel: "WHATSAPP", providerMessageId: "wamid.HBgMMjU1NzAwMDAwMDAx" }),
    }));
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 77 }, data: expect.objectContaining({ status: "COMPLETED", propertyId: 1 }) }));
    expect(mocks.emitInboxUpdate).toHaveBeenCalledWith(1, { reason: "webhook", inquiryId: 501 });
  });

  it("does not store a second transcript entry when Meta redelivers the same message id", async () => {
    mocks.jobFindMany.mockResolvedValue([inboundJob({ id: 78 })]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.connectionFindFirst.mockResolvedValue(connectedProperty);
    mocks.messageFindUnique.mockResolvedValue({ id: 900, inquiryId: 501 });

    const result = await processMetaMessagingJobs(new Date("2026-08-25T12:00:00Z"));

    expect(result.inbound).toEqual({ completed: 1, retried: 0, dead: 0 });
    expect(mocks.inquiryCreate).not.toHaveBeenCalled();
    expect(mocks.messageCreate).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 78 }, data: expect.objectContaining({ status: "COMPLETED", propertyId: 1 }) }));
  });

  it("keeps a message for an unknown phone-number ID out of every property inbox", async () => {
    mocks.jobFindMany.mockResolvedValue([inboundJob({ id: 79, accountId: "123456123" })]);
    mocks.jobUpdateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    mocks.connectionFindFirst.mockResolvedValue(null);

    const result = await processMetaMessagingJobs(new Date("2026-08-25T12:00:00Z"));

    expect(result.inbound).toEqual({ completed: 0, retried: 1, dead: 0 });
    expect(mocks.inquiryCreate).not.toHaveBeenCalled();
    expect(mocks.jobUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 79 }, data: expect.objectContaining({ status: "RETRY", lastError: "META_CONNECTION_NOT_FOUND" }) }));
  });
});
