import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  normalizeAzamPayFinalStatus,
  validateDisbursementCallbackCorrelation,
} from "../services/azampay/disbursement/contract";

const mocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  invalidateToken: vi.fn(),
  checksum: vi.fn(),
  checksumInput: vi.fn(),
}));

vi.mock("../services/azampay/disbursement/auth.js", () => ({
  getAzamPayDisburseToken: mocks.getToken,
  invalidateAzamPayDisburseToken: mocks.invalidateToken,
}));
vi.mock("../services/azampay/disbursement/checksum.js", () => ({
  azamPayChecksum: mocks.checksum,
}));
vi.mock("../services/azampay/disbursement/checksumInput.js", () => ({
  buildChecksumInput: mocks.checksumInput,
}));

import {
  azamPayDisburse,
  azamPayNameLookup,
  azamPayTransactionStatus,
} from "../services/azampay/disbursement/client";
import {
  canonicalAzamPayProvider,
  toAzamPayWireBankName,
} from "../services/azampay/disbursement/providers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const disburseRequest = {
  source: {
    countryCode: "TZ",
    fullName: "NoLS AFRICA COMPANY LIMITED",
    bankName: "azampesa" as const,
    accountNumber: "255700000000",
    currency: "TZS",
  },
  destination: {
    countryCode: "TZ",
    fullName: "ASHA MTUMWA",
    bankName: "airtel" as const,
    accountNumber: "255688000001",
    currency: "TZS",
  },
  transferDetails: { type: "FUND", amount: 150000, dateInEpoch: 1786225810 },
  externalReferenceId: "NoLSAF-O-2608081645-D51QVX",
};

describe("AzamPay disbursement HTTP contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AZAMPAY_DISBURSE_PUBLIC_KEY", "test-public-key");
    mocks.getToken.mockResolvedValue("token-1");
    mocks.checksum.mockReturnValue("checksum-value");
    mocks.checksumInput.mockReturnValue("checksum-input");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends name lookup with bearer auth and the calculated checksum", async () => {
    vi.stubEnv(
      "AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP",
      JSON.stringify({ fields: ["bankName", "accountNumber"], separator: "" })
    );
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        name: "ASHA MTUMWA",
        fname: "ASHA",
        lname: "MTUMWA",
        status: true,
        statusCode: 200,
        accountNumber: "255688000001",
        bankName: "airtel",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    // Internal lowercase provider in -> AzamPay's wire casing out ("Airtel").
    await azamPayNameLookup({ bankName: "airtel", accountNumber: "255688000001" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-disbursement-sandbox.azampay.co.tz/api/v1/azampay/namelookup");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({
      bankName: "Airtel",
      accountNumber: "255688000001",
      checksum: "checksum-value",
    });
  });

  it("uses the confirmed default Name Lookup checksum and normalizes fName/lName", async () => {
    vi.stubEnv("AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP", "");
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        fName: "ASHA",
        lName: "MTUMWA",
        status: true,
        statusCode: 200,
        accountNumber: "255688000001",
        bankName: "airtel",
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await azamPayNameLookup({ bankName: "airtel", accountNumber: "255688000001" });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      bankName: "Airtel",
      accountNumber: "255688000001",
      checksum: "checksum-value",
    });
    expect(result).toMatchObject({ name: "ASHA MTUMWA", fname: "ASHA", lname: "MTUMWA" });
    expect(mocks.checksumInput).toHaveBeenCalledWith("NAMELOOKUP", {
      bankName: "Airtel",
      accountNumber: "255688000001",
    });
    expect(mocks.checksum).toHaveBeenCalledWith("checksum-input", "test-public-key");
  });

  it("refreshes once on 401 and replays the exact same disbursement reference", async () => {
    mocks.getToken.mockReset().mockResolvedValueOnce("expired-token").mockResolvedValueOnce("fresh-token");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ message: "Please Provide Valid Authorization" }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          pgReferenceId: "PG-77",
          message: "Your transaction is in process",
          success: true,
          statusCode: 200,
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await azamPayDisburse(disburseRequest);

    expect(result.pgReferenceId).toBe("PG-77");
    expect(mocks.invalidateToken).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(secondBody).toEqual(firstBody);
    expect(secondBody.externalReferenceId).toBe(disburseRequest.externalReferenceId);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer expired-token");
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer fresh-token");
  });

  it("rejects a nominally successful disbursement without a pgReferenceId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ message: "Your transaction is in process", success: true, statusCode: 200 })
      )
    );

    await expect(azamPayDisburse(disburseRequest)).rejects.toMatchObject({
      name: "AzamPayDisburseError",
      retryClass: "RECONCILE_FIRST",
    });
  });

  it("accepts the documented pending status envelope without treating it as paid", async () => {
    const body = {
      pgReferenceId: "PG-77",
      message: "Your transaction is in process",
      success: true,
      statusCode: 200,
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(body));
    vi.stubGlobal("fetch", fetchMock);

    const result = await azamPayTransactionStatus({ pgReferenceId: "PG-77", bankName: "tigo" });

    expect(result).toEqual(body);
    expect(normalizeAzamPayFinalStatus(result)).toBeNull();
    expect(String(fetchMock.mock.calls[0][0])).toContain("bankName=Yas");
  });

  it("recognizes only an explicit provider final status", () => {
    const base = {
      pgReferenceId: "PG-77",
      message: "status query accepted",
      success: true,
      statusCode: 200,
    };
    expect(normalizeAzamPayFinalStatus({ ...base, status: "SUCCESS" })).toBe("success");
    expect(normalizeAzamPayFinalStatus({ ...base, status: "failure" })).toBe("failure");
    expect(normalizeAzamPayFinalStatus({ ...base, status: "processing" })).toBeNull();
  });

  it("rejects a transaction-status response for a different pgReferenceId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          pgReferenceId: "PG-OTHER",
          message: "Transaction completed",
          success: true,
          statusCode: 200,
          status: "success",
        })
      )
    );

    await expect(
      azamPayTransactionStatus({ pgReferenceId: "PG-77", bankName: "airtel" })
    ).rejects.toMatchObject({ name: "AzamPayDisburseError" });
  });
});

describe("AzamPay callback correlation", () => {
  const stored = {
    externalReferenceId: "NoLSAF-O-2608081645-D51QVX",
    pgReferenceId: "PG-77",
    amount: "150000.00",
    bankName: "airtel",
  };
  const callback = {
    initiatorReferenceId: stored.externalReferenceId,
    fspReferenceId: "FSP-77",
    pgReferenceId: "PG-77",
    amount: "150000",
    status: "success",
    message: "Transaction completed",
    operator: "Airtel",
  };

  it("accepts a callback only when all identifiers agree", () => {
    expect(validateDisbursementCallbackCorrelation(stored, callback)).toBeNull();
  });

  it("restores PEM newlines escaped by the deployment secret store", async () => {
    vi.stubEnv(
      "AZAMPAY_DISBURSE_PUBLIC_KEY",
      "-----BEGIN PUBLIC KEY-----\\nencoded-key\\n-----END PUBLIC KEY-----"
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          name: "ASHA MTUMWA",
          status: true,
          statusCode: 200,
          accountNumber: "255688000001",
          bankName: "Airtel",
        })
      )
    );

    await azamPayNameLookup({ bankName: "airtel", accountNumber: "255688000001" });

    expect(mocks.checksum).toHaveBeenCalledWith(
      "checksum-input",
      "-----BEGIN PUBLIC KEY-----\nencoded-key\n-----END PUBLIC KEY-----"
    );
  });

  it("correlates callbacks across legacy wallet aliases and live network names", () => {
    expect(
      validateDisbursementCallbackCorrelation(
        { ...stored, bankName: "tigo" },
        { ...callback, operator: "Yas" }
      )
    ).toBeNull();
    expect(
      validateDisbursementCallbackCorrelation(
        { ...stored, bankName: "mpesa" },
        { ...callback, operator: "Vodacom" }
      )
    ).toBeNull();
    expect(
      validateDisbursementCallbackCorrelation(
        { ...stored, bankName: "halopesa" },
        { ...callback, operator: "Halotel" }
      )
    ).toBeNull();
  });

  it("detects pgReferenceId, amount, and operator mismatches", () => {
    expect(
      validateDisbursementCallbackCorrelation(stored, { ...callback, pgReferenceId: "PG-OTHER" })
    ).toMatchObject({ code: "pg_reference_mismatch" });
    expect(
      validateDisbursementCallbackCorrelation(stored, { ...callback, amount: "150001" })
    ).toMatchObject({ code: "amount_mismatch" });
    expect(
      validateDisbursementCallbackCorrelation(stored, { ...callback, operator: "Tigo" })
    ).toMatchObject({ code: "operator_mismatch" });
    expect(
      validateDisbursementCallbackCorrelation(stored, { ...callback, pgReferenceId: "" })
    ).toMatchObject({ code: "pg_reference_mismatch" });
  });
});

describe("AzamPay live provider normalization", () => {
  it.each([
    ["tigo", "yas", "Yas"],
    ["Mixx by Yas", "yas", "Yas"],
    ["mpesa", "vodacom", "Vodacom"],
    ["M-Pesa", "vodacom", "Vodacom"],
    ["halopesa", "halotel", "Halotel"],
    ["Airtel Money", "airtel", "Airtel"],
    ["AzamPesa", "azampesa", "Azampesa"],
  ])("maps %s to canonical %s and wire value %s", (input, canonical, wire) => {
    expect(canonicalAzamPayProvider(input)).toBe(canonical);
    expect(toAzamPayWireBankName(input)).toBe(wire);
  });
});
