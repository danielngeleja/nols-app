/**
 * AzamPay Disbursement — HTTP Client
 *
 * Transport only. No business rules live here (eligibility, approval,
 * ledger writes belong in the payout service layer, phase 3). This module's
 * job is: attach a token, attach a checksum, call the endpoint, classify
 * errors, and return typed results.
 *
 * Disbursement remains fail-closed until its public key and checksum field
 * composition are configured. Name Lookup is read-only and the current test
 * environment accepts it without a checksum. Configuring
 * AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP automatically adds the encrypted value.
 */

import { getAzamPayDisburseToken, invalidateAzamPayDisburseToken } from "./auth.js";
import { azamPayChecksum } from "./checksum.js";
import { buildChecksumInput } from "./checksumInput.js";
import { AzamPayDisburseConfigurationError, mapAzamPayError } from "./errors.js";
import type {
  AzamPayDisburseRequest,
  AzamPayDisburseResponse,
  AzamPayNameLookupRequest,
  AzamPayNameLookupResponse,
  AzamPayTransactionStatusResponse,
} from "./types.js";

const FETCH_TIMEOUT_MS = 15_000;

interface HttpJsonResult {
  status: number;
  body: any;
}

function disburseHost(): string {
  return (
    process.env.AZAMPAY_DISBURSE_API_URL || "https://api-disbursement-sandbox.azampay.co.tz"
  ).replace(/\/$/, "");
}

/**
 * AzamPay's Name Lookup / Disburse samples send the provider token in a
 * specific casing ("Azampesa"), and provider matching on their side is
 * case-sensitive. Our internal representation is lowercase
 * (AzamPayDisburseBankName, and PayoutAccount.provider can be any casing the
 * profile stored), so translate to AzamPay's wire casing at the egress —
 * this keeps the payload bankName and the (Name Lookup) checksum input both
 * on the exact string AzamPay expects. Unknown providers pass through
 * untouched. Only "Azampesa" is confirmed against an AzamPay sample;
 * Tigo/Airtel follow the same Title-case convention and should be
 * reconfirmed if a rail misroutes.
 */
const AZAMPAY_WIRE_BANK_NAME: Record<string, string> = {
  azampesa: "Azampesa",
  tigo: "Tigo",
  airtel: "Airtel",
};

export function toAzamPayWireBankName(value: string): string {
  const trimmed = String(value || "").trim();
  return AZAMPAY_WIRE_BANK_NAME[trimmed.toLowerCase()] ?? trimmed;
}

function requirePublicKey(): string {
  const key = process.env.AZAMPAY_DISBURSE_PUBLIC_KEY;
  if (!key) {
    throw new AzamPayDisburseConfigurationError({
      operation: "PUBLIC_KEY",
      missingKeys: ["AZAMPAY_DISBURSE_PUBLIC_KEY"],
      message:
        "AzamPay disbursement: AZAMPAY_DISBURSE_PUBLIC_KEY is not set. Contact AzamPay support " +
        "for the RSA public key before any real disbursement or name lookup call can be made.",
    });
  }
  return key;
}

async function postJson(
  path: string,
  body: unknown,
  token: string
): Promise<HttpJsonResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${disburseHost()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timer);
    // Network failure: outcome unknown. Callers must treat this as
    // "reconcile before retrying", never as a clean failure.
    throw mapAzamPayError(null, { message: `network error (${err?.name ?? "unknown"})` });
  } finally {
    clearTimeout(timer);
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* some error responses may not be JSON */
  }

  return { status: res.status, body: json };
}

/** Refreshes an expired token once and replays the exact same provider request. */
async function withAuthRetry(
  operation: (token: string) => Promise<HttpJsonResult>
): Promise<HttpJsonResult> {
  const firstToken = await getAzamPayDisburseToken();
  const first = await operation(firstToken);
  if (first.status !== 401) return first;

  await invalidateAzamPayDisburseToken();
  const refreshedToken = await getAzamPayDisburseToken();
  const second = await operation(refreshedToken);
  if (second.status === 401) {
    await invalidateAzamPayDisburseToken();
  }
  return second;
}

function isProviderSuccessCode(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 200 && Number(value) < 300;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function invalidProviderResponse(status: number, body: any, detail: string): never {
  throw mapAzamPayError(status, {
    ...(body && typeof body === "object" ? body : {}),
    message: `Invalid AzamPay response: ${detail}`,
  });
}

/**
 * Resolves and verifies a beneficiary account before it can be used as a
 * payout destination. Caller is responsible for persisting isVerified /
 * verifiedAt on the PayoutAccount row — this function only talks to AzamPay.
 */
export async function azamPayNameLookup(
  input: Pick<AzamPayNameLookupRequest, "bankName" | "accountNumber">
): Promise<AzamPayNameLookupResponse> {
<<<<<<< Updated upstream
  const request: AzamPayNameLookupRequest = {
    ...input,
=======
  const publicKey = requirePublicKey();

  // Normalize to AzamPay's wire casing BEFORE building the checksum, so the
  // hashed bankName and the payload bankName are the same expected string.
  const normalizedInput = { ...input, bankName: toAzamPayWireBankName(input.bankName) };
  const checksumInput = buildChecksumInput("NAMELOOKUP", normalizedInput);
  const request: AzamPayNameLookupRequest = {
    ...normalizedInput,
    checksum: azamPayChecksum(checksumInput, publicKey),
>>>>>>> Stashed changes
  };

  if (String(process.env.AZAMPAY_CHECKSUM_FIELDS_NAMELOOKUP || "").trim()) {
    const publicKey = requirePublicKey();
    const checksumInput = buildChecksumInput("NAMELOOKUP", input);
    request.checksum = azamPayChecksum(checksumInput, publicKey);
  }

  const { status, body } = await withAuthRetry((token) =>
    postJson("/api/v1/azampay/namelookup", request, token)
  );

  if (status < 200 || status >= 300 || !body?.status) {
    throw mapAzamPayError(status, body);
  }
  if (!isProviderSuccessCode(body.statusCode)) {
    invalidProviderResponse(status, body, "name lookup statusCode is missing or non-success");
  }

  // The live test API returns fName/lName while older documentation and
  // examples use fname/lname/name. Normalise both shapes for every caller.
  const fname = String(body.fName ?? body.fname ?? "").trim();
  const lname = String(body.lName ?? body.lname ?? "").trim();
  const name = String(body.name ?? [fname, lname].filter(Boolean).join(" ")).trim();

  return {
    ...body,
    name,
    fname: fname || undefined,
    lname: lname || undefined,
  } as AzamPayNameLookupResponse;
}

/**
 * Submits a disbursement. Returns AzamPay's acceptance response — this is
 * NOT a final paid state. Only a callback or a confirmed status poll should
 * transition a payout to PAID. See "Response handling: accepted is not
 * paid" in the dev guide.
 */
export async function azamPayDisburse(
  request: Omit<AzamPayDisburseRequest, "checksum">
): Promise<AzamPayDisburseResponse> {
  const publicKey = requirePublicKey();

  // The Disburse checksum does not include bankName, but the payload does and
  // AzamPay matches the rail case-sensitively — normalize both parties here.
  const normalizedRequest = {
    ...request,
    source: { ...request.source, bankName: toAzamPayWireBankName(request.source.bankName) },
    destination: {
      ...request.destination,
      bankName: toAzamPayWireBankName(request.destination.bankName),
    },
  };
  const checksumInput = buildChecksumInput("DISBURSE", normalizedRequest);
  const fullRequest: AzamPayDisburseRequest = {
    ...normalizedRequest,
    checksum: azamPayChecksum(checksumInput, publicKey),
  };

  const { status, body } = await withAuthRetry((token) =>
    postJson("/api/v1/azampay/disburse", fullRequest, token)
  );

  if (status < 200 || status >= 300 || !body?.success) {
    throw mapAzamPayError(status, body);
  }
  if (!isProviderSuccessCode(body.statusCode)) {
    invalidProviderResponse(status, body, "disbursement statusCode is missing or non-success");
  }
  if (!isNonEmptyString(body.pgReferenceId)) {
    invalidProviderResponse(status, body, "successful disbursement has no pgReferenceId");
  }

  return body as AzamPayDisburseResponse;
}

/** Fallback/reconciliation query — use when a callback is delayed, missed, or a payout looks stale. */
export async function azamPayTransactionStatus(params: {
  pgReferenceId: string;
  bankName: string;
}): Promise<AzamPayTransactionStatusResponse> {
  const url = new URL(`${disburseHost()}/api/v1/azampay/transactionstatus`);
  url.searchParams.set("pgReferenceId", params.pgReferenceId);
  url.searchParams.set("bankName", params.bankName);

  const { status, body } = await withAuthRetry(async (token) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
    } catch (err: any) {
      throw mapAzamPayError(null, { message: `network error (${err?.name ?? "unknown"})` });
    } finally {
      clearTimeout(timer);
    }

    let responseBody: any = null;
    try {
      responseBody = await res.json();
    } catch {
      /* ignore */
    }
    return { status: res.status, body: responseBody };
  });

  if (status < 200 || status >= 300 || body?.success !== true) {
    throw mapAzamPayError(status, body);
  }
  if (!isProviderSuccessCode(body.statusCode)) {
    invalidProviderResponse(status, body, "transaction statusCode is missing or non-success");
  }
  if (!isNonEmptyString(body.pgReferenceId)) {
    invalidProviderResponse(status, body, "transaction status response has no pgReferenceId");
  }
  if (body.pgReferenceId !== params.pgReferenceId) {
    invalidProviderResponse(status, body, "transaction status pgReferenceId does not match the request");
  }

  return body as AzamPayTransactionStatusResponse;
}
