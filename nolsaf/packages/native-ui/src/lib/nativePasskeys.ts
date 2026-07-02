import { Platform } from "react-native";

import { apiRequest } from "./apiClient";

type PasskeyBridge = {
  create: (options: unknown) => Promise<unknown>;
  get: (options: unknown) => Promise<unknown>;
};

export type NativePasskeyItem = {
  id: string;
  name?: string | null;
  createdAt?: string | null;
};

export type NativePasskeyLoginResponse<TUser = unknown> = {
  ok?: boolean;
  token?: string;
  user?: TUser;
  message?: string;
  error?: string;
};

export type NativePasskeyRegistrationResponse = {
  ok?: boolean;
  item?: NativePasskeyItem;
  message?: string;
  error?: string;
};

declare const require: ((moduleName: string) => unknown) | undefined;

function loadBridge(): PasskeyBridge {
  if (Platform.OS === "web") {
    throw new Error("Passkeys are available in the installed iOS or Android app. Use password or OTP on web.");
  }

  try {
    const mod = require?.("react-native-passkeys") as Partial<PasskeyBridge> | undefined;
    if (typeof mod?.create === "function" && typeof mod?.get === "function") {
      return { create: mod.create, get: mod.get };
    }
  } catch {
    // The dependency is added through app builds. Return the friendly message below when absent.
  }

  throw new Error("This app build does not include passkey support yet. Update the app, then try again.");
}

export function formatPasskeyError(error: unknown, fallback = "Passkey failed. Use password or OTP and try again later.") {
  const err = error as { name?: string; message?: string } | null | undefined;
  if (err?.name === "NotAllowedError") return "Passkey was cancelled or not approved on this device.";
  if (err?.name === "SecurityError") return "This app is not linked to the NoLSAF passkey domain yet.";
  if (err?.name === "InvalidStateError") return "A passkey for this account may already exist on this device.";
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return fallback;
}

export async function signInWithNativePasskey<TUser = unknown>() {
  const bridge = loadBridge();
  const options = await apiRequest<{ sessionId: string; publicKey: unknown }>("/api/auth/passkeys/options", {
    method: "POST",
    body: {}
  });
  const assertion = await bridge.get(options.publicKey);
  return apiRequest<NativePasskeyLoginResponse<TUser>>("/api/auth/passkeys/verify", {
    method: "POST",
    body: { sessionId: options.sessionId, response: assertion }
  });
}

export async function registerNativePasskey(apiBasePath: string, token: string, name = devicePasskeyName()) {
  const bridge = loadBridge();
  const options = await apiRequest<{ publicKey: unknown }>(apiBasePath, {
    method: "POST",
    token
  });
  const credential = await bridge.create(options.publicKey);
  return apiRequest<NativePasskeyRegistrationResponse>(`${apiBasePath}/verify`, {
    method: "POST",
    token,
    body: { ...(credential as object), name }
  });
}

export async function listNativePasskeys(apiBasePath: string, token: string) {
  return apiRequest<{ items?: NativePasskeyItem[] }>(apiBasePath, { token });
}

export async function deleteNativePasskey(apiBasePath: string, token: string, id: string) {
  return apiRequest<{ ok?: boolean }>(`${apiBasePath}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    token
  });
}

export function devicePasskeyName() {
  if (Platform.OS === "ios") return "iPhone or iPad";
  if (Platform.OS === "android") return "Android device";
  return "This device";
}
