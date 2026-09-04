/**
 * Loads routing rules for a context and hands them to the pure resolver.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * Kept separate from routing.ts on purpose. The decision logic stays pure and
 * fully testable without a database; this module does nothing but fetch the
 * candidate rows. It mirrors the split the payouts services already use, where
 * eligibility reads the source flows but never decides anything itself.
 */

import type { ProviderEnvironment } from "./adapter.js";
import type { RoutingCandidate, RoutingScope } from "./routing.js";
import { isPaymentChannel, isPaymentPurpose } from "./types.js";

type RoutingRuleRow = {
  id: number;
  scopeType: string;
  scopeId: number | null;
  purpose: string | null;
  currency: string | null;
  channel: string | null;
  priority: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  connection: {
    id: number;
    provider: string;
    environment: string;
    isEnabled: boolean;
    capabilities: unknown;
  };
};

const SCOPES: readonly string[] = ["GLOBAL", "MERCHANT", "PROPERTY", "OUTLET"];
const ENVIRONMENTS: readonly string[] = ["SANDBOX", "STAGING", "PRODUCTION"];

/**
 * Converts a stored row into a candidate.
 *
 * Returns null for any row whose stored strings are not values this code
 * understands. A rule naming an unknown scope, purpose or channel is dropped
 * rather than coerced, because a rule nobody can interpret must not be allowed
 * to influence where money goes.
 */
function toCandidate(row: RoutingRuleRow): RoutingCandidate | null {
  if (!SCOPES.includes(row.scopeType)) return null;
  if (!ENVIRONMENTS.includes(row.connection.environment)) return null;
  if (row.purpose !== null && !isPaymentPurpose(row.purpose)) return null;
  if (row.channel !== null && !isPaymentChannel(row.channel)) return null;

  return {
    ruleId: row.id,
    scopeType: row.scopeType as RoutingScope,
    scopeId: row.scopeId,
    purpose: row.purpose === null ? null : (row.purpose as RoutingCandidate["purpose"]),
    currency: row.currency,
    channel: row.channel === null ? null : (row.channel as RoutingCandidate["channel"]),
    priority: row.priority,
    isActive: row.isActive,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: row.effectiveTo,
    connection: {
      id: row.connection.id,
      provider: row.connection.provider,
      environment: row.connection.environment as ProviderEnvironment,
      isEnabled: row.connection.isEnabled,
      capabilities: row.connection.capabilities,
    },
  };
}

/**
 * Fetches every rule that could possibly apply to this context.
 *
 * Scope narrowing happens in the query so an unrelated property's rules never
 * enter the process. Effective dating and attribute matching are left to the
 * pure resolver, which is where they are covered by tests.
 */
export async function loadRoutingCandidates(
  db: any,
  context: { merchantId: number; propertyId: number | null; outletId: number | null }
): Promise<RoutingCandidate[]> {
  const scopeFilters: Array<Record<string, unknown>> = [
    { scopeType: "GLOBAL" },
    { scopeType: "MERCHANT", scopeId: context.merchantId },
  ];
  if (context.propertyId !== null) {
    scopeFilters.push({ scopeType: "PROPERTY", scopeId: context.propertyId });
  }
  if (context.outletId !== null) {
    scopeFilters.push({ scopeType: "OUTLET", scopeId: context.outletId });
  }

  const rows: RoutingRuleRow[] = await db.paymentRoutingRule.findMany({
    where: { isActive: true, OR: scopeFilters },
    include: {
      connection: {
        select: {
          id: true,
          provider: true,
          environment: true,
          isEnabled: true,
          capabilities: true,
        },
      },
    },
  });

  return rows.map(toCandidate).filter((candidate): candidate is RoutingCandidate => candidate !== null);
}
