import { apiRequest } from "../lib/apiClient";
import {
  AuctionConfirmResponse,
  AuctionOffersResponse,
  CreateGroupBookingInput,
  CreateGroupBookingResult,
  DepositPaymentInitiateResult,
  GroupBookingDepositStatusResponse,
  GroupBookingDetailResponse,
  GroupBookingListResponse,
  GroupBookingMessagesResponse,
  SendGroupBookingMessageResponse
} from "./types";

export function createGroupBooking(token: string | null, input: CreateGroupBookingInput) {
  return apiRequest<CreateGroupBookingResult>("/api/group-bookings", {
    method: "POST",
    token,
    body: input
  });
}

/**
 * The customer's group stays. The list itself comes from /api/group-bookings
 * (the shape the screens are built on); the opaque gs_ references come from
 * /api/customer/group-stays, the same list the web uses, and are merged on so
 * every customer/group-stays/:id call can use the reference instead of the id.
 * If the reference list is unavailable the stays still load, by id.
 */
export async function fetchMyGroupBookings(token: string, params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  const [list, refs] = await Promise.all([
    apiRequest<GroupBookingListResponse>(`/api/group-bookings?${query.toString()}`, { token }),
    apiRequest<{ items?: Array<{ id: number; groupStayReference?: string | null }> }>(`/api/customer/group-stays?${query.toString()}`, { token }).catch(() => null)
  ]);
  const refById = new Map((refs?.items || []).filter((r) => r?.groupStayReference).map((r) => [Number(r.id), r.groupStayReference as string]));
  if (!refById.size || !Array.isArray(list?.data)) return list;
  return { ...list, data: list.data.map((item) => ({ ...item, groupStayReference: item.groupStayReference || refById.get(Number(item.id)) || null })) };
}

export function fetchGroupBookingById(token: string, id: number) {
  return apiRequest<GroupBookingDetailResponse>(`/api/group-bookings/${id}`, { token });
}

export function fetchGroupStayMessages(token: string, id: number | string) {
  return apiRequest<GroupBookingMessagesResponse>(`/api/customer/group-stays/${id}/messages`, { token });
}

export function sendGroupStayMessage(token: string, id: number | string, message: string, messageType = "Status update request") {
  return apiRequest<SendGroupBookingMessageResponse>(`/api/customer/group-stays/${id}/message`, {
    method: "POST",
    token,
    body: { message, messageType }
  });
}

export function fetchAuctionOffers(token: string, id: number | string) {
  return apiRequest<AuctionOffersResponse>(`/api/customer/group-stays/${id}/auction-offers`, { token });
}

export function confirmAuctionOffer(token: string, id: number | string, propertyId: number) {
  return apiRequest<AuctionConfirmResponse>(`/api/customer/group-stays/${id}/auction-confirm`, {
    method: "POST",
    token,
    body: { propertyId }
  });
}

export function fetchGroupBookingDepositStatus(token: string, id: number | string) {
  return apiRequest<GroupBookingDepositStatusResponse>(`/api/customer/group-stays/${id}/deposit-status`, { token });
}

export function initiateGroupBookingDepositMno(
  token: string,
  id: number | string,
  params: { phoneNumber: string; provider: "Airtel" | "Tigo" | "Mpesa" | "Halopesa" | "Azampesa" }
) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-mno`, {
    method: "POST",
    token,
    body: params
  });
}

export function initiateGroupBookingDepositBank(
  token: string,
  id: number | string,
  params: { bankCode: "CRDB" | "NMB"; accountNumber: string; merchantMobileNumber: string; otp: string }
) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-bank`, {
    method: "POST",
    token,
    body: params
  });
}

export function initiateGroupBookingDepositCard(token: string, id: number | string) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-card`, {
    method: "POST",
    token,
    // client:"app" keeps the post-payment redirect on nolsaf://group-stay-card-return
    // now that the same endpoint also serves the web deposit page.
    body: { client: "app" }
  });
}

export function fetchGroupBookingDepositReceiptToken(token: string, id: number | string) {
  return apiRequest<{ ok: boolean; token: string }>(`/api/customer/group-stays/${id}/deposit-receipt-token`, { token });
}
