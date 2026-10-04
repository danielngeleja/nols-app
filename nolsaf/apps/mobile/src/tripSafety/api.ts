import { apiRequest } from "../lib/apiClient";

export type TripServiceKind = "STAY" | "TOUR" | "GROUP_STAY" | "RIDE";

export type SafetyTrip = {
  serviceKind: TripServiceKind;
  serviceId: number;
  title: string;
  destination?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  status: string;
  provider: { name?: string | null; phone?: string | null; email?: string | null };
  activeShare?: { token: string; url: string; expiresAt: string } | null;
};

export type TripSafetyResponse = {
  support: { name: string; phone?: string | null; email?: string | null };
  emergencyContacts: Array<{ country: string; label: string; phone: string }>;
  trips: SafetyTrip[];
};

export function fetchTripSafety(token: string) {
  return apiRequest<TripSafetyResponse>("/api/customer/trip-safety", { token });
}

export function createTripShare(token: string, trip: Pick<SafetyTrip, "serviceKind" | "serviceId">) {
  return apiRequest<{ ok: boolean; reused?: boolean; token: string; url: string; expiresAt: string }>("/api/customer/trip-safety/shares", {
    token,
    method: "POST",
    body: trip,
  });
}

export function revokeTripShare(token: string, shareToken: string) {
  return apiRequest<{ ok: boolean }>(`/api/customer/trip-safety/shares/${encodeURIComponent(shareToken)}`, { token, method: "DELETE" });
}
