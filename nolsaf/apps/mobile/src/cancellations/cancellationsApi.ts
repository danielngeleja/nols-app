import { apiRequest } from "../lib/apiClient";

/** Refund policy outcome for a booking, computed server-side from the booking
 *  timing and code status. Mirrors the web cancellation flow. */
export type CancellationEligibility = {
  eligible: boolean;
  reason?: string;
  /** 0, 50 or 100 when eligible. */
  refundPercent?: number;
  rule?: "FREE_24H_72H" | "PARTIAL_50_96H" | "NON_REFUNDABLE" | "AFTER_CHECKIN" | "NOT_ELIGIBLE";
  nextStep?: "PLATFORM" | "EMAIL";
};

export type CancellationRequestStatus =
  | "SUBMITTED"
  | "REVIEWING"
  | "NEED_INFO"
  | "PROCESSING"
  | "REFUNDED"
  | "REJECTED";

export type CancellationBookingSummary = {
  id: number;
  status: string;
  createdAt: string;
  checkIn: string;
  checkOut: string;
  totalAmount: number;
  bookingCode: string;
  codeStatus: string;
  property: {
    id: number;
    title: string;
    type: string;
    regionName?: string | null;
    district?: string | null;
    city?: string | null;
    country?: string | null;
  };
};

export type CancellationLookup = {
  booking: CancellationBookingSummary;
  eligibility: CancellationEligibility;
  existingRequest: { id: number; status: CancellationRequestStatus; createdAt: string } | null;
};

export type CancellationListItem = {
  id: number;
  status: CancellationRequestStatus;
  bookingId: number;
  bookingCode: string;
  reason: string | null;
  policyEligible: boolean | null;
  policyRefundPercent: number | null;
  policyRule: string | null;
  createdAt: string;
  updatedAt: string;
  booking?: {
    checkIn: string;
    checkOut: string;
    status: string;
    property?: { title?: string | null; regionName?: string | null; city?: string | null; district?: string | null } | null;
  } | null;
};

export type CancellationMessage = {
  id: number;
  senderId: number;
  senderRole: "USER" | "ADMIN" | string;
  body: string;
  createdAt: string;
};

export type CancellationDetail = CancellationListItem & {
  decisionNote?: string | null;
  booking?:
    | (CancellationListItem["booking"] & { totalAmount?: number | null })
    | null;
  messages: CancellationMessage[];
};

function encodeCode(code: string): string {
  return encodeURIComponent(code.trim().toUpperCase().replace(/\s+/g, ""));
}

/** Validate a booking code and fetch its cancellation eligibility. The code
 *  must belong to the signed-in user (enforced server-side). */
export async function lookupCancellation(token: string, code: string) {
  return apiRequest<CancellationLookup>(`/api/customer/cancellations/lookup?code=${encodeCode(code)}`, { token });
}

/** Submit a cancellation request for review. The server re-checks eligibility
 *  and rejects with a structured 400 (payload.contactEmail) when not eligible. */
export async function requestCancellation(
  token: string,
  input: { code: string; reason: string; confirmPolicy: boolean }
) {
  return apiRequest<{
    request: {
      id: number;
      status: CancellationRequestStatus;
      createdAt: string;
      policyEligible: boolean;
      policyRefundPercent: number | null;
      policyRule: string | null;
    };
    eligibility: CancellationEligibility;
    message: string;
  }>(`/api/customer/cancellations/request`, {
    method: "POST",
    token,
    body: input
  });
}

/** List the signed-in customer's cancellation requests, newest first. */
export async function fetchCancellations(token: string) {
  return apiRequest<{ items: CancellationListItem[] }>(`/api/customer/cancellations`, { token });
}

/** A single cancellation request with its message thread. */
export async function fetchCancellation(token: string, id: number) {
  return apiRequest<{ item: CancellationDetail }>(`/api/customer/cancellations/${id}`, { token });
}

/** Post a message into a cancellation request thread. */
export async function sendCancellationMessage(token: string, id: number, body: string) {
  return apiRequest<{ message: CancellationMessage }>(`/api/customer/cancellations/${id}/messages`, {
    method: "POST",
    token,
    body: { body }
  });
}

/** Display metadata (label + colors) for a cancellation request status. */
export function cancellationStatusMeta(status: string): { label: string; color: string; tint: string } {
  switch (String(status || "").toUpperCase()) {
    case "REFUNDED":
      return { label: "Refunded", color: "#047857", tint: "#e9f7ef" };
    case "REJECTED":
      return { label: "Rejected", color: "#b91c1c", tint: "#fdecec" };
    case "REVIEWING":
      return { label: "Reviewing", color: "#b45309", tint: "#fff8e6" };
    case "NEED_INFO":
      return { label: "Needs info", color: "#c2410c", tint: "#fff1e8" };
    case "PROCESSING":
      return { label: "Processing", color: "#4338ca", tint: "#eef0ff" };
    case "SUBMITTED":
    default:
      return { label: "Submitted", color: "#1d4ed8", tint: "#eaf1ff" };
  }
}

/** Plain-language summary of the refund outcome for an eligible booking. */
export function refundOutcomeLabel(refundPercent?: number | null): string {
  if (refundPercent === 100) return "Free cancellation (100% refund)";
  if (refundPercent === 50) return "50% refund";
  return "Policy-based review";
}

export const CANCELLATION_EMAIL = "cancellation@nolsaf.com";
