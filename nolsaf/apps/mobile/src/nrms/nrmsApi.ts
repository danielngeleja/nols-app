import { apiRequest } from "../lib/apiClient";
import {
  NrmsActiveRoomOrdering,
  NrmsMenuData,
  NrmsPlaceOrderInput,
  NrmsPlaceOrderResponse,
  NrmsPublicOrder
} from "./types";

/**
 * Pulls the order-point token out of a `/menu/<token>` link.
 *
 * The API builds that link from WEB_ORIGIN, which is `http://localhost:3000` in
 * development and therefore unreachable from a physical device. The app only
 * ever wants the token, and calls the public API on its own resolved base.
 */
export function extractNrmsMenuToken(url: string | null | undefined): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  const match = raw.match(/\/menu\/([A-Za-z0-9_-]{16,48})(?:[/?#]|$)/);
  return match ? match[1] : null;
}
/** Live menu for a token. Public, no auth: the token is the capability. */
export async function fetchNrmsMenu(token: string) {
  return apiRequest<NrmsMenuData>(`/api/public/nrms/menu/${encodeURIComponent(token)}`);
}

/** Places a guest order. Rejected with 403 ORDERING_DISABLED on a preview token. */
export async function placeNrmsOrder(token: string, input: NrmsPlaceOrderInput) {
  return apiRequest<NrmsPlaceOrderResponse>(`/api/public/nrms/menu/${encodeURIComponent(token)}/orders`, {
    method: "POST",
    body: input
  });
}

/** Order status for the code returned at placement. Polled while the order is open. */
export async function fetchNrmsOrder(publicCode: string) {
  return apiRequest<{ order: NrmsPublicOrder }>(`/api/public/nrms/orders/${encodeURIComponent(publicCode)}`);
}

/**
 * The signed-in guest's ordering entitlement for their current stay, if any.
 *
 * Deliberately re-resolved on every screen open rather than cached: the server
 * returns a token only while the reservation is CHECKED_IN, so checkout takes
 * the cart away on its own. Any failure (including this endpoint not being
 * deployed yet) is treated as "no entitlement", which degrades to the
 * read-only preview rather than breaking the screen.
 */
export async function fetchNrmsActiveRoomOrdering(
  token: string,
  propertyId: number
): Promise<NrmsActiveRoomOrdering | null> {
  try {
    const response = await apiRequest<{ stay: NrmsActiveRoomOrdering | null }>(
      `/api/customer/nrms/room-ordering?propertyId=${encodeURIComponent(String(propertyId))}`,
      { token }
    );
    return response?.stay ?? null;
  } catch {
    return null;
  }
}
