import type { MnoProvider } from "../bookings";

export type CheckoutMnoProvider = MnoProvider;

export const MNO_PROVIDER_LABELS: Record<CheckoutMnoProvider, string> = {
  Mpesa: "M-Pesa",
  Tigo: "Mixx by Yas",
  Airtel: "Airtel Money",
  Halopesa: "HaloPesa",
  Azampesa: "AzamPesa"
};

// TCRA National Numbering and Signaling Point Codes Plan, Version 1.16 (July 2026).
// These original allocations are only a typing hint: Tanzania supports mobile-number
// portability, so the API performs the authoritative wallet/provider lookup before checkout.
const PREFIX_PROVIDER: Record<string, CheckoutMnoProvider> = {
  "072": "Mpesa",
  "074": "Mpesa",
  "075": "Mpesa",
  "076": "Mpesa",
  "079": "Mpesa",
  "065": "Tigo",
  "067": "Tigo",
  "070": "Tigo",
  "071": "Tigo",
  "077": "Tigo",
  "066": "Airtel",
  "068": "Airtel",
  "069": "Airtel",
  "078": "Airtel",
  "061": "Halopesa",
  "062": "Halopesa",
  "063": "Halopesa"
};

export type TanzaniaMnoInputState = {
  canSubmit: boolean;
  normalizedPhone: string | null;
  detectedProvider: CheckoutMnoProvider | null;
  level: "idle" | "info" | "success" | "warning" | "error";
  message: string;
};

/**
 * Keeps the editable part of a fixed +255 field typing-friendly. Users may
 * enter either 765012370 or the familiar local form 0765012370. A pasted
 * +255 number is also reduced to its national part.
 */
export function capTanzaniaMnoNationalInput(input: string): string {
  let digits = String(input ?? "").replace(/\D/g, "");
  if (digits.startsWith("255")) digits = digits.slice(3);
  return digits.slice(0, digits.startsWith("0") ? 10 : 9);
}

/** Builds the value inspected and eventually sent to the API. */
export function withTanzaniaMnoCountryCode(input: string): string {
  const local = capTanzaniaMnoNationalInput(input);
  const national = local.startsWith("0") ? local.slice(1) : local;
  return `+255${national}`;
}

export function inspectTanzaniaMnoInput(
  input: string,
  selectedProvider: CheckoutMnoProvider | null
): TanzaniaMnoInputState {
  const raw = String(input ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  const idle = (message: string): TanzaniaMnoInputState => ({
    canSubmit: false,
    normalizedPhone: null,
    detectedProvider: null,
    level: raw ? "info" : "idle",
    message
  });

  if (!raw) return idle("Tanzania mobile money only. Enter the number with +255.");

  const typingCountryCode = raw.startsWith("+")
    ? "+255".startsWith(raw.replace(/\s/g, ""))
    : "255".startsWith(digits);
  if (typingCountryCode && digits.length < 3) return idle("Continue with the Tanzania country code +255.");

  if (!digits.startsWith("255")) {
    return {
      ...idle("This checkout supports Tanzanian mobile-money numbers only. Use +255 followed by the wallet number."),
      level: "error"
    };
  }

  const national = digits.slice(3);
  if (national.length < 9) return idle(`Enter ${9 - national.length} more digit${9 - national.length === 1 ? "" : "s"}.`);
  if (national.length !== 9 || !/^[67]\d{8}$/.test(national)) {
    return {
      ...idle("Enter a valid Tanzanian mobile number in the form +255 7XX XXX XXX."),
      level: "error"
    };
  }

  const prefix = `0${national.slice(0, 2)}`;
  const detectedProvider = PREFIX_PROVIDER[prefix] ?? null;
  if (!detectedProvider) {
    if (selectedProvider) {
      return {
        canSubmit: true,
        normalizedPhone: `+255${national}`,
        detectedProvider: null,
        level: "warning",
        message: "The prefix cannot confirm the current wallet provider. We will verify the selected provider before sending a payment prompt."
      };
    }
    return {
      canSubmit: false,
      normalizedPhone: `+255${national}`,
      detectedProvider: null,
      level: "info",
      message: "Select the wallet provider currently serving this Tanzanian number."
    };
  }

  const normalizedPhone = `+255${national}`;
  if (!selectedProvider) {
    return {
      canSubmit: false,
      normalizedPhone,
      detectedProvider,
      level: "info",
      message: `This prefix is usually ${MNO_PROVIDER_LABELS[detectedProvider]}. Select the wallet currently serving this SIM.`
    };
  }

  if (selectedProvider === "Azampesa") {
    return {
      canSubmit: true,
      normalizedPhone,
      detectedProvider,
      level: "success",
      message: "The AzamPesa wallet will be verified before any payment prompt is sent."
    };
  }

  if (selectedProvider !== detectedProvider) {
    return {
      canSubmit: true,
      normalizedPhone,
      detectedProvider,
      level: "warning",
      message: `This prefix is usually ${MNO_PROVIDER_LABELS[detectedProvider]}, not ${MNO_PROVIDER_LABELS[selectedProvider]}. If the number was ported, keep its current provider; we will verify it before sending a payment prompt.`
    };
  }

  return {
    canSubmit: true,
    normalizedPhone,
    detectedProvider,
    level: "success",
    message: `${MNO_PROVIDER_LABELS[selectedProvider]} format recognized. The wallet will be verified before any payment prompt is sent.`
  };
}
