import { afterEach, describe, expect, it, vi } from "vitest";
import { buildChecksumInput } from "../services/azampay/disbursement/checksumInput";

describe("AzamPay checksum input", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the provider-confirmed disbursement field order without a separator", () => {
    vi.stubEnv(
      "AZAMPAY_CHECKSUM_FIELDS_DISBURSE",
      JSON.stringify({
        fields: [
          "source.accountNumber",
          "destination.accountNumber",
          "source.currency",
          "transferDetails.amount",
          "transferDetails.dateInEpoch",
          "externalReferenceId",
        ],
        separator: "",
      })
    );

    const input = buildChecksumInput("DISBURSE", {
      source: { accountNumber: "1000000164", currency: "TZS" },
      destination: { accountNumber: "1710446004", currency: "TZS" },
      transferDetails: { amount: 1000, dateInEpoch: 1_786_225_810 },
      externalReferenceId: "NtpK4mZrT7xQdH2vLs9WcJ5cBb",
    });

    expect(input).toBe(
      "1000000164" +
        "1710446004" +
        "TZS" +
        "1000" +
        "1786225810" +
        "NtpK4mZrT7xQdH2vLs9WcJ5cBb"
    );
  });

  it("continues to fail closed when the separate Name Lookup formula is absent", () => {
    vi.stubEnv("AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP", "");

    expect(() =>
      buildChecksumInput("NAMELOOKUP", {
        bankName: "airtel",
        accountNumber: "255700000000",
      })
    ).toThrow(/AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP/);
  });
});
