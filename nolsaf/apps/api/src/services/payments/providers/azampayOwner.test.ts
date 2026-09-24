import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ post: vi.fn(), token: vi.fn(), invalidate: vi.fn() }));
vi.mock("../../../lib/azampay.auth.js", () => ({ getAzamPayToken: mocks.token, invalidateAzamPayToken: mocks.invalidate }));
vi.mock("../../../lib/azampay.helpers.js", () => ({
  normalizePhone: (value: string) => value.replace(/\s/g, "").replace(/^0/, "+255"),
  azampayMnoPost: mocks.post,
}));

import { AzamPayOwnerCollectionAdapter } from "./azampayOwner.js";

const capabilities = { channels: ["MNO", "BANK"], currencies: ["TZS"], supportsMerchantOnboarding: true, supportsSubmerchant: true, supportsRefund: false, supportsPartialRefund: false, supportsHostedCheckout: false, supportsStatusQuery: false, supportsSettlementReport: false, maxMetadataBytes: 256 };
const input = { intentReference: "PI-TEST-1", idempotencyKey: "idem-1", channel: "MNO" as const, money: { amount: "12804.00", currency: "TZS" }, destination: { providerMerchantId: "merchant-7", providerWalletId: "wallet-9" }, payerReference: "0712345678", metadata: { mnoProvider: "Mpesa" } };

describe("AzamPay owner collection adapter", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.token.mockResolvedValue("token"); mocks.post.mockResolvedValue({ ok: true, status: 200, body: JSON.stringify({ transactionId: "azp-44", success: true }) }); });

  it("refuses to call AzamPay until the owner destination contract is configured", async () => {
    const adapter = new AzamPayOwnerCollectionAdapter({ environment: "SANDBOX", capabilities, env: {} });
    await expect(adapter.createPaymentAttempt(input)).rejects.toThrow("owner_collection_contract_not_confirmed");
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("routes the request to the frozen owner merchant and wallet fields", async () => {
    const env = { AZAMPAY_OWNER_COLLECTION_CONTRACT_CONFIRMED: "true", AZAMPAY_OWNER_MERCHANT_FIELD: "recipientMerchant", AZAMPAY_OWNER_WALLET_FIELD: "recipientWallet" };
    const adapter = new AzamPayOwnerCollectionAdapter({ environment: "SANDBOX", capabilities, env });
    const result = await adapter.createPaymentAttempt(input);
    expect(result).toMatchObject({ status: "PROCESSING", providerRef: "azp-44" });
    expect(mocks.post).toHaveBeenCalledWith("/azampay/mno/checkout", expect.objectContaining({ recipientMerchant: "merchant-7", recipientWallet: "wallet-9", externalId: "PI-TEST-1" }), "token");
  });

  it("accepts only a correctly signed callback and keeps merchant correlation", async () => {
    const secret = "webhook-secret"; const rawBody = JSON.stringify({ eventId: "event-1", transactionId: "azp-44", status: "SUCCESS", amount: 12804, currency: "TZS", recipientMerchant: "merchant-7" });
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const adapter = new AzamPayOwnerCollectionAdapter({ environment: "SANDBOX", capabilities, env: { AZAMPAY_OWNER_WEBHOOK_SECRET: secret, AZAMPAY_OWNER_MERCHANT_FIELD: "recipientMerchant", AZAMPAY_OWNER_WALLET_FIELD: "recipientWallet" } });
    const result = await adapter.verifyAndNormalizeWebhook({ rawBody, headers: { "x-azampay-signature": signature } });
    expect(result).toMatchObject({ ok: true, event: { status: "SUCCEEDED", providerRef: "azp-44", providerMerchantId: "merchant-7", signatureVerified: true } });
  });
});
