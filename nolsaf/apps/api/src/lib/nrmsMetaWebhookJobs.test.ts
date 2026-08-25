import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createMany: vi.fn(), jobFindMany: vi.fn(), jobUpdateMany: vi.fn(), jobUpdate: vi.fn(), jobDeleteMany: vi.fn(),
  messageFindFirst: vi.fn(), messageFindMany: vi.fn(), messageUpdateMany: vi.fn(),
  connectionFindFirst: vi.fn(),
}));
vi.mock("@nolsaf/prisma", () => ({ typedPrisma: {
  nrmsMetaWebhookJob: { createMany: mocks.createMany, findMany: mocks.jobFindMany, updateMany: mocks.jobUpdateMany, update: mocks.jobUpdate, deleteMany: mocks.jobDeleteMany },
  nrmsGuestMessage: { findFirst: mocks.messageFindFirst, findMany: mocks.messageFindMany, updateMany: mocks.messageUpdateMany },
  nrmsMessagingConnection: { findFirst: mocks.connectionFindFirst },
} }));
vi.mock("../sockets/index.js", () => ({ emitNrmsInboxUpdate: vi.fn() }));
vi.mock("./nrmsMetaMessaging.js", () => ({ sendMetaText: vi.fn() }));

import { enqueueMetaWebhookEvents, isWhatsAppCustomerWindowOpen, processMetaMessagingJobs } from "./nrmsMetaWebhookJobs.js";

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
    mocks.connectionFindFirst.mockResolvedValue(null);
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
});
