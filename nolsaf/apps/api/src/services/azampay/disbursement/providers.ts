import type { AzamPayDisburseBankName } from "./types.js";

/**
 * AzamPay's live account uses network names on the wire, while older NoLSAF
 * profiles store a mixture of former network names and wallet product names.
 * Keep those storage aliases compatible and translate only at the provider
 * boundary so existing verified payout accounts do not need a risky rewrite.
 */
const PROVIDER_ALIASES: Record<string, AzamPayDisburseBankName> = {
  yas: "yas",
  tigo: "yas",
  mixx: "yas",
  mixxbyyas: "yas",

  vodacom: "vodacom",
  mpesa: "vodacom",

  airtel: "airtel",
  airtelmoney: "airtel",

  halotel: "halotel",
  halopesa: "halotel",

  azampesa: "azampesa",
};

const WIRE_PROVIDER_NAMES: Record<AzamPayDisburseBankName, string> = {
  yas: "Yas",
  vodacom: "Vodacom",
  airtel: "Airtel",
  halotel: "Halotel",
  azampesa: "Azampesa",
};

function providerAliasKey(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Returns the canonical live AzamPay provider or null for an unsupported value. */
export function canonicalAzamPayProvider(value: string): AzamPayDisburseBankName | null {
  return PROVIDER_ALIASES[providerAliasKey(value)] ?? null;
}

/** Converts canonical or legacy NoLSAF provider values to AzamPay's exact wire casing. */
export function toAzamPayWireBankName(value: string): string {
  const canonical = canonicalAzamPayProvider(value);
  return canonical ? WIRE_PROVIDER_NAMES[canonical] : String(value || "").trim();
}

/** Alias-aware comparison for callback/status provider correlation. */
export function azamPayProvidersMatch(left: string, right: string): boolean {
  const canonicalLeft = canonicalAzamPayProvider(left);
  const canonicalRight = canonicalAzamPayProvider(right);
  if (canonicalLeft || canonicalRight) {
    return Boolean(canonicalLeft && canonicalRight && canonicalLeft === canonicalRight);
  }
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

