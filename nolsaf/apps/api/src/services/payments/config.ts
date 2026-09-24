/**
 * Feature gate for the payment orchestration core.
 *
 * Design record: docs/private/NRMS_PAYMENT_ORCHESTRATION.md
 *
 * The design record explicitly does not authorize production access,
 * production credentials, real-money tests or production deployment. This
 * module is where that constraint is executable rather than aspirational.
 *
 * Two independent gates, because they fail differently. The first is the
 * ordinary on/off switch. The second is a separate acknowledgement required
 * before the core will operate against a PRODUCTION provider environment at
 * all, so an environment variable set by accident, or copied between
 * deployments, cannot by itself put real money in motion.
 */

import type { ProviderEnvironment } from "./adapter.js";

export type OrchestrationConfig = {
  enabled: boolean;
  environment: ProviderEnvironment;
};

export type OrchestrationGate =
  | { ok: true; config: OrchestrationConfig }
  | { ok: false; code: "orchestration_disabled" | "production_not_authorized"; message: string };

const VALID_ENVIRONMENTS: readonly ProviderEnvironment[] = ["SANDBOX", "STAGING", "PRODUCTION"];

function readEnvironment(raw: string | undefined): ProviderEnvironment {
  const value = String(raw || "").trim().toUpperCase();
  return (VALID_ENVIRONMENTS as readonly string[]).includes(value)
    ? (value as ProviderEnvironment)
    : "SANDBOX";
}

/**
 * Reads the gate from the environment.
 *
 * Defaults are the safe ones: disabled, and SANDBOX. An unset or misspelled
 * variable therefore yields "off against a sandbox" rather than "on against
 * production", which is the only direction a configuration mistake is allowed
 * to fail in.
 */
export function readOrchestrationConfig(
  env: NodeJS.ProcessEnv = process.env
): OrchestrationConfig {
  return {
    enabled: env.PAYMENTS_ORCHESTRATION_ENABLED === "true",
    environment: readEnvironment(env.PAYMENTS_ORCHESTRATION_ENVIRONMENT),
  };
}

/**
 * The check every orchestration entry point runs first.
 *
 * Returns a refusal rather than throwing so a route can answer with a plain
 * "online payment is not available" without leaking configuration state to a
 * caller who may be an anonymous guest holding a public token.
 */
export function checkOrchestrationGate(env: NodeJS.ProcessEnv = process.env): OrchestrationGate {
  const config = readOrchestrationConfig(env);

  if (!config.enabled) {
    return {
      ok: false,
      code: "orchestration_disabled",
      message: "Online payment is not available yet.",
    };
  }

  if (config.environment === "PRODUCTION" && env.PAYMENTS_ORCHESTRATION_ALLOW_PRODUCTION !== "true") {
    return {
      ok: false,
      code: "production_not_authorized",
      message: "Online payment is not available yet.",
    };
  }

  return { ok: true, config };
}
