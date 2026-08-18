/**
 * AzamPay Disbursement — Request/Response Types
 *
 * Mirrors the OpenAPI schema and examples documented in
 * docs/AZAMPAY_DISBURSEMENT_DEV_GUIDE.md. bankName is typed as a union of
 * the values the schema currently enumerates (tigo/airtel/azampesa) — this
 * endpoint is MNO-focused until AzamPay confirms bank payout support.
 */

/** Confirmed-enabled MNO rails only. Do not widen until AzamPay confirms bank support. */
export type AzamPayDisburseBankName = "tigo" | "airtel" | "azampesa";

export interface AzamPayAccountParty {
  countryCode: string;
  fullName: string;
  /**
   * Provider token as it goes on the wire. The enabled rail is validated
   * upstream (config.ts -> AzamPayDisburseBankName), but the wire value is
   * AzamPay's own casing ("Azampesa", not "azampesa") — see
   * toAzamPayWireBankName in client.ts — so this is a plain string here.
   */
  bankName: string;
  accountNumber: string;
  currency: string;
}

export interface AzamPayTransferDetails {
  /** Valid values not yet confirmed by AzamPay — see docs "Questions" section. */
  type: string;
  amount: number;
  dateInEpoch: number;
}

export interface AzamPayDisburseRequest {
  source: AzamPayAccountParty;
  destination: AzamPayAccountParty;
  transferDetails: AzamPayTransferDetails;
  externalReferenceId: string; // max 30 chars, unique in NoLSAF before calling AzamPay
  checksum: string;
  additionalProperties?: Record<string, unknown>;
  remarks?: string;
}

export interface AzamPayDisburseResponse {
  pgReferenceId: string;
  message: string;
  success: boolean;
  statusCode: number;
}

export interface AzamPayNameLookupRequest {
  bankName: AzamPayDisburseBankName | string;
  accountNumber: string;
  /** Optional in the current AzamPay test environment; include when a field contract is configured. */
  checksum?: string;
}

export interface AzamPayNameLookupResponse {
  name: string;
  fname?: string;
  lname?: string;
  message?: string;
  status: boolean;
  statusCode: number;
  accountNumber: string;
  bankName: string;
}

export interface AzamPayDisburseCallback {
  initiatorReferenceId: string;
  fspReferenceId: string;
  pgReferenceId: string;
  amount: string;
  status: "success" | "failure" | string;
  message: string;
  operator: string;
  additionalProperties?: Record<string, unknown>;
}

export interface AzamPayTransactionStatusResponse {
  pgReferenceId: string;
  message: string;
  success: boolean;
  statusCode: number;
  /**
   * Some AzamPay environments may include a final transaction status even
   * though the public OpenAPI response currently omits it. Never infer a
   * completed payout from `success`; that field only says the status query
   * itself succeeded.
   */
  status?: string;
  amount?: string | number;
  fspReferenceId?: string;
  operator?: string;
  [key: string]: unknown;
}
