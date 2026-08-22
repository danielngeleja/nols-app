import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAzamPayDisbursementRequestConfig } from "../services/azampay/disbursement/config";

describe("AzamPay live provider request configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("normalizes legacy provider aliases and defaults the confirmed transfer type", () => {
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "1000000164");
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_PROVIDER", "AzamPesa");
    vi.stubEnv("AZAMPAY_DISBURSE_TRANSFER_TYPE", "");

    expect(loadAzamPayDisbursementRequestConfig("Mixx by Yas")).toMatchObject({
      sourceProvider: "azampesa",
      destinationProvider: "yas",
      transferType: "FUND",
    });
  });

  it("rejects bank providers before a money-out request is built", () => {
    vi.stubEnv("AZAMPAY_DISBURSE_SOURCE_ACCOUNT", "1000000164");

    expect(() => loadAzamPayDisbursementRequestConfig("CRDB")).toThrow(
      /Yas, Vodacom, Airtel, Halotel, Azampesa/
    );
  });
});

