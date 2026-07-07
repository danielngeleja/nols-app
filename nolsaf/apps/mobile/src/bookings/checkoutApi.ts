import { apiRequest } from "../lib/apiClient";
import {
  CreateBookingInput,
  CreateBookingResult,
  InvoiceData,
  InvoiceFromBookingResult,
  MnoProvider,
  PaymentInitiateResult
} from "./types";

/** System default commission percent, used when a property has no override.
 *  Fails soft to 0 so checkout still works if the setting can't be read. */
export async function fetchSystemCommission(): Promise<number> {
  try {
    const res = await apiRequest<{ commissionPercent?: number }>(
      `/api/public/support/system-settings`
    );
    const n = Number(res?.commissionPercent);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/** Create the booking. Pass the auth token so the booking is linked to the
 *  signed-in customer (the endpoint uses optional auth). The server computes
 *  the authoritative total; client-sent fares are only hints. */
export async function createBooking(token: string | null, input: CreateBookingInput) {
  return apiRequest<CreateBookingResult>(`/api/public/bookings`, {
    method: "POST",
    token,
    body: input
  });
}

/** Turn a freshly created booking into a payable invoice. Gated by the
 *  proof-of-creation token, not auth, so it needs no Authorization header. */
export async function createInvoiceFromBooking(bookingId: number, bookingAccessToken: string) {
  return apiRequest<InvoiceFromBookingResult>(`/api/public/invoices/from-booking`, {
    method: "POST",
    body: { bookingId, bookingAccessToken }
  });
}

/** Read the invoice (price breakdown, draft availability re-check, status).
 *  Also used as the payment status poll: poll until status === "PAID". */
export async function fetchInvoice(invoiceId: number, accessToken: string) {
  const query = new URLSearchParams({ accessToken });
  return apiRequest<InvoiceData>(`/api/public/invoices/${invoiceId}?${query.toString()}`);
}

/** Start an AzamPay mobile money (USSD push) charge. The handset is the
 *  payment surface; there is no redirect, so the caller polls the invoice. */
export async function initiateMnoPayment(
  token: string | null,
  params: { invoiceId: number; phoneNumber: string; provider: MnoProvider; accessToken: string }
) {
  return apiRequest<PaymentInitiateResult>(`/api/payments/azampay/initiate`, {
    method: "POST",
    token,
    body: {
      invoiceId: params.invoiceId,
      phoneNumber: params.phoneNumber,
      provider: params.provider,
      accessToken: params.accessToken
    }
  });
}

/** Start a card charge. Returns a hosted checkout URL the app opens in an
 *  in-app browser; the provider callback marks the invoice paid, so the caller
 *  polls the invoice after the browser returns. */
export async function initiateCardPayment(
  token: string | null,
  params: { invoiceId: number; accessToken: string }
) {
  return apiRequest<PaymentInitiateResult & { checkoutUrl?: string }>(`/api/payments/coralcommerce/card/initiate`, {
    method: "POST",
    token,
    body: { invoiceId: params.invoiceId, accessToken: params.accessToken }
  });
}

/** Start a bank checkout charge. CRDB/NMB require an OTP generated from SIM
 *  banking before we submit the checkout request. */
export async function initiateBankPayment(
  token: string | null,
  params: {
    invoiceId: number;
    bankCode: string;
    accountNumber: string;
    merchantMobileNumber: string;
    otp: string;
    accessToken: string;
  }
) {
  return apiRequest<PaymentInitiateResult>(`/api/payments/azampay/bank/initiate`, {
    method: "POST",
    token,
    body: {
      invoiceId: params.invoiceId,
      bankCode: params.bankCode,
      accountNumber: params.accountNumber,
      merchantMobileNumber: params.merchantMobileNumber,
      otp: params.otp,
      accessToken: params.accessToken
    }
  });
}
