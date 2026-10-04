import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { getAzamPayToken, invalidateAzamPayToken } from "../../../lib/azampay.auth.js";
import { azampayMnoPost, normalizePhone } from "../../../lib/azampay.helpers.js";
import type {
  CreateAttemptInput,
  CreateAttemptResult,
  PaymentProviderAdapter,
  ProviderEnvironment,
  RawWebhookRequest,
  WebhookVerificationResult,
} from "../adapter.js";
import { parseCapabilities, type ProviderCapabilities } from "../capabilities.js";
import { isAttemptStatus, type AttemptStatus } from "../types.js";

export const AZAMPAY_OWNER_PROVIDER = "AZAMPAY";

type AdapterOptions = {
  environment: ProviderEnvironment;
  capabilities: unknown;
  env?: NodeJS.ProcessEnv;
};

/**
 * Owner-merchant collections are intentionally separate from NoLSAF's legacy
 * AzamPay checkout. The two configurable destination field names must come
 * from AzamPay's written integration contract; without them no request leaves
 * NRMS. This prevents an owner payment silently landing in NoLSAF's wallet.
 */
export class AzamPayOwnerCollectionAdapter implements PaymentProviderAdapter {
  readonly provider = AZAMPAY_OWNER_PROVIDER;
  readonly environment: ProviderEnvironment;

  private readonly capabilities: ProviderCapabilities;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: AdapterOptions) {
    this.environment = options.environment;
    this.capabilities = parseCapabilities(options.capabilities);
    this.env = options.env ?? process.env;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  private destination(input: CreateAttemptInput): Record<string, string> {
    if (this.env.AZAMPAY_OWNER_COLLECTION_CONTRACT_CONFIRMED !== "true") {
      throw new Error("owner_collection_contract_not_confirmed");
    }
    const merchantField = String(this.env.AZAMPAY_OWNER_MERCHANT_FIELD || "").trim();
    const walletField = String(this.env.AZAMPAY_OWNER_WALLET_FIELD || "").trim();
    if (!merchantField || !walletField || merchantField === walletField) {
      throw new Error("owner_collection_destination_fields_missing");
    }
    return {
      [merchantField]: input.destination.providerMerchantId,
      [walletField]: input.destination.providerWalletId,
    };
  }

  async createPaymentAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult> {
    const destination = this.destination(input);
    let path: string;
    let body: Record<string, unknown>;

    if (input.channel === "MNO") {
      const phone = normalizePhone(String(input.payerReference || ""));
      const provider = String(input.metadata?.mnoProvider || "").trim();
      if (!phone || !provider) return { status: "FAILED", failureCode: "invalid_mno_details" };
      path = "/azampay/mno/checkout";
      body = {
        accountNumber: phone.replace(/^\+/, ""),
        amount: Math.round(Number(input.money.amount)),
        currency: input.money.currency,
        externalId: input.intentReference,
        provider,
        ...destination,
        additionalProperties: { nrmsIntentReference: input.intentReference },
      };
    } else if (input.channel === "BANK") {
      const accountNumber = String(input.metadata?.bankAccountNumber || "").trim();
      const mobile = normalizePhone(String(input.payerReference || ""));
      const bankCode = String(input.metadata?.bankCode || "").trim().toUpperCase();
      const otp = String(input.metadata?.otp || "").trim();
      if (!accountNumber || !mobile || !bankCode || !otp) {
        return { status: "FAILED", failureCode: "invalid_bank_details" };
      }
      path = "/azampay/bank/checkout";
      body = {
        amount: Math.round(Number(input.money.amount)),
        currencyCode: input.money.currency,
        merchantAccountNumber: accountNumber,
        merchantMobileNumber: mobile.replace(/^\+/, ""),
        merchantName: String(input.metadata?.merchantName || "Property"),
        otp,
        provider: bankCode,
        referenceId: input.intentReference,
        ...destination,
        additionalProperties: { nrmsIntentReference: input.intentReference },
      };
    } else {
      return { status: "FAILED", failureCode: "channel_not_supported" };
    }

    let token = await getAzamPayToken();
    let response = await azampayMnoPost(path, body, token);
    if (response.status === 401) {
      await invalidateAzamPayToken();
      token = await getAzamPayToken();
      response = await azampayMnoPost(path, body, token);
    }
    if (!response.ok) return { status: "FAILED", providerStatus: `HTTP_${response.status}`, failureCode: "provider_rejected" };

    let parsed: Record<string, unknown> = {};
    try { parsed = response.body.trim() ? JSON.parse(response.body) : {}; } catch { /* accepted empty/non-JSON acknowledgement */ }
    if (parsed.success === false) return { status: "FAILED", providerStatus: String(parsed.messageCode || "REJECTED"), failureCode: "provider_rejected" };
    const providerRef = String(parsed.transactionId || parsed.referenceId || parsed.id || input.intentReference).trim();
    // Acceptance is not settlement. Only the authenticated webhook may mark
    // the intent and reservation paid.
    return { status: "PROCESSING", providerRef, providerStatus: String(parsed.status || "ACCEPTED") };
  }

  async verifyAndNormalizeWebhook(request: RawWebhookRequest): Promise<WebhookVerificationResult> {
    const secret = String(this.env.AZAMPAY_OWNER_WEBHOOK_SECRET || "");
    const headerName = String(this.env.AZAMPAY_OWNER_WEBHOOK_SIGNATURE_HEADER || "x-azampay-signature").toLowerCase();
    const supplied = String(request.headers[headerName] || "").replace(/^sha256=/i, "");
    if (!secret || !/^[a-f0-9]{64}$/i.test(supplied)) {
      return { ok: false, code: "invalid_signature", message: "Webhook signature is missing or invalid." };
    }
    const expected = createHmac("sha256", secret).update(request.rawBody, "utf8").digest("hex");
    if (!timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"))) {
      return { ok: false, code: "invalid_signature", message: "Webhook signature is invalid." };
    }

    let body: Record<string, unknown>;
    try { body = JSON.parse(request.rawBody); } catch {
      return { ok: false, code: "malformed_payload", message: "Webhook body is not valid JSON." };
    }
    const providerRef = String(body.transactionId || body.referenceId || body.externalId || "").trim();
    const nativeStatus = String(body.status || body.transactionStatus || "STATUS_UNKNOWN").toUpperCase();
    const statusMap: Record<string, AttemptStatus> = {
      SUCCESS: "SUCCEEDED", SUCCEEDED: "SUCCEEDED", COMPLETED: "SUCCEEDED", PAID: "SUCCEEDED",
      FAILED: "FAILED", CANCELLED: "CANCELLED", CANCELED: "CANCELLED", EXPIRED: "EXPIRED",
      PENDING: "PROCESSING", PROCESSING: "PROCESSING",
    };
    const status = statusMap[nativeStatus] ?? (isAttemptStatus(nativeStatus) ? nativeStatus : "STATUS_UNKNOWN");
    const eventId = String(body.eventId || body.id || `${providerRef}:${nativeStatus}`).trim();
    if (!providerRef || !eventId) return { ok: false, code: "malformed_payload", message: "Webhook reference is missing." };

    const merchantField = String(this.env.AZAMPAY_OWNER_MERCHANT_FIELD || "merchantId");
    const walletField = String(this.env.AZAMPAY_OWNER_WALLET_FIELD || "walletId");
    const amount = body.amount == null ? undefined : String(body.amount);
    const currency = String(body.currency || body.currencyCode || "").toUpperCase();
    return {
      ok: true,
      event: {
        provider: this.provider,
        environment: this.environment,
        providerEventId: eventId,
        eventType: String(body.eventType || "PAYMENT_STATUS"),
        receivedAt: new Date(),
        providerMerchantId: body[merchantField] ? String(body[merchantField]) : undefined,
        providerWalletId: body[walletField] ? String(body[walletField]) : undefined,
        providerRef,
        status,
        providerStatus: nativeStatus,
        money: amount && currency ? { amount, currency } : undefined,
        signatureVerified: true,
        payloadDigest: createHash("sha256").update(request.rawBody, "utf8").digest("hex"),
      },
    };
  }
}
