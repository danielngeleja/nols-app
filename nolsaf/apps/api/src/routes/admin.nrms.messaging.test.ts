import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const prisma: any = {
    nrmsMessagingConnection: { findMany: vi.fn(), groupBy: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    nrmsMetaWebhookJob: { groupBy: vi.fn(), findMany: vi.fn() },
    nrmsGuestMessage: { groupBy: vi.fn(), findMany: vi.fn() },
    nrmsGuestInquiry: { groupBy: vi.fn() },
    nrmsWorkerHealth: { findUnique: vi.fn() },
    property: { findUnique: vi.fn() },
    adminAudit: { create: vi.fn() },
  };
  prisma.$transaction = vi.fn(async (value: any) => typeof value === "function" ? value(prisma) : Promise.all(value));
  return { prisma, replay: vi.fn(), diagnose: vi.fn() };
});

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 91, role: "ADMIN" }; next(); },
  requireRole: () => (_req: any, _res: any, next: any) => next(),
  blockImpersonated: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../lib/nrmsMetaWebhookJobs.js", () => ({ replayMetaMessagingFailures: mocks.replay }));
vi.mock("../lib/nrmsMetaDiagnostics.js", () => ({ runNrmsMetaDiagnostic: mocks.diagnose }));

import router from "./admin.nrms.messaging.js";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use("/api/admin/nrms/messaging", router);
  return instance;
}

describe("admin Meta messaging operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.nrmsMessagingConnection.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsMessagingConnection.groupBy.mockResolvedValue([]);
    mocks.prisma.nrmsMetaWebhookJob.groupBy.mockResolvedValue([]);
    mocks.prisma.nrmsMetaWebhookJob.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsGuestMessage.groupBy.mockResolvedValue([]);
    mocks.prisma.nrmsGuestMessage.findMany.mockResolvedValue([]);
    mocks.prisma.nrmsGuestInquiry.groupBy.mockResolvedValue([]);
    mocks.prisma.nrmsWorkerHealth.findUnique.mockResolvedValue(null);
    mocks.prisma.adminAudit.create.mockResolvedValue({ id: 1 });
    mocks.replay.mockResolvedValue({ webhookJobs: 2, outboundMessages: 3 });
    mocks.diagnose.mockResolvedValue({ provider: "WHATSAPP", propertyId: 19, checkedAt: "2026-08-25T15:00:00.000Z", verdict: "HEALTHY", checks: [{ id: "worker", label: "Worker", status: "PASS", detail: "Healthy" }], evidence: { storedPhoneNumberId: "8001" } });
  });

  it("returns a platform overview without exposing stored Meta credentials", async () => {
    mocks.prisma.nrmsMessagingConnection.findMany.mockResolvedValue([{
      id: 8,
      propertyId: 19,
      ownerId: 4,
      provider: "WHATSAPP",
      status: "CONNECTED",
      displayName: "Hotel Desk",
      externalAccountId: "9001",
      accessTokenEncrypted: "never-return-this-token",
      metadata: { phoneRegisteredAt: "2026-08-25T08:00:00.000Z" },
      property: { id: 19, title: "Harbour Hotel", owner: { id: 4, email: "owner@example.com" } },
    }]);
    mocks.prisma.nrmsMessagingConnection.groupBy.mockResolvedValue([{ status: "CONNECTED", _count: { _all: 1 } }]);
    mocks.prisma.nrmsWorkerHealth.findUnique.mockResolvedValue({ worker: "meta-messaging", status: "HEALTHY", lastSuccessAt: new Date(), lastFailureAt: null, lastError: null });

    const response = await request(app()).get("/api/admin/nrms/messaging/overview").expect(200);

    expect(response.body.connections[0]).toMatchObject({ id: 8, provider: "WHATSAPP", status: "CONNECTED", phoneRegistrationComplete: true });
    expect(response.body.summary.connections.CONNECTED).toBe(1);
    expect(response.body.worker.healthy).toBe(true);
    expect(JSON.stringify(response.body)).not.toContain("never-return-this-token");
    expect(JSON.stringify(response.body)).not.toContain("accessTokenEncrypted");
  });

  it("replays failures for one property and records the reason in the admin audit", async () => {
    mocks.prisma.property.findUnique.mockResolvedValue({ id: 19, ownerId: 4, title: "Harbour Hotel" });

    const response = await request(app()).post("/api/admin/nrms/messaging/failures/replay").send({ propertyId: 19, reason: "Retry after repairing the durable queue" }).expect(200);

    expect(mocks.replay).toHaveBeenCalledWith(19);
    expect(response.body.replayed).toEqual({ webhookJobs: 2, outboundMessages: 3 });
    expect(mocks.prisma.adminAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ adminId: 91, targetUserId: 4, action: "NRMS_META_FAILURES_REPLAY_PROPERTY", details: expect.objectContaining({ propertyId: 19, reason: "Retry after repairing the durable queue" }) }) }));
  });

  it("disconnects a compromised account by revoking its stored identifiers and token", async () => {
    const connection = { id: 8, propertyId: 19, ownerId: 4, provider: "INSTAGRAM", status: "CONNECTED", property: { id: 19, ownerId: 4, title: "Harbour Hotel" } };
    mocks.prisma.nrmsMessagingConnection.findUnique.mockResolvedValue(connection);
    mocks.prisma.nrmsMessagingConnection.update.mockImplementation(async ({ data }: any) => ({ ...connection, ...data }));

    await request(app()).post("/api/admin/nrms/messaging/connections/8/state").send({ action: "DISCONNECT", reason: "Owner reported that the Meta account was compromised" }).expect(200);

    expect(mocks.prisma.nrmsMessagingConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 8 }, data: expect.objectContaining({ status: "DISCONNECTED", accessTokenEncrypted: null, externalAccountId: null, phoneNumberId: null }) }));
    expect(mocks.prisma.adminAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "NRMS_META_CONNECTION_DISCONNECT", details: expect.objectContaining({ beforeStatus: "CONNECTED", afterStatus: "DISCONNECTED" }) }) }));
  });

  it("runs and audits a live connection diagnostic without returning credentials", async () => {
    mocks.prisma.nrmsMessagingConnection.findUnique.mockResolvedValue({ id: 8, propertyId: 19, provider: "WHATSAPP", accessTokenEncrypted: "never-return-this-token", property: { id: 19, ownerId: 4, title: "Harbour Hotel" } });

    const response = await request(app()).post("/api/admin/nrms/messaging/connections/8/diagnose").expect(200);

    expect(mocks.diagnose).toHaveBeenCalledWith(19, "WHATSAPP");
    expect(response.body.diagnostic).toMatchObject({ provider: "WHATSAPP", verdict: "HEALTHY" });
    expect(JSON.stringify(response.body)).not.toContain("never-return-this-token");
    expect(mocks.prisma.adminAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "NRMS_META_CONNECTION_DIAGNOSTIC", details: expect.objectContaining({ connectionId: 8, verdict: "HEALTHY", summary: { PASS: 1 } }) }) }));
  });
});
