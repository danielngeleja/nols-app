import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connection: vi.fn(),
  worker: vi.fn(),
  job: vi.fn(),
  message: vi.fn(),
  decrypt: vi.fn(() => "live-provider-token"),
}));

vi.mock("@nolsaf/prisma", () => ({ typedPrisma: {
  nrmsMessagingConnection: { findFirst: mocks.connection },
  nrmsWorkerHealth: { findUnique: mocks.worker },
  nrmsMetaWebhookJob: { findFirst: mocks.job },
  nrmsGuestMessage: { findFirst: mocks.message },
} }));
vi.mock("./crypto.js", () => ({ decrypt: mocks.decrypt }));
vi.mock("./nrmsMetaOAuth.js", () => ({ instagramOAuthConfig: () => ({ appId: "instagram-app", appSecret: "instagram-secret", redirectUri: "https://api.example.com/meta/oauth/instagram/callback", graphVersion: "v26.0" }) }));

import { runNrmsMetaDiagnostic } from "./nrmsMetaDiagnostics.js";

describe("live NRMS Meta diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("RUN_BACKGROUND_WORKERS", "true");
    vi.stubEnv("META_APP_ID", "whatsapp-app");
    vi.stubEnv("META_APP_SECRET", "whatsapp-secret");
    vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-token");
    vi.stubEnv("META_GRAPH_API_VERSION", "v26.0");
    const now = new Date();
    mocks.worker.mockResolvedValue({ worker: "meta-messaging", status: "HEALTHY", lastSuccessAt: now, lastError: null });
    mocks.job.mockResolvedValue({ status: "COMPLETED", lastError: null, createdAt: now, completedAt: now });
    mocks.message.mockResolvedValue({ createdAt: now });
  });

  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("actively verifies a WhatsApp app, WABA, phone registration and processing path", async () => {
    const now = new Date();
    mocks.connection.mockResolvedValue({
      id: 8, propertyId: 19, provider: "WHATSAPP", status: "CONNECTED", externalBusinessId: "9001", externalAccountId: "9001",
      phoneNumberId: "8001", accessTokenEncrypted: "encrypted-whatsapp-token", lastWebhookAt: now,
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "app-token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ object: "whatsapp_business_account", active: true, callback_url: "https://api.example.com/webhooks/meta", fields: [{ name: "messages" }] }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ whatsapp_business_api_data: { id: "whatsapp-app" } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "8001", display_phone_number: "+255700000000", status: "CONNECTED", code_verification_status: "VERIFIED" }] }), { status: 200 })));

    const result = await runNrmsMetaDiagnostic(19, "WHATSAPP");

    expect(result.verdict).toBe("HEALTHY");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "app_webhook", status: "PASS" }),
      expect.objectContaining({ id: "waba_subscription", status: "PASS" }),
      expect.objectContaining({ id: "phone_registration", status: "PASS" }),
      expect.objectContaining({ id: "worker", status: "PASS" }),
      expect.objectContaining({ id: "webhook_queue", status: "PASS" }),
    ]));
    expect(mocks.decrypt).toHaveBeenCalledWith("encrypted-whatsapp-token", { log: false });
    expect(JSON.stringify(result)).not.toContain("live-provider-token");
    expect(JSON.stringify(result)).not.toContain("encrypted-whatsapp-token");
  });

  it("actively verifies Instagram identity, app subscription, token lifetime and processing path", async () => {
    const now = new Date();
    mocks.connection.mockResolvedValue({
      id: 9, propertyId: 19, provider: "INSTAGRAM", status: "CONNECTED", externalAccountId: "17840001", displayName: "harbourhotel",
      accessTokenEncrypted: "encrypted-instagram-token", tokenExpiresAt: new Date(Date.now() + 30 * 86_400_000), webhookSubscribedAt: now, lastWebhookAt: now,
    });
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "17840001", user_id: "17840001", username: "harbourhotel", account_type: "BUSINESS" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ id: "instagram-app" }] }), { status: 200 })));

    const result = await runNrmsMetaDiagnostic(19, "INSTAGRAM");

    expect(result.verdict).toBe("HEALTHY");
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "account_access", status: "PASS" }),
      expect.objectContaining({ id: "instagram_subscription", status: "PASS" }),
      expect.objectContaining({ id: "token_expiry", status: "PASS" }),
      expect.objectContaining({ id: "inbound_storage", status: "PASS" }),
    ]));
    expect(result.evidence).toMatchObject({ connectedUsername: "harbourhotel", reportedAccountId: "17840001", accountType: "BUSINESS" });
    expect(JSON.stringify(result)).not.toContain("live-provider-token");
    expect(JSON.stringify(result)).not.toContain("encrypted-instagram-token");
  });
});
