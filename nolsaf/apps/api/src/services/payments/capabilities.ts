/**
 * Provider capability matrix.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Provider neutrality does not mean pretending every provider behaves the
 * same. The orchestration core normalizes the stable concepts and keeps the
 * differences here: a provider may support MNO push but not cards, hosted
 * checkout but not direct collection, refunds but not partial refunds, or
 * platform merchants but not submerchants.
 *
 * Everything in this module fails closed. An absent, malformed or unparseable
 * capability declaration yields NO capabilities rather than a permissive
 * default, because the failure mode of guessing "probably supported" is an
 * attempt against a rail the provider cannot honour, with the customer's money
 * already in flight.
 */

import { z } from "zod";

import { PAYMENT_CHANNELS, type PaymentChannel } from "./types.js";

const capabilitiesSchema = z
  .object({
    /** Channels this provider/environment can actually collect over. */
    channels: z.array(z.enum(PAYMENT_CHANNELS)).default([]),
    /** ISO 4217 codes. Uppercased on parse so "tzs" and "TZS" agree. */
    currencies: z
      .array(z.string().regex(/^[A-Za-z]{3}$/))
      .default([])
      .transform((list) => list.map((code) => code.toUpperCase())),

    supportsMerchantOnboarding: z.boolean().default(false),
    supportsSubmerchant: z.boolean().default(false),
    supportsRefund: z.boolean().default(false),
    /**
     * Distinct from supportsRefund on purpose. A provider that can only refund
     * the full captured amount cannot settle a single voided line on a split
     * restaurant bill, and discovering that at refund time is too late.
     */
    supportsPartialRefund: z.boolean().default(false),
    supportsHostedCheckout: z.boolean().default(false),
    /** A status API that can answer "did this actually move?" after a timeout. */
    supportsStatusQuery: z.boolean().default(false),
    /** A settlement or transaction report for independent reconciliation. */
    supportsSettlementReport: z.boolean().default(false),

    /**
     * How much NRMS reference metadata the provider returns unchanged. Zero
     * means correlation cannot rely on metadata at all and must fall back to
     * the provider transaction reference.
     */
    maxMetadataBytes: z.number().int().nonnegative().default(0),
  })
  .strict();

export type ProviderCapabilities = z.infer<typeof capabilitiesSchema>;

/** The fail-closed value: a provider that can do nothing until declared. */
export const NO_CAPABILITIES: ProviderCapabilities = capabilitiesSchema.parse({});

/**
 * Parses a ProviderConnection.capabilities JSON column.
 *
 * Never throws. An unknown key is rejected by `.strict()` rather than ignored,
 * so a typo in a capability name surfaces as "no capabilities" during
 * qualification instead of silently disabling one rail in production.
 */
export function parseCapabilities(raw: unknown): ProviderCapabilities {
  const parsed = capabilitiesSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : NO_CAPABILITIES;
}

/** True when the declaration was well-formed. Use for admin diagnostics. */
export function capabilitiesAreValid(raw: unknown): boolean {
  return capabilitiesSchema.safeParse(raw ?? {}).success;
}

export type CapabilityRefusal = {
  ok: false;
  code:
    | "channel_not_supported"
    | "currency_not_supported"
    | "refund_not_supported"
    | "partial_refund_not_supported"
    | "status_query_not_supported"
    | "settlement_report_not_supported"
    | "merchant_onboarding_not_supported";
  message: string;
};

export type CapabilityCheck = { ok: true } | CapabilityRefusal;

export function supportsChannel(
  capabilities: ProviderCapabilities,
  channel: PaymentChannel
): boolean {
  return capabilities.channels.includes(channel);
}

export function supportsCurrency(
  capabilities: ProviderCapabilities,
  currency: string
): boolean {
  return capabilities.currencies.includes(String(currency || "").toUpperCase());
}

/**
 * The gate every initiation passes before an adapter is called.
 *
 * Returns a refusal rather than throwing, so a route can turn it into an
 * actionable message ("card payment is not available for this property")
 * without leaking which provider is behind the decision.
 */
export function checkCollectionCapability(
  capabilities: ProviderCapabilities,
  input: { channel: PaymentChannel; currency: string }
): CapabilityCheck {
  if (!supportsChannel(capabilities, input.channel)) {
    return {
      ok: false,
      code: "channel_not_supported",
      message: `This payment method is not available here.`,
    };
  }
  if (!supportsCurrency(capabilities, input.currency)) {
    return {
      ok: false,
      code: "currency_not_supported",
      message: `Payments in ${String(input.currency || "").toUpperCase()} are not available here.`,
    };
  }
  return { ok: true };
}

/**
 * Refund gate. A partial request against a full-refund-only provider is
 * refused here rather than being silently rounded up to a full refund, which
 * would return money nobody authorised returning.
 */
export function checkRefundCapability(
  capabilities: ProviderCapabilities,
  input: { isPartial: boolean }
): CapabilityCheck {
  if (!capabilities.supportsRefund) {
    return {
      ok: false,
      code: "refund_not_supported",
      message: "This payment provider cannot refund automatically.",
    };
  }
  if (input.isPartial && !capabilities.supportsPartialRefund) {
    return {
      ok: false,
      code: "partial_refund_not_supported",
      message: "This payment provider can only refund the full amount.",
    };
  }
  return { ok: true };
}

/**
 * Whether an uncertain attempt can be resolved without human intervention.
 *
 * A provider with no status query and no settlement report cannot answer
 * "did this move?", which means STATUS_UNKNOWN on that provider is an
 * operator queue item, not something a worker can clear. Worth knowing before
 * the rail is enabled rather than during the first timeout.
 */
export function canReconcileAutomatically(capabilities: ProviderCapabilities): boolean {
  return capabilities.supportsStatusQuery || capabilities.supportsSettlementReport;
}
