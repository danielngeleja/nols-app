import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "../lib/apiClient";

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerPushDevice(authToken: string, isCurrent: () => boolean) {
  // The current EAS credentials provision Android. iOS requires APNs setup later.
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("updates", {
    name: "NoLSAF updates",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
  const existing = await Notifications.getPermissionsAsync();
  const status = existing.granted ? existing.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted" || !isCurrent()) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("EAS project ID is missing");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!isCurrent()) return;
  await apiRequest<{ ok: boolean }>("/api/customer/push-devices", {
    method: "POST", token: authToken, body: { token, platform: "android" },
  });
  registeredToken = token;
}

export async function unregisterPushDevice(authToken: string) {
  if (!registeredToken) return;
  await apiRequest<{ ok: boolean }>("/api/customer/push-devices", {
    method: "DELETE", token: authToken, body: { token: registeredToken },
  });
  registeredToken = null;
}

export function notificationIdFromResponse(response: Notifications.NotificationResponse): number | null {
  const value = Number(response.notification.request.content.data?.notificationId);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
