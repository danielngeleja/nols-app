import { apiRequest } from "../lib/apiClient";
import { AccountOverview, AccountSession, LoginRecord, NotificationPreferences, NotificationPreferencesResponse } from "./types";

/** Same sources the web account hub counts from, so both surfaces show the same numbers. */
export async function fetchAccountOverview(token: string): Promise<AccountOverview> {
  const paths = [
    "/api/customer/bookings?page=1&pageSize=1&activeDraftsOnly=1",
    "/api/customer/rides?page=1&pageSize=1",
    "/api/customer/group-stays?page=1&pageSize=1",
    "/api/customer/tour-bookings?page=1&pageSize=1",
    "/api/customer/saved-properties?page=1&pageSize=1"
  ];
  const results = await Promise.allSettled(paths.map((path) => apiRequest<{ total?: number }>(path, { token })));
  const [stays, rides, groupStays, tours, saved] = results.map((r) =>
    r.status === "fulfilled" ? Number(r.value?.total) || 0 : null
  );
  return { stays, rides, groupStays, tours, saved };
}

/** Devices currently signed in to this account. */
export async function fetchAccountSessions(token: string) {
  const res = await apiRequest<{ data?: { sessions?: AccountSession[] }; sessions?: AccountSession[] }>("/api/account/sessions", { token });
  return res.data?.sessions || res.sessions || [];
}

export async function revokeAccountSession(token: string, sessionId: string) {
  return apiRequest<{ ok?: boolean }>("/api/account/sessions/revoke", { token, method: "POST", body: { sessionId } });
}

export async function revokeOtherAccountSessions(token: string) {
  return apiRequest<{ ok?: boolean }>("/api/account/sessions/revoke-others", { token, method: "POST", body: {} });
}

/** Recent sign-in and sign-out events for this account. */
export async function fetchLoginHistory(token: string) {
  const res = await apiRequest<{ records?: LoginRecord[]; items?: LoginRecord[] }>("/api/account/security/logins", { token });
  return res.records || res.items || [];
}

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
