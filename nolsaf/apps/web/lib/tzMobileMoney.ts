// Shared Tanzanian mobile-money and bank-checkout helpers for every AzamPay
// payment page (group stay deposit, NRMS agency checkout). One copy of the
// prefix map and OTP steps so the pages can never drift apart.

export const TZ_MNO_PROVIDERS = [
  { id: "Mpesa", name: "M-Pesa", icon: "/assets/M-pesa.png" },
  { id: "Tigo", name: "Mixx by Yas", icon: "/assets/mix by yas.png" },
  { id: "Airtel", name: "Airtel Money", icon: "/assets/airtel_money.png" },
  { id: "Halopesa", name: "HaloPesa", icon: "/assets/halopesa.png" },
] as const;
export type TzMnoProvider = (typeof TZ_MNO_PROVIDERS)[number]["id"];

/** AzamPesa is a wallet, not a network, so no number prefix points to it. */
export const AZAMPESA_PROVIDER = { id: "Azampesa", name: "AzamPesa", icon: "/assets/azam-pesa-logo-png.png" } as const;

export const TZ_CHECKOUT_BANKS = [
  { code: "CRDB", name: "CRDB Bank", logo: "/assets/NoLSAF_CRDB.png" },
  { code: "NMB", name: "NMB Bank", logo: "/assets/NoLSAF_NMB.png" },
] as const;
export type TzBankCode = (typeof TZ_CHECKOUT_BANKS)[number]["code"];

export const BANK_OTP_INSTRUCTIONS: Record<TzBankCode, { title: string; steps: string[] }> = {
  CRDB: {
    title: "Generate CRDB OTP",
    steps: [
      "Dial *150*03# and enter your SIM Banking PIN.",
      "Choose 7 Other services, then 5 AzamPay.",
      "Select Link AzamPay Account to generate the OTP.",
    ],
  },
  NMB: {
    title: "Generate NMB OTP",
    steps: ["Dial *150*66#.", "Choose 8 More, then 5 Register Sarafu.", "Choose 1 Select Account No. to generate the OTP."],
  },
};

const PREFIX_PROVIDER: Record<string, TzMnoProvider> = {
  "074": "Mpesa", "075": "Mpesa", "076": "Mpesa",
  "065": "Tigo", "067": "Tigo", "071": "Tigo", "077": "Tigo",
  "068": "Airtel", "069": "Airtel", "078": "Airtel",
  "062": "Halopesa",
};

/** Keeps only digits and a leading +, at most 13 characters. */
export function capTzPhone(value: string): string {
  return value.replace(/[^\d+]/g, "").slice(0, 13);
}

/** 0XXXXXXXXX form from +255…, 255… or a bare 9-digit number. */
export function normalizeTz(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.startsWith("255")) digits = "0" + digits.slice(3);
  else if (digits.length === 9 && (digits[0] === "7" || digits[0] === "6")) digits = "0" + digits;
  return digits;
}

/** The network a Tanzanian number belongs to, from its dialling prefix. */
export function detectTzProvider(input: string): TzMnoProvider | null {
  const digits = normalizeTz(input);
  return digits.length >= 3 ? PREFIX_PROVIDER[digits.slice(0, 3)] ?? null : null;
}

export function isValidTzMobile(input: string): boolean {
  return /^0[67]\d{8}$/.test(normalizeTz(input));
}
