import { apiRequest } from "../lib/apiClient";
import { ArrivalType, PickupCategory, PickupPoint } from "./tanzaniaLocations";
import { CreateTransportInput, CreateTransportResult, RideDetail, RideListResponse } from "./types";

type ApiPickupPoint = {
  id: string;
  label: string;
  shortLabel: string;
  city: string;
  lat: number;
  lng: number;
  category: PickupCategory;
  arrivalType: ArrivalType;
  iataCode?: string | null;
};

/** Admin-managed pickup points (airports, bus terminals, ferry ports). The
 *  coordinates here are the source of truth for driver pickup, maintained in
 *  the admin dashboard. Falls back to the bundled list at the call site. */
export async function fetchPickupPoints(): Promise<PickupPoint[]> {
  const res = await apiRequest<{ items: ApiPickupPoint[] }>("/api/public/pickup-points");
  return (res.items || [])
    .filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)))
    .map((p) => ({
      id: p.id,
      label: p.label,
      shortLabel: p.shortLabel,
      city: p.city,
      lat: Number(p.lat),
      lng: Number(p.lng),
      category: p.category,
      arrivalType: p.arrivalType,
      iataCode: p.iataCode || undefined
    }));
}

/**
 * Create a transport booking that brings the customer to a booked property.
 * Hits the authed transport-bookings endpoint; the server computes the fare
 * (client `amount` is never trusted) and returns a trip code + status.
 */
export async function createTransportBooking(token: string, input: CreateTransportInput) {
  return apiRequest<CreateTransportResult>("/api/transport-bookings", {
    method: "POST",
    token,
    body: input
  });
}

/** List the authenticated customer's rides (transport bookings). */
export async function fetchMyRides(token: string, params: { status?: string; page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  if (params.status) query.set("status", params.status);
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return apiRequest<RideListResponse>(`/api/customer/rides?${query.toString()}`, { token });
}

/** Full detail for one ride (trip data, route coordinates, and the assigned driver). */
export async function fetchRideDetail(token: string, id: number) {
  return apiRequest<RideDetail>(`/api/transport-bookings/${id}`, { token });
}
