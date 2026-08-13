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
  transferDetails: { type: "MOBILE_MONEY", amount: 150000, dateInEpoch: 1786225810 },
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

    await azamPayNameLookup({ bankName: "airtel", accountNumber: "255688000001" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api-disbursement-sandbox.azampay.co.tz/api/v1/azampay/namelookup");
    expect(init.headers.Authorization).toBe("Bearer token-1");
    expect(JSON.parse(init.body)).toEqual({
      bankName: "airtel",
      accountNumber: "255688000001",
      checksum: "checksum-value",
    });
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
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));

    const result = await azamPayTransactionStatus({ pgReferenceId: "PG-77", bankName: "airtel" });

    expect(result).toEqual(body);
    expect(normalizeAzamPayFinalStatus(result)).toBeNull();
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
