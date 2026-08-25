import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: { nrmsMessagingConnection: { findMany: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() } },
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
