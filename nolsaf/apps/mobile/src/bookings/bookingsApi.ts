import { apiRequest } from "../lib/apiClient";
import { BookingDetail, BookingListResponse } from "./types";

/** List the authenticated customer's bookings. `paidOnly` excludes unpaid
 *  drafts, used where only confirmed stays should appear (e.g. transport). */
export async function fetchMyBookings(
  token: string,
  params: { paidOnly?: boolean; page?: number; pageSize?: number } = {}
) {
  const query = new URLSearchParams();
  if (params.paidOnly) query.set("paidOnly", "1");
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return apiRequest<BookingListResponse>(`/api/customer/bookings?${query.toString()}`, { token });
}

/** Full booking detail, including the property's coordinates needed to price
 *  and create a transport booking to that property. */
export async function fetchBookingDetail(token: string, bookingId: number) {
  return apiRequest<BookingDetail>(`/api/customer/bookings/${bookingId}`, { token });
}
