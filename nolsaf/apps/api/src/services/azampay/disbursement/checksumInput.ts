/**
 * AzamPay Disbursement — Checksum Input Builder
 *
 * AzamPay has not published which fields make up the checksum input string,
 * in what order, with what casing, or with what separator (if any) — see
 * "Checksum: the security primitive" in docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md.
 * "Please contact us for the fields that will be used to calculate checksum."
 *
 * This module is deliberately configuration-driven instead of hardcoding a
 * guessed field list. Once AzamPay confirms the contract, set the matching
 * env var and nothing else in the call sites needs to change. Until then,
 * calling buildChecksumInput() throws a clear "not configured" error rather
 * than silently producing a wrong checksum.
 *
 * Config shape (JSON), one env var per AzamPay operation:
 *   {
 *     "fields": ["destination.bankName", "destination.accountNumber", ...],
 *     "separator": ""
 *   }
 * "fields" are dot-paths resolved against the outgoing request payload, in
 * the exact order AzamPay says they must be concatenated.
 */

export type AzamPayChecksumPurpose = "NAMELOOKUP" | "DISBURSE";

interface ChecksumFieldConfig {
  fields: string[];
  separator: string;
}

const ENV_VAR_BY_PURPOSE: Record<AzamPayChecksumPurpose, string> = {
  NAMELOOKUP: "AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP",
  DISBURSE: "AZAMPAY_CHECKSUM_FIELDS_DISBURSE",
};

function loadFieldConfig(purpose: AzamPayChecksumPurpose): ChecksumFieldConfig {
  const envVar = ENV_VAR_BY_PURPOSE[purpose];
  const raw = process.env[envVar];

  if (!raw) {
    throw new Error(
      `AzamPay checksum: ${envVar} is not set. AzamPay must confirm the exact field ` +
        `composition for ${purpose} before this can be built — do not guess it.`
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`AzamPay checksum: ${envVar} is not valid JSON.`);
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as any).fields) ||
    typeof (parsed as any).separator !== "string"
  ) {
    throw new Error(
      `AzamPay checksum: ${envVar} must be JSON of the form {"fields": string[], "separator": string}.`
    );
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
 * Throws if the config env var is not set — this is intentional. There is
 * no safe default here.
 */
export function buildChecksumInput(
  purpose: AzamPayChecksumPurpose,
  payload: Record<string, unknown>
): string {
  const { fields, separator } = loadFieldConfig(purpose);
  return fields.map((path) => stringifyField(getByPath(payload, path))).join(separator);
}
