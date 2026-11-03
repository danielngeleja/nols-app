import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { apiRequest } from "./apiClient";

let registeredToken: string | null = null;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerDriverPushDevice(authToken: string, isCurrent: () => boolean) {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("updates", {
      name: "Trip offers and updates",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
    });
  }
  const current = await Notifications.getPermissionsAsync();
  const permission = current.granted ? current : await Notifications.requestPermissionsAsync();
  if (!permission.granted || !isCurrent()) return;
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new Error("Driver EAS project ID is not configured");
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  if (!isCurrent()) return;
  await apiRequest<{ ok: boolean }>("/api/driver/push-devices", {
    method: "POST",
    token: authToken,
    body: { token, platform: Platform.OS },
  });
  registeredToken = token;
}

export async function unregisterDriverPushDevice(authToken: string) {
  const token = registeredToken;
  if (!token) return;
  await apiRequest<{ ok: boolean }>("/api/driver/push-devices", {
    method: "DELETE",
    token: authToken,
    body: { token },
  });
  registeredToken = null;
}
