import { apiRequest } from "../lib/apiClient";
import { NotificationListResponse } from "./types";

/** List the authenticated traveller's notifications. */
export async function fetchCustomerNotifications(token: string, params: { tab?: "unread" | "viewed"; page?: number; pageSize?: number } = {}) {
  const query = new URLSearchParams();
  query.set("tab", params.tab ?? "unread");
  query.set("page", String(params.page ?? 1));
  query.set("pageSize", String(params.pageSize ?? 20));
  return apiRequest<NotificationListResponse>(`/api/customer/notifications?${query.toString()}`, { token });
}

/** Mark one notification as read. */
export async function markCustomerNotificationRead(token: string, id: number | string) {
  return apiRequest<{ ok: boolean }>(`/api/customer/notifications/${id}/mark-read`, { token, method: "POST" });
}

/** Delete a single read notification. */
export async function deleteCustomerNotification(token: string, id: number | string) {
  return apiRequest<{ ok: boolean }>(`/api/customer/notifications/${id}`, { token, method: "DELETE" });
}

/** Delete all read notifications for the traveller. */
export async function deleteCustomerReadNotifications(token: string) {
  return apiRequest<{ ok: boolean; deleted?: number }>(`/api/customer/notifications/read`, { token, method: "DELETE" });
}
