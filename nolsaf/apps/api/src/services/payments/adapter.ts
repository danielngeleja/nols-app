/**
 * The provider adapter boundary.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * The orchestration core depends on this interface and never on a provider's
 * helpers. Booking, folio and outlet routes depend on the core, so adding a
 * provider means writing an adapter, declaring its capabilities and passing
 * contract tests, rather than scattering `if (provider === ...)` through
 * business code.
 *
 * Methods beyond the two mandatory ones are optional. An adapter implements
 * only what its capability matrix declares, and the core checks the matrix
 * before reaching for a method, so an unsupported rail is refused before any
 * transport happens rather than throwing from inside a provider client.
 *
 * Nothing in this file performs I/O. It is types only.
 */

import type { ProviderCapabilities } from "./capabilities.js";
import type { AttemptStatus, PaymentChannel } from "./types.js";

// ── Shared value objects ──────────────────────────────────────────────────

export type ProviderEnvironment = "SANDBOX" | "STAGING" | "PRODUCTION";

export type MoneyInput = {
  /** Minor-unit-safe decimal string. Never a JavaScript float. */
  amount: string;
  /** ISO 4217. */
  currency: string;
};

/**
 * The destination, resolved and frozen by routing before the adapter is
 * called. An adapter never resolves its own destination, and a client can
 * never supply one.
 */
export type ResolvedDestination = {
  providerMerchantId: string;
  providerWalletId: string;
};

// ── Attempt creation ──────────────────────────────────────────────────────

export type CreateAttemptInput = {
  /** NoLSAF reference, safe to show the payer. */
  intentReference: string;
  /** Stable across retries of the same logical call. */
  idempotencyKey: string;
  channel: PaymentChannel;
  money: MoneyInput;
  destination: ResolvedDestination;
  /**
   * Payer contact for channels that need one, such as an MNO push. Absent for
   * hosted checkout, where the provider collects it.
   */
  payerReference?: string;
  /**
   * NRMS correlation values the provider may echo back. Bounded by the
   * provider's declared maxMetadataBytes; correlation must never depend on it
   * surviving the round trip.
   */
  metadata?: Record<string, string>;
};

export type CreateAttemptResult = {
  status: AttemptStatus;
  /** Provider transaction reference, absent if the provider has not issued one. */
  providerRef?: string;
  /** The provider's own status string, retained verbatim. */
  providerStatus?: string;
  /** Redirect target for hosted checkout and card flows. */
  checkoutUrl?: string;
  failureCode?: string;
};

// ── Status, refunds, settlement ───────────────────────────────────────────

export type PaymentStatusResult = {
  status: AttemptStatus;
  providerStatus?: string;
  money?: MoneyInput;
  /** True when the provider confirms it has no record of the reference. */
  notFound?: boolean;
};

export type RefundRequestInput = {
  providerRef: string;
  refundReference: string;
  money: MoneyInput;
  reason: string;
  isPartial: boolean;
};

export type RefundResult = {
  status: "REQUESTED" | "PROCESSING" | "COMPLETED" | "FAILED";
  providerRefundRef?: string;
  providerStatus?: string;
  failureCode?: string;
};

export type SettlementWindow = { from: Date; to: Date };

export type SettlementRecord = {
  providerSettlementRef: string;
  providerMerchantId?: string;
  providerWalletId?: string;
  grossAmount: string;
  feeAmount: string;
  taxAmount: string;
  refundAmount: string;
  netAmount: string;
  currency: string;
  settlementDate: Date;
};

// ── Merchant onboarding ───────────────────────────────────────────────────

export type MerchantSubmissionInput = {
  /** The frozen application version being submitted. */
  applicationId: number;
  applicationVersion: number;
  /** Proves the submitted package matches what the reviewer approved. */
  payloadHash: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

export type MerchantSubmissionResult = {
  accepted: boolean;
  providerSubmissionRef?: string;
  providerStatus?: string;
  failureCode?: string;
};

export type MerchantStatusResult = {
  /** Provider-side decision, mapped by the adapter. */
  state:
    | "PROVIDER_REVIEW"
    | "PROVIDER_ACTION_REQUIRED"
    | "PROVIDER_ACCOUNT_CREATED"
    | "ACTIVE"
    | "SUSPENDED"
    | "REJECTED";
  providerMerchantId?: string;
  providerWalletId?: string;
  providerStatus?: string;
  reason?: string;
};

// ── Normalized inbound event ──────────────────────────────────────────────

/**
 * What every provider callback becomes before the core sees it.
 *
 * `signatureVerified` is carried rather than assumed. The core refuses to act
 * on a false value, so an adapter that cannot yet verify a provider's
 * signature scheme fails closed instead of trusting the network.
 */
export type NormalizedProviderEvent = {
  provider: string;
  environment: ProviderEnvironment;

  providerEventId: string;
  eventType: string;
  providerOccurredAt?: Date;
  receivedAt: Date;

  providerMerchantId?: string;
  providerWalletId?: string;
  providerRef?: string;
  /** Set on a refund or reversal, pointing at the payment it unwinds. */
  originalProviderRef?: string;

  status: AttemptStatus;
  providerStatus?: string;

  money?: MoneyInput;
  channel?: PaymentChannel;

  signatureVerified: boolean;
  /** Digest of the raw body, so evidence survives payload retention limits. */
  payloadDigest: string;
};

export type WebhookVerificationResult =
  | { ok: true; event: NormalizedProviderEvent }
  | { ok: false; code: "invalid_signature" | "malformed_payload" | "stale_timestamp"; message: string };

export type RawWebhookRequest = {
  /** The exact bytes received. Signature verification must use these, never a re-serialized object. */
  rawBody: string;
  headers: Record<string, string | undefined>;
  sourceIp?: string;
};

// ── The adapter ───────────────────────────────────────────────────────────

export interface PaymentProviderAdapter {
  readonly provider: string;
  readonly environment: ProviderEnvironment;

  /** Declared, not inferred. The core gates every call on this. */
  getCapabilities(): ProviderCapabilities;

  /**
   * Mandatory. Every provider must be able to start a collection and to
   * authenticate what it sends back; without both there is no safe integration.
   */
  createPaymentAttempt(input: CreateAttemptInput): Promise<CreateAttemptResult>;
  verifyAndNormalizeWebhook(request: RawWebhookRequest): Promise<WebhookVerificationResult>;

  /** Requires supportsStatusQuery. The only safe way out of STATUS_UNKNOWN. */
  getPaymentStatus?(providerRef: string): Promise<PaymentStatusResult>;

  /** Requires supportsRefund. */
  requestRefund?(input: RefundRequestInput): Promise<RefundResult>;
  getRefundStatus?(providerRefundRef: string): Promise<RefundResult>;

  /** Requires supportsSettlementReport. */
  fetchSettlements?(window: SettlementWindow): Promise<SettlementRecord[]>;

  /** Requires supportsMerchantOnboarding. */
  submitMerchantApplication?(input: MerchantSubmissionInput): Promise<MerchantSubmissionResult>;
  getMerchantStatus?(providerMerchantRef: string): Promise<MerchantStatusResult>;
}
