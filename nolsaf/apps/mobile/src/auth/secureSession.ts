import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const TOKEN_KEY = "nolsaf.mobile.authToken";

function getWebStorage() {
  if (Platform.OS !== "web" || typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

export async function getStoredToken() {
  const storage = getWebStorage();
  if (storage) {
    return storage.getItem(TOKEN_KEY);
  }
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function storeToken(token: string) {
  const storage = getWebStorage();
  if (storage) {
    storage.setItem(TOKEN_KEY, token);
    return;
  }

  await SecureStore.setItemAsync(TOKEN_KEY, token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
  });
}

export async function clearStoredToken() {
  const storage = getWebStorage();
  if (storage) {
    storage.removeItem(TOKEN_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
