/**
 * Server-side payment routing.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * The client may choose an offered channel. It can never choose, submit or
 * influence the destination merchant or wallet: this module does, on the
 * server, before any external call, and the decision it returns is snapshotted
 * onto the payment intent so a later rule change cannot restate a historical
 * payment.
 *
 * It is a pure function over rows the caller has already loaded. No database
 * access and no I/O, so the whole decision table is testable without a
 * provider, a network or a fixture database.
 *
 * It fails closed. There is deliberately no fallback to a NoLSAF-owned
 * connection when nothing matches: routing owner money to the platform's own
 * merchant account is the one outcome this design exists to prevent.
 */

import {
  checkCollectionCapability,
  parseCapabilities,
  type ProviderCapabilities,
} from "./capabilities.js";
import type { ProviderEnvironment } from "./adapter.js";
import type { PaymentChannel, PaymentPurpose } from "./types.js";

export const ROUTING_SCOPES = ["GLOBAL", "MERCHANT", "PROPERTY", "OUTLET"] as const;
export type RoutingScope = (typeof ROUTING_SCOPES)[number];

/**
 * Narrower beats broader at equal priority. An outlet rule is a deliberate
 * statement about one bar; a global rule is a default. The specific one should
 * not lose to the general one because someone typed a lower number.
 */
const SCOPE_SPECIFICITY: Record<RoutingScope, number> = {
  OUTLET: 3,
  PROPERTY: 2,
  MERCHANT: 1,
  GLOBAL: 0,
};

export type RoutingCandidate = {
  ruleId: number;
  scopeType: RoutingScope;
  scopeId: number | null;
  /** NULL matches any value. */
  purpose: PaymentPurpose | null;
  currency: string | null;
  channel: PaymentChannel | null;
  priority: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  connection: {
    id: number;
    provider: string;
    environment: ProviderEnvironment;
    isEnabled: boolean;
    /** Raw ProviderConnection.capabilities JSON. Parsed fail-closed here. */
    capabilities: unknown;
  };
};

export type RoutingContext = {
  merchantId: number;
  propertyId: number | null;
  outletId: number | null;
  purpose: PaymentPurpose;
  currency: string;
  channel: PaymentChannel;
  /** Defaults to now. Injectable so effective-dating is testable. */
  at?: Date;
};

/**
 * Frozen onto PaymentIntent.routingSnapshot before the external call, so the
 * question "why did this payment go there?" is answerable years later from the
 * payment row alone.
 */
export type RoutingSnapshot = {
  ruleId: number;
  scopeType: RoutingScope;
  scopeId: number | null;
  connectionId: number;
  provider: string;
  environment: ProviderEnvironment;
  channel: PaymentChannel;
  currency: string;
  purpose: PaymentPurpose;
  decidedAt: string;
};

export type RoutingRefusalCode =
  | "no_matching_rule"
  | "provider_disabled"
  | "channel_not_supported"
  | "currency_not_supported";

export type RoutingDecision =
  | {
      ok: true;
      connectionId: number;
      provider: string;
      environment: ProviderEnvironment;
      capabilities: ProviderCapabilities;
      snapshot: RoutingSnapshot;
    }
  | { ok: false; code: RoutingRefusalCode; message: string };

function scopeMatches(candidate: RoutingCandidate, context: RoutingContext): boolean {
  switch (candidate.scopeType) {
    case "GLOBAL":
      return true;
    case "MERCHANT":
      return candidate.scopeId === context.merchantId;
    case "PROPERTY":
      return context.propertyId !== null && candidate.scopeId === context.propertyId;
    case "OUTLET":
      return context.outletId !== null && candidate.scopeId === context.outletId;
    default:
      return false;
  }
}

function attributesMatch(candidate: RoutingCandidate, context: RoutingContext): boolean {
  if (candidate.purpose !== null && candidate.purpose !== context.purpose) return false;
  if (candidate.channel !== null && candidate.channel !== context.channel) return false;
  if (
    candidate.currency !== null &&
    candidate.currency.toUpperCase() !== String(context.currency || "").toUpperCase()
  ) {
    return false;
  }
  return true;
}

function isInEffect(candidate: RoutingCandidate, at: Date): boolean {
  if (!candidate.isActive) return false;
  if (candidate.effectiveFrom.getTime() > at.getTime()) return false;
  if (candidate.effectiveTo !== null && candidate.effectiveTo.getTime() <= at.getTime()) return false;
  return true;
}

/**
 * Most specific scope first, then lowest priority number, then lowest rule id.
 *
 * The rule-id tiebreak exists so two equally ranked rules always resolve the
 * same way. Non-deterministic routing would mean the same booking could reach
 * different merchants on different days, which is unauditable.
 */
function compareCandidates(a: RoutingCandidate, b: RoutingCandidate): number {
  const specificity = SCOPE_SPECIFICITY[b.scopeType] - SCOPE_SPECIFICITY[a.scopeType];
  if (specificity !== 0) return specificity;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return a.ruleId - b.ruleId;
}

/**
 * Resolves the provider connection a payment must use.
 *
 * Walks the ranked candidates and returns the first that is enabled and
 * capable. When every candidate is rejected, the refusal describes the
 * best-ranked candidate's reason, because that is the one an operator should
 * fix first.
 */
export function resolveRoute(
  candidates: readonly RoutingCandidate[],
  context: RoutingContext
): RoutingDecision {
  const at = context.at ?? new Date();

  const matching = candidates
    .filter((candidate) => isInEffect(candidate, at))
    .filter((candidate) => scopeMatches(candidate, context))
    .filter((candidate) => attributesMatch(candidate, context))
    .sort(compareCandidates);

  if (matching.length === 0) {
    return {
      ok: false,
      code: "no_matching_rule",
      message: "Online payment is not configured for this property.",
    };
  }

  let firstRefusal: { code: RoutingRefusalCode; message: string } | null = null;

  for (const candidate of matching) {
    if (!candidate.connection.isEnabled) {
      firstRefusal ??= {
        code: "provider_disabled",
        message: "Online payment is temporarily unavailable.",
      };
      continue;
    }

    const capabilities = parseCapabilities(candidate.connection.capabilities);
    const capable = checkCollectionCapability(capabilities, {
      channel: context.channel,
      currency: context.currency,
    });

    if (!capable.ok) {
      firstRefusal ??= { code: capable.code as RoutingRefusalCode, message: capable.message };
      continue;
    }

    return {
      ok: true,
      connectionId: candidate.connection.id,
      provider: candidate.connection.provider,
      environment: candidate.connection.environment,
      capabilities,
      snapshot: {
        ruleId: candidate.ruleId,
        scopeType: candidate.scopeType,
        scopeId: candidate.scopeId,
        connectionId: candidate.connection.id,
        provider: candidate.connection.provider,
        environment: candidate.connection.environment,
        channel: context.channel,
        currency: String(context.currency || "").toUpperCase(),
        purpose: context.purpose,
        decidedAt: at.toISOString(),
      },
    };
  }

  return { ok: false, ...(firstRefusal as { code: RoutingRefusalCode; message: string }) };
}

/**
 * Which channels may be offered to the payer for this context.
 *
 * The checkout must not display a rail that will be refused a moment later, so
 * the UI asks this rather than listing every channel the provider markets.
 */
export function offerableChannels(
  candidates: readonly RoutingCandidate[],
  context: Omit<RoutingContext, "channel">,
  channels: readonly PaymentChannel[]
): PaymentChannel[] {
  return channels.filter(
    (channel) => resolveRoute(candidates, { ...context, channel }).ok
  );
}
