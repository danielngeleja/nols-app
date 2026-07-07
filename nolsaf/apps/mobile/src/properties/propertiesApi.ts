import { apiRequest } from "../lib/apiClient";
import { PropertyListResponse, PropertySearchParams, PublicHomeSummary, PublicPropertyDetail, SavedPropertyListResponse } from "./types";

export async function fetchPublicProperties(params: PropertySearchParams = {}) {
  const query = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value == null || value === "") return;
    query.set(key, String(value));
  });

  const qs = query.toString();
  return apiRequest<PropertyListResponse>(`/api/public/properties${qs ? `?${qs}` : ""}`);
}

export type PropertyReview = {
  id: number;
  rating: number;
  title: string | null;
  comment: string | null;
  categoryRatings: Record<string, number> | null;
  isVerified: boolean;
  ownerResponse: string | null;
  ownerResponseAt: string | null;
  createdAt: string;
  user: { id: number; name: string | null } | null;
};

export type PropertyReviewsResponse = {
  reviews: PropertyReview[];
  stats: {
    totalReviews: number;
    averageRating: number;
    ratingDistribution: Record<string, number>;
    categoryAverages: Record<string, number> | null;
  };
};

export async function fetchPropertyReviews(propertyId: number) {
  return apiRequest<PropertyReviewsResponse>(`/api/property-reviews/${propertyId}`);
}

export type CreateReviewInput = {
  propertyId: number;
  rating: number;
  title?: string;
  comment?: string;
  categoryRatings?: Record<string, number>;
  bookingId?: number;
};

export async function createPropertyReview(token: string, input: CreateReviewInput) {
  return apiRequest<PropertyReview>("/api/property-reviews", { method: "POST", token, body: input });
}

export async function fetchPropertyDetail(idOrSlug: string | number) {
  // The endpoint wraps the detail as { property: {...} }.
  const response = await apiRequest<{ property: PublicPropertyDetail }>(`/api/public/properties/${idOrSlug}`);
  return response.property;
}

export async function fetchPublicPropertiesHomeSummary() {
  return apiRequest<PublicHomeSummary>("/api/public/properties/home-summary");
}

export type AvailabilityResponse = {
  date: string;
  items: Array<{ id: number; roomsAvailable: number | null; totalRooms: number | null }>;
};

/** Rooms available on a chosen day for the given property ids. */
export async function fetchPropertiesAvailability(ids: number[], date: string) {
  const query = new URLSearchParams({ ids: ids.join(","), date });
  return apiRequest<AvailabilityResponse>(`/api/public/properties/availability?${query.toString()}`);
}

/** Rooms available for a check in to check out range for one property, optionally
 *  narrowed to a single room type. */
export async function fetchAvailabilityRange(id: number, checkIn: string, checkOut: string, roomType?: string) {
  const query = new URLSearchParams({ ids: String(id), checkIn, checkOut });
  if (roomType) query.set("roomType", roomType);
  return apiRequest<AvailabilityResponse>(`/api/public/properties/availability?${query.toString()}`);
}

/** List the authenticated traveller's saved properties. */
export async function fetchSavedProperties(token: string, params: { page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 50));
  return apiRequest<SavedPropertyListResponse>(`/api/customer/saved-properties?${query.toString()}`, { token });
}

/** Save a property to favorites. */
export async function saveProperty(token: string, propertyId: number) {
  return apiRequest<{ ok: boolean; data?: { id: number; slug: string; title: string; savedAt: string } }>(
    "/api/customer/saved-properties",
    { token, method: "POST", body: { propertyId } }
  );
}

/** Remove a property from the saved list. */
export async function unsaveProperty(token: string, propertyId: number) {
  return apiRequest<{ ok: boolean; message?: string }>(`/api/customer/saved-properties/${propertyId}`, { token, method: "DELETE" });
}
