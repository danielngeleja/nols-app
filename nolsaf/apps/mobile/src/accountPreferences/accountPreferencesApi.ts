import { apiRequest } from "../lib/apiClient";
import { NotificationPreferences, NotificationPreferencesResponse } from "./types";

/** The authenticated user's notification preferences (bookings, promotions, referrals). */
export async function fetchNotificationPreferences(token: string) {
  const res = await apiRequest<NotificationPreferencesResponse>("/api/account/notification-preferences", { token });
  return res.data.preferences;
}

/** Updates one or more notification preference categories for the authenticated user. */
export async function updateNotificationPreferences(token: string, changes: Partial<NotificationPreferences>) {
  const res = await apiRequest<NotificationPreferencesResponse>("/api/account/notification-preferences", {
    token,
    method: "PUT",
    body: changes
  });
  return res.data.preferences;
}

/** Permanently deletes the authenticated user's account. */
export async function deleteMyAccount(token: string) {
  return apiRequest<{ ok: boolean }>("/api/account/", { token, method: "DELETE" });
}
