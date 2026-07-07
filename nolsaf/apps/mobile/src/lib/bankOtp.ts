export type BankOtpCode = "CRDB" | "NMB";

export const BANK_OTP_INSTRUCTIONS: Record<BankOtpCode, { title: string; steps: string[] }> = {
  CRDB: {
    title: "Generate CRDB OTP",
    steps: [
      "Dial *150*03# and enter your SIM Banking PIN.",
      "Choose 7 Other services, then 5 AzamPay.",
      "Select Link AzamPay Account to generate the OTP."
    ]
  },
  NMB: {
    title: "Generate NMB OTP",
    steps: [
      "Dial *150*66#.",
      "Choose 8 More, then 5 Register Sarafu.",
      "Choose 1 Select Account No. to generate the OTP."
    ]
  }
};

export function getBankOtpInstruction(bankCode?: string | null) {
  return bankCode === "CRDB" || bankCode === "NMB" ? BANK_OTP_INSTRUCTIONS[bankCode] : null;
}
