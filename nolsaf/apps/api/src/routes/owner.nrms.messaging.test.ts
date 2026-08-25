import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    nrmsMessagingConnection: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    nrmsWorkerHealth: { findUnique: vi.fn() },
    nrmsMetaWebhookJob: { findFirst: vi.fn() },
    nrmsGuestMessage: { findFirst: vi.fn() },
  },
  access: vi.fn(), encrypt: vi.fn((value: string) => `encrypted:${value}`), decrypt: vi.fn(() => "meta-access-token"),
}));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: mocks.prisma, prisma: mocks.prisma }));
vi.mock("../middleware/auth.js", () => ({ requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 8, role: "MANAGER" }; next(); } }));
vi.mock("../lib/nrmsPropertyAccess.js", () => ({ loadNrmsPropertyAccess: mocks.access }));
vi.mock("../lib/crypto.js", () => ({ encrypt: mocks.encrypt, decrypt: mocks.decrypt }));

import { router } from "./owner.nrms.messaging.js";

describe("property-scoped Meta connection routes", () => {
  beforeEach(() => {
    vi.clearAllMocks(); vi.stubEnv("META_APP_ID", "1066743859095630"); vi.stubEnv("META_APP_SECRET", "secret"); vi.stubEnv("META_WHATSAPP_CONFIG_ID", "config-1"); vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    mocks.access.mockResolvedValue({ actorId: 8, ownerId: 4, role: "MANAGER", property: { id: 19, ownerId: 4, title: "Hotel" } });
    mocks.prisma.nrmsMessagingConnection.findMany.mockResolvedValue([{ provider: "INSTAGRAM", status: "CONNECTED", displayName: "hotel", externalAccountId: "1784", accessTokenEncrypted: "never-return-this", version: 1 }]);
    mocks.prisma.nrmsMessagingConnection.upsert.mockResolvedValue({ provider: "WHATSAPP", status: "CONNECTED", displayName: "Hotel Desk", externalAccountId: "9001", phoneNumberId: "8001", version: 1 });
    mocks.prisma.nrmsMessagingConnection.update.mockImplementation(async ({ data }: any) => ({ id: 12, provider: "WHATSAPP", phoneNumberId: "8001", metadata: data.metadata, ...data }));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("returns connection health without returning stored access tokens", async () => {
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    const response = await request(app).get("/api/owner/nrms/messaging/property/19").expect(200);
    expect(response.body.connections[0]).toMatchObject({ provider: "INSTAGRAM", status: "CONNECTED", displayName: "hotel" });
    expect(JSON.stringify(response.body)).not.toContain("never-return-this");
    expect(mocks.access).toHaveBeenCalledWith(expect.anything(), expect.anything(), 19, ["OWNER", "MANAGER"]);
  });

  it("separates live Meta configuration, WABA subscription and processing health", async () => {
    const now = new Date();
    mocks.prisma.nrmsMessagingConnection.findFirst.mockResolvedValue({
      id: 12, propertyId: 19, provider: "WHATSAPP", status: "CONNECTED", externalBusinessId: "9001", externalAccountId: "9001",
      phoneNumberId: "8001", accessTokenEncrypted: "encrypted-token", lastWebhookAt: now,
    });
    mocks.prisma.nrmsWorkerHealth.findUnique.mockResolvedValue({ worker: "meta-messaging", status: "RUNNING", lastSuccessAt: now, lastError: null });
    mocks.prisma.nrmsMetaWebhookJob.findFirst.mockResolvedValue({ status: "COMPLETED", lastError: null, createdAt: now, completedAt: now });
    mocks.prisma.nrmsGuestMessage.findFirst.mockResolvedValue({ createdAt: now });
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "app-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ object: "whatsapp_business_account", active: true, callback_url: "https://api.example.com/webhooks/meta", fields: [{ name: "messages" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ whatsapp_business_api_data: { id: "1066743859095630", name: "NoLSAF" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "8001", display_phone_number: "+255700000000", verified_name: "Hotel Desk", status: "CONNECTED", code_verification_status: "VERIFIED" }] }), { status: 200 })));

    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    const response = await request(app).post("/api/owner/nrms/messaging/property/19/whatsapp/diagnose").expect(200);

    expect(response.body.diagnostic.verdict).toBe("HEALTHY");
    expect(response.body.diagnostic.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "app_webhook", status: "PASS" }),
      expect.objectContaining({ id: "waba_subscription", status: "PASS" }),
      expect.objectContaining({ id: "phone_registration", status: "PASS", detail: expect.stringContaining("+255700000000") }),
      expect.objectContaining({ id: "worker", status: "PASS" }),
    ]));
    expect(JSON.stringify(response.body)).not.toContain("app-access-token");
    expect(JSON.stringify(response.body)).not.toContain("encrypted-token");
  });

  it("reports a Meta configuration failure when the messages field is not subscribed", async () => {
    const now = new Date();
    mocks.prisma.nrmsMessagingConnection.findFirst.mockResolvedValue({ id: 12, propertyId: 19, provider: "WHATSAPP", status: "CONNECTED", externalBusinessId: "9001", phoneNumberId: "8001", accessTokenEncrypted: "encrypted-token", lastWebhookAt: null });
    mocks.prisma.nrmsWorkerHealth.findUnique.mockResolvedValue({ worker: "meta-messaging", status: "HEALTHY", lastSuccessAt: now, lastError: null });
    mocks.prisma.nrmsMetaWebhookJob.findFirst.mockResolvedValue(null);
    mocks.prisma.nrmsGuestMessage.findFirst.mockResolvedValue(null);
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token"); vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "app-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ object: "whatsapp_business_account", active: true, callback_url: "https://api.example.com/webhooks/meta", fields: [{ name: "account_update" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ whatsapp_business_api_data: { id: "1066743859095630" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "8001", status: "CONNECTED", code_verification_status: "VERIFIED" }] }), { status: 200 })));

    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    const response = await request(app).post("/api/owner/nrms/messaging/property/19/whatsapp/diagnose").expect(200);

    expect(response.body.diagnostic.verdict).toBe("CONFIGURATION_BROKEN");
    expect(response.body.diagnostic.checks).toContainEqual(expect.objectContaining({ id: "app_webhook", status: "FAIL", detail: expect.stringContaining("messages field") }));
  });

  it("verifies the selected WABA phone before encrypting and saving it for the property", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "meta-access-token", expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "8001", verified_name: "Hotel Desk" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    await request(app).post("/api/owner/nrms/messaging/property/19/whatsapp/connect").send({ code: "temporary-code", wabaId: "9001", phoneNumberId: "8001", pin: "481526" }).expect(201);

    expect(fetchMock.mock.calls[2]).toEqual(expect.arrayContaining([
      "https://graph.facebook.com/v26.0/8001/register",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ messaging_product: "whatsapp", pin: "481526" }) }),
    ]));
    expect(mocks.encrypt).toHaveBeenCalledWith("meta-access-token");
    expect(mocks.prisma.nrmsMessagingConnection.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { propertyId_provider: { propertyId: 19, provider: "WHATSAPP" } },
      create: expect.objectContaining({ propertyId: 19, ownerId: 4, externalBusinessId: "9001", phoneNumberId: "8001", accessTokenEncrypted: "encrypted:meta-access-token", metadata: { phoneRegisteredAt: expect.any(String) } }),
    }));
  });

  it("does not save a connected account when Meta rejects phone registration", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "meta-access-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "8001", verified_name: "Hotel Desk" }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Registration failed" } }), { status: 400 })));
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    await request(app).post("/api/owner/nrms/messaging/property/19/whatsapp/connect").send({ code: "temporary-code", wabaId: "9001", phoneNumberId: "8001", pin: "481526" }).expect(502);
    expect(mocks.prisma.nrmsMessagingConnection.upsert).not.toHaveBeenCalled();
  });

  it("finishes registration for a previously linked WhatsApp phone", async () => {
    mocks.prisma.nrmsMessagingConnection.findFirst.mockResolvedValue({ id: 12, propertyId: 19, provider: "WHATSAPP", status: "CONNECTED", phoneNumberId: "8001", accessTokenEncrypted: "encrypted-token", metadata: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 })));
    const app = express(); app.use(express.json()); app.use("/api/owner/nrms/messaging", router);
    const response = await request(app).post("/api/owner/nrms/messaging/property/19/whatsapp/register").send({ pin: "481526" }).expect(200);
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-token", { log: false });
    expect(mocks.prisma.nrmsMessagingConnection.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 12 }, data: expect.objectContaining({ status: "CONNECTED", metadata: { phoneRegisteredAt: expect.any(String) } }) }));
    expect(response.body.connection.phoneRegistrationComplete).toBe(true);
  });
});
