import { AzamPayDisburseConfigurationError } from "./errors.js";
import { canonicalAzamPayProvider } from "./providers.js";
import type { AzamPayDisburseBankName } from "./types.js";

function providerValue(value: string, key: string): AzamPayDisburseBankName {
  const normalized = canonicalAzamPayProvider(value);
  if (!normalized) {
    throw new AzamPayDisburseConfigurationError({
      operation: "REQUEST",
      missingKeys: [key],
      message:
        `AzamPay disbursement: ${key}=${JSON.stringify(value)} is not one of the enabled ` +
        "provider values (Yas, Vodacom, Airtel, Halotel, Azampesa).",
    });
  }
  return normalized;
}

export function loadAzamPayDisbursementRequestConfig(destinationProvider: string): {
  sourceName: string;
  sourceProvider: AzamPayDisburseBankName;
  sourceAccount: string;
  transferType: string;
  destinationProvider: AzamPayDisburseBankName;
} {
  const sourceAccount = String(process.env.AZAMPAY_DISBURSE_SOURCE_ACCOUNT || "").trim();
  const transferType = String(process.env.AZAMPAY_DISBURSE_TRANSFER_TYPE || "FUND").trim();
  const missingKeys = [
    !sourceAccount && "AZAMPAY_DISBURSE_SOURCE_ACCOUNT",
  ].filter(Boolean) as string[];

  if (missingKeys.length > 0) {
    throw new AzamPayDisburseConfigurationError({
      operation: "REQUEST",
      missingKeys,
      message: `AzamPay disbursement: missing required request configuration: ${missingKeys.join(", ")}`,
    });
  }

  return {
    sourceName: String(
      process.env.AZAMPAY_DISBURSE_SOURCE_NAME || "NoLS AFRICA COMPANY LIMITED"
    ).trim(),
    sourceProvider: providerValue(
      process.env.AZAMPAY_DISBURSE_SOURCE_PROVIDER || "azampesa",
      "AZAMPAY_DISBURSE_SOURCE_PROVIDER"
    ),
    sourceAccount,
    transferType,
    destinationProvider: providerValue(destinationProvider, "PayoutAccount.provider"),
  };
}
