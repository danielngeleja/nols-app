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

export function fetchMyGroupBookings(token: string, params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return apiRequest<GroupBookingListResponse>(`/api/group-bookings?${query.toString()}`, { token });
}

export function fetchGroupBookingById(token: string, id: number) {
  return apiRequest<GroupBookingDetailResponse>(`/api/group-bookings/${id}`, { token });
}

export function fetchGroupStayMessages(token: string, id: number) {
  return apiRequest<GroupBookingMessagesResponse>(`/api/customer/group-stays/${id}/messages`, { token });
}

export function sendGroupStayMessage(token: string, id: number, message: string, messageType = "Status update request") {
  return apiRequest<SendGroupBookingMessageResponse>(`/api/customer/group-stays/${id}/message`, {
    method: "POST",
    token,
    body: { message, messageType }
  });
}

export function fetchAuctionOffers(token: string, id: number) {
  return apiRequest<AuctionOffersResponse>(`/api/customer/group-stays/${id}/auction-offers`, { token });
}

export function confirmAuctionOffer(token: string, id: number, propertyId: number) {
  return apiRequest<AuctionConfirmResponse>(`/api/customer/group-stays/${id}/auction-confirm`, {
    method: "POST",
    token,
    body: { propertyId }
  });
}

export function fetchGroupBookingDepositStatus(token: string, id: number) {
  return apiRequest<GroupBookingDepositStatusResponse>(`/api/customer/group-stays/${id}/deposit-status`, { token });
}

export function initiateGroupBookingDepositMno(
  token: string,
  id: number,
  params: { phoneNumber: string; provider: "Airtel" | "Tigo" | "Mpesa" | "Halopesa" }
) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-mno`, {
    method: "POST",
    token,
    body: params
  });
}

export function initiateGroupBookingDepositBank(
  token: string,
  id: number,
  params: { bankCode: "CRDB" | "NMB"; accountNumber: string; merchantMobileNumber: string; otp: string }
) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-bank`, {
    method: "POST",
    token,
    body: params
  });
}

export function initiateGroupBookingDepositCard(token: string, id: number) {
  return apiRequest<DepositPaymentInitiateResult>(`/api/customer/group-stays/${id}/deposit/initiate-card`, {
    method: "POST",
    token,
    body: {}
  });
}

export function fetchGroupBookingDepositReceiptToken(token: string, id: number) {
  return apiRequest<{ ok: boolean; token: string }>(`/api/customer/group-stays/${id}/deposit-receipt-token`, { token });
}
