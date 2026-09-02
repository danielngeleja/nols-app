import { normalizePhone } from "../../lib/azampay.helpers.js";
import { azamPayNameLookup } from "./disbursement/client.js";
import { AzamPayDisburseConfigurationError, AzamPayDisburseError } from "./disbursement/errors.js";
import { azamPayProvidersMatch, canonicalAzamPayProvider } from "./disbursement/providers.js";
import type { AzamPayNameLookupResponse } from "./disbursement/types.js";

type NameLookup = (input: { bankName: string; accountNumber: string }) => Promise<AzamPayNameLookupResponse>;

export type MnoCheckoutPreflightResult =
  | { ok: true; normalizedPhone: string }
  | { ok: false; status: 400 | 409 | 503; code: string; message: string };

function providerLabel(provider: string): string {
  switch (canonicalAzamPayProvider(provider)) {
    case "vodacom": return "M-Pesa";
    case "yas": return "Mixx by Yas";
    case "airtel": return "Airtel Money";
    case "halotel": return "HaloPesa";
    case "azampesa": return "AzamPesa";
    default: return "the selected mobile-money provider";
  }
}

function canonicalAccountNumber(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * Verifies the wallet/provider pairing before PostCheckout can send a handset
 * prompt. It exposes no account-holder name and never initiates a payment.
 */
export async function verifyMnoWalletForCheckout(
  input: { phoneNumber: string; provider: string },
  dependencies: { nameLookup?: NameLookup } = {}
): Promise<MnoCheckoutPreflightResult> {
  const normalizedPhone = normalizePhone(input.phoneNumber);
  if (!normalizedPhone || !/^\+255[67]\d{8}$/.test(normalizedPhone)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_tanzania_mno_number",
      message: "Mobile money checkout supports Tanzanian numbers only. Enter the wallet number with +255."
    };
  }

  if (!canonicalAzamPayProvider(input.provider)) {
    return {
      ok: false,
      status: 400,
      code: "unsupported_mno_provider",
      message: "Choose a supported Tanzanian mobile-money provider."
    };
  }

  const nameLookup = dependencies.nameLookup ?? azamPayNameLookup;
  const requestedAccount = canonicalAccountNumber(normalizedPhone);
  let lookup: AzamPayNameLookupResponse;
  try {
    lookup = await nameLookup({ bankName: input.provider, accountNumber: requestedAccount });
  } catch (error) {
    if (error instanceof AzamPayDisburseError && error.retryClass === "VALIDATION") {
      return {
        ok: false,
        status: 409,
        code: "mno_wallet_not_verified",
        message: `This number could not be verified as a ${providerLabel(input.provider)} wallet. Check the number and selected provider.`
      };
    }
    if (error instanceof AzamPayDisburseConfigurationError || error instanceof AzamPayDisburseError) {
      return {
        ok: false,
        status: 503,
        code: "mno_verification_unavailable",
        message: "We could not verify this mobile-money wallet right now. No payment request was sent. Please try again later."
      };
    }
    return {
      ok: false,
      status: 503,
      code: "mno_verification_unavailable",
      message: "We could not verify this mobile-money wallet right now. No payment request was sent. Please try again later."
    };
  }

  const returnedAccount = canonicalAccountNumber(lookup.accountNumber);
  if (!lookup.status || !returnedAccount || returnedAccount !== requestedAccount) {
    return {
      ok: false,
      status: 409,
      code: "mno_wallet_not_verified",
      message: "This mobile-money number could not be verified. Check the Tanzania number and try again."
    };
  }

  if (!azamPayProvidersMatch(input.provider, lookup.bankName)) {
    return {
      ok: false,
      status: 409,
      code: "mno_provider_mismatch",
      message: `This number does not belong to ${providerLabel(input.provider)}. Select the wallet provider currently serving this number.`
    };
  }

  return { ok: true, normalizedPhone };
}
