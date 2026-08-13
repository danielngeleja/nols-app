/**
 * AzamPay Disbursement — HTTP Client
 *
 * Transport only. No business rules live here (eligibility, approval,
 * ledger writes belong in the payout service layer, phase 3). This module's
 * job is: attach a token, attach a checksum, call the endpoint, classify
 * errors, and return typed results.
 *
 * The public key and checksum field composition are unconfirmed by AzamPay
 * as of this writing (docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md). Calls will
 * throw a clear configuration error until AZAMPAY_DISBURSE_PUBLIC_KEY and
 * the AZAMPAY_CHECKSUM_FIELDS_* env vars are set — this is intentional, not
 * a bug, so nobody accidentally ships a request AzamPay will reject.
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
  const publicKey = requirePublicKey();

  const checksumInput = buildChecksumInput("NAMELOOKUP", input);
  const request: AzamPayNameLookupRequest = {
    ...input,
    checksum: azamPayChecksum(checksumInput, publicKey),
  };

  const { status, body } = await withAuthRetry((token) =>
    postJson("/api/v1/azampay/namelookup", request, token)
  );

  if (status < 200 || status >= 300 || !body?.status) {
    throw mapAzamPayError(status, body);
  }
  if (!isProviderSuccessCode(body.statusCode)) {
    invalidProviderResponse(status, body, "name lookup statusCode is missing or non-success");
  }

  return body as AzamPayNameLookupResponse;
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

  const checksumInput = buildChecksumInput("DISBURSE", request);
  const fullRequest: AzamPayDisburseRequest = {
    ...request,
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
