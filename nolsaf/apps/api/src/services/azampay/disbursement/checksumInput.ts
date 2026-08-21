/**
 * AzamPay Disbursement — Checksum Input Builder
 *
 * AzamPay supplied the field composition used in the successful 17 August
 * integration tests. Those accepted formulas are now safe defaults. Optional
 * env overrides remain available for a future provider-contract revision and
 * are strictly validated before use.
 *
 * Config shape (JSON), one env var per AzamPay operation:
 *   {
 *     "fields": ["destination.bankName", "destination.accountNumber", ...],
 *     "separator": ""
 *   }
 * "fields" are dot-paths resolved against the outgoing request payload, in
 * the exact order AzamPay says they must be concatenated.
 */

import { AzamPayDisburseConfigurationError } from "./errors.js";

export type AzamPayChecksumPurpose = "NAMELOOKUP" | "DISBURSE";

interface ChecksumFieldConfig {
  fields: string[];
  separator: string;
}

const ENV_VAR_BY_PURPOSE: Record<AzamPayChecksumPurpose, string> = {
  NAMELOOKUP: "AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP",
  DISBURSE: "AZAMPAY_CHECKSUM_FIELDS_DISBURSE",
};

const CONFIRMED_FIELD_CONFIG: Record<AzamPayChecksumPurpose, ChecksumFieldConfig> = {
  NAMELOOKUP: {
    fields: ["bankName", "accountNumber"],
    separator: "",
  },
  DISBURSE: {
    fields: [
      "source.accountNumber",
      "destination.accountNumber",
      "source.currency",
      "transferDetails.amount",
      "transferDetails.dateInEpoch",
      "externalReferenceId",
    ],
    separator: "",
  },
};

function loadFieldConfig(purpose: AzamPayChecksumPurpose): ChecksumFieldConfig {
  const envVar = ENV_VAR_BY_PURPOSE[purpose];
  const raw = process.env[envVar];

  if (!raw) return CONFIRMED_FIELD_CONFIG[purpose];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AzamPayDisburseConfigurationError({
      operation: "CHECKSUM",
      missingKeys: [envVar],
      message: `AzamPay checksum: ${envVar} is not valid JSON.`,
    });
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as any).fields) ||
    typeof (parsed as any).separator !== "string"
  ) {
    throw new AzamPayDisburseConfigurationError({
      operation: "CHECKSUM",
      missingKeys: [envVar],
      message: `AzamPay checksum: ${envVar} must be JSON of the form {"fields": string[], "separator": string}.`,
    });
  }

  return parsed as ChecksumFieldConfig;
}

function getByPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}

/** Stringifies a field value for concatenation. Numbers are not reformatted. */
function stringifyField(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

/**
 * Builds the checksum input string for a given AzamPay operation, from the
 * outgoing request payload, using the field order confirmed by AzamPay via
 * AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP / AZAMPAY_CHECKSUM_FIELDS_DISBURSE.
 *
 * Uses the accepted provider formula by default; an env override is useful
 * only if AzamPay revisions the contract for this account.
 */
export function buildChecksumInput(
  purpose: AzamPayChecksumPurpose,
  payload: Record<string, unknown>
): string {
  const { fields, separator } = loadFieldConfig(purpose);
  return fields.map((path) => stringifyField(getByPath(payload, path))).join(separator);
}
