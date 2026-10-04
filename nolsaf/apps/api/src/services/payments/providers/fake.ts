/**
 * Deterministic in-repo payment provider simulator.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md, Phase 3.
 *
 * Its purpose is to let the orchestration core prove state transitions,
 * retries, duplicate callbacks, out-of-order events, refunds and reconciliation
 * BEFORE any real sandbox call exists. A real sandbox cannot do this job: the
 * AzamPay disbursement test host was measured returning non-deterministic and
 * fabricated responses (see
 * apps/api/.local-reports/azampay-disbursement/), so it can validate request
 * plumbing but never a state machine.
 *
 * Outcomes are chosen from the intent reference, so a test states the scenario
 * it wants in the reference and gets the same answer every run, on every
 * machine, forever.
 *
 * This adapter must never exist in a production environment, and refuses to be
 * constructed in one.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  CreateAttemptInput,
  CreateAttemptResult,
  MerchantStatusResult,
  MerchantSubmissionInput,
  MerchantSubmissionResult,
  PaymentProviderAdapter,
  PaymentStatusResult,
  ProviderEnvironment,
  RawWebhookRequest,
  RefundRequestInput,
  RefundResult,
  SettlementRecord,
  SettlementWindow,
  WebhookVerificationResult,
} from "../adapter.js";
import { parseCapabilities, type ProviderCapabilities } from "../capabilities.js";
import { isAttemptStatus, type AttemptStatus } from "../types.js";

export const FAKE_PROVIDER_NAME = "FAKE";

/**
 * Scenario directives. A reference containing one of these keys resolves to
 * the mapped status; anything else falls through to the stable hash below, so
 * even an undirected reference behaves the same way on every run.
 */
const SCENARIO_DIRECTIVES: ReadonlyArray<readonly [string, AttemptStatus]> = [
  ["-OK", "SUCCEEDED"],
  ["-FAIL", "FAILED"],
  ["-ACTION", "REQUIRES_CUSTOMER_ACTION"],
  ["-PENDING", "PROCESSING"],
  ["-UNKNOWN", "STATUS_UNKNOWN"],
  ["-EXPIRE", "EXPIRED"],
  ["-CANCEL", "CANCELLED"],
];

/** Statuses an undirected reference can land on, in stable order. */
const HASHED_OUTCOMES: readonly AttemptStatus[] = ["SUCCEEDED", "PROCESSING", "FAILED"];

/** FNV-1a. Chosen because it is short, dependency-free and stable across runs. */
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function fakeOutcomeFor(reference: string): AttemptStatus {
  const upper = String(reference || "").toUpperCase();
  for (const [directive, status] of SCENARIO_DIRECTIVES) {
    if (upper.includes(directive)) return status;
  }
  return HASHED_OUTCOMES[stableHash(upper) % HASHED_OUTCOMES.length]!;
}

const FULL_CAPABILITIES: ProviderCapabilities = parseCapabilities({
  channels: ["MNO", "BANK", "CARD", "HOSTED_CHECKOUT"],
  currencies: ["TZS", "USD"],
  supportsMerchantOnboarding: true,
  supportsSubmerchant: true,
  supportsRefund: true,
  supportsPartialRefund: true,
  supportsHostedCheckout: true,
  supportsStatusQuery: true,
  supportsSettlementReport: true,
  maxMetadataBytes: 512,
});

export type FakeProviderOptions = {
  environment?: ProviderEnvironment;
  /** Shared secret for webhook signatures. Test-only by construction. */
  webhookSecret?: string;
  /** Narrow the declared matrix to exercise unsupported-capability paths. */
  capabilities?: Partial<Record<keyof ProviderCapabilities, unknown>>;
};

type RecordedAttempt = {
  providerRef: string;
  status: AttemptStatus;
  money: { amount: string; currency: string };
};

export class FakePaymentProvider implements PaymentProviderAdapter {
  readonly provider = FAKE_PROVIDER_NAME;
  readonly environment: ProviderEnvironment;

  private readonly webhookSecret: string;
  private readonly capabilities: ProviderCapabilities;

  /** Keyed by idempotency key, so a retried call returns the first answer. */
  private readonly attemptsByKey = new Map<string, RecordedAttempt>();
  private readonly attemptsByRef = new Map<string, RecordedAttempt>();
  private readonly refunds = new Map<string, RefundResult>();

  constructor(options: FakeProviderOptions = {}) {
    const environment = options.environment ?? "SANDBOX";

    // Two independent guards. The environment argument can be wrong by
    // accident; NODE_ENV cannot be wrong in a way that also makes running a
    // simulator against real money acceptable.
    if (environment === "PRODUCTION" || process.env.NODE_ENV === "production") {
      throw new Error("FakePaymentProvider must never be constructed in a production environment");
    }

    this.environment = environment;
    this.webhookSecret = options.webhookSecret ?? "fake-provider-test-secret";
    this.capabilities = options.capabilities
      ? parseCapabilities({ ...FULL_CAPABILITIES, ...options.capabilities })
      : FULL_CAPABILITIES;
  }

  getCapabilities(): ProviderCapabilities {
    return this.capabilities;
  }

  /** Signs a body the way this provider would, for tests that build callbacks. */
  signPayload(rawBody: string): string {
    return createHmac("sha256", this.webhookSecret).update(rawBody, "utf8").digest("hex");
  }

  async createPaymentAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult> {
    const existing = this.attemptsByKey.get(input.idempotencyKey);
    if (existing) {
      // A retry of the same logical call must never collect a second time.
      return {
        status: existing.status,
        providerRef: existing.providerRef,
        providerStatus: `fake:${existing.status.toLowerCase()}:replayed`,
      };
    }

    const status = fakeOutcomeFor(input.intentReference);
    const providerRef = `FAKE-${stableHash(input.idempotencyKey).toString(16).padStart(8, "0")}`;

    const record: RecordedAttempt = { providerRef, status, money: input.money };
    this.attemptsByKey.set(input.idempotencyKey, record);
    this.attemptsByRef.set(providerRef, record);

    return {
      status,
      providerRef,
      providerStatus: `fake:${status.toLowerCase()}`,
      checkoutUrl:
        input.channel === "HOSTED_CHECKOUT" || input.channel === "CARD"
          ? `https://fake-provider.invalid/checkout/${providerRef}`
          : undefined,
      failureCode: status === "FAILED" ? "fake_declined" : undefined,
    };
  }

  async getPaymentStatus(providerRef: string): Promise<PaymentStatusResult> {
    const record = this.attemptsByRef.get(providerRef);
    if (!record) return { status: "STATUS_UNKNOWN", notFound: true };

    // Reconciliation resolving an uncertain attempt is the whole point of this
    // method, so an attempt recorded as unknown settles here rather than
    // staying unknown forever.
    const resolved: AttemptStatus =
      record.status === "STATUS_UNKNOWN" ? "SUCCEEDED" : record.status;

    return {
      status: resolved,
      providerStatus: `fake:${resolved.toLowerCase()}`,
      money: record.money,
    };
  }

  async requestRefund(input: RefundRequestInput): Promise<RefundResult> {
    const existing = this.refunds.get(input.refundReference);
    if (existing) return existing;

    const original = this.attemptsByRef.get(input.providerRef);
    const result: RefundResult =
      original && original.status === "SUCCEEDED"
        ? {
            status: "COMPLETED",
            providerRefundRef: `FAKE-RF-${stableHash(input.refundReference).toString(16)}`,
            providerStatus: "fake:refunded",
          }
        : { status: "FAILED", providerStatus: "fake:not_refundable", failureCode: "fake_not_settled" };

    this.refunds.set(input.refundReference, result);
    return result;
  }

  async getRefundStatus(providerRefundRef: string): Promise<RefundResult> {
    for (const refund of this.refunds.values()) {
      if (refund.providerRefundRef === providerRefundRef) return refund;
    }
    return { status: "FAILED", providerStatus: "fake:unknown_refund", failureCode: "fake_not_found" };
  }

  async fetchSettlements(window: SettlementWindow): Promise<SettlementRecord[]> {
    const settled = [...this.attemptsByRef.values()].filter((a) => a.status === "SUCCEEDED");
    if (settled.length === 0) return [];

    const currency = settled[0]!.money.currency;
    const gross = settled.reduce((sum, a) => sum + Number(a.money.amount), 0);
    // A flat 2% notional fee, purely so fee/net separation is exercised.
    const fee = Math.round(gross * 0.02 * 100) / 100;

    return [
      {
        providerSettlementRef: `FAKE-STL-${window.to.toISOString().slice(0, 10)}`,
        grossAmount: gross.toFixed(2),
        feeAmount: fee.toFixed(2),
        taxAmount: "0.00",
        refundAmount: "0.00",
        netAmount: (gross - fee).toFixed(2),
        currency,
        settlementDate: window.to,
      },
    ];
  }

  async submitMerchantApplication(
    input: MerchantSubmissionInput
  ): Promise<MerchantSubmissionResult> {
    return {
      accepted: true,
      providerSubmissionRef: `FAKE-APP-${input.applicationId}-${input.applicationVersion}`,
      providerStatus: "fake:received",
    };
  }

  async getMerchantStatus(providerMerchantRef: string): Promise<MerchantStatusResult> {
    const upper = providerMerchantRef.toUpperCase();
    if (upper.includes("-REJECT")) {
      return { state: "REJECTED", providerStatus: "fake:rejected", reason: "Simulated rejection" };
    }
    if (upper.includes("-REVIEW")) {
      return { state: "PROVIDER_REVIEW", providerStatus: "fake:reviewing" };
    }
    return {
      state: "ACTIVE",
      providerMerchantId: `FAKE-M-${stableHash(providerMerchantRef).toString(16)}`,
      providerWalletId: `FAKE-W-${stableHash(`${providerMerchantRef}:wallet`).toString(16)}`,
      providerStatus: "fake:active",
    };
  }

  async verifyAndNormalizeWebhook(
    request: RawWebhookRequest
  ): Promise<WebhookVerificationResult> {
    const provided = request.headers["x-fake-signature"];
    if (typeof provided !== "string" || provided.length === 0) {
      return { ok: false, code: "invalid_signature", message: "Missing signature header" };
    }

    // Verify over the exact received bytes. Re-serializing the parsed object
    // first is the classic way to make a signature check pass for a payload
    // that is not the one that was signed.
    const expected = this.signPayload(request.rawBody);
    const providedBuffer = Buffer.from(provided, "utf8");
    const expectedBuffer = Buffer.from(expected, "utf8");
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return { ok: false, code: "invalid_signature", message: "Signature mismatch" };
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(request.rawBody) as Record<string, unknown>;
    } catch {
      return { ok: false, code: "malformed_payload", message: "Body is not valid JSON" };
    }

    const providerEventId = typeof payload.eventId === "string" ? payload.eventId : "";
    if (!providerEventId) {
      return { ok: false, code: "malformed_payload", message: "Missing eventId" };
    }

    const rawStatus = typeof payload.status === "string" ? payload.status : "";
    if (!isAttemptStatus(rawStatus)) {
      return { ok: false, code: "malformed_payload", message: "Unrecognised status" };
    }

    const occurredAtRaw = typeof payload.occurredAt === "string" ? payload.occurredAt : null;
    const occurredAt = occurredAtRaw ? new Date(occurredAtRaw) : null;

    return {
      ok: true,
      event: {
        provider: this.provider,
        environment: this.environment,
        providerEventId,
        eventType: typeof payload.eventType === "string" ? payload.eventType : "PAYMENT",
        providerOccurredAt:
          occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
        receivedAt: new Date(),
        providerMerchantId:
          typeof payload.merchantId === "string" ? payload.merchantId : undefined,
        providerWalletId: typeof payload.walletId === "string" ? payload.walletId : undefined,
        providerRef: typeof payload.providerRef === "string" ? payload.providerRef : undefined,
        originalProviderRef:
          typeof payload.originalProviderRef === "string" ? payload.originalProviderRef : undefined,
        status: rawStatus,
        providerStatus: `fake:${rawStatus.toLowerCase()}`,
        money:
          typeof payload.amount === "string" && typeof payload.currency === "string"
            ? { amount: payload.amount, currency: payload.currency }
            : undefined,
        signatureVerified: true,
        payloadDigest: createHmac("sha256", "digest").update(request.rawBody, "utf8").digest("hex"),
      },
    };
  }
}
