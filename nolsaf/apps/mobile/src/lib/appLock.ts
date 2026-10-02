import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * App Lock: a device-side gate that requires the phone owner's biometric
 * (Face ID / fingerprint) or, as fallback, the device passcode before the
 * authenticated NoLSAF app can be viewed. It protects the session on a shared,
 * borrowed, or unlocked-and-lost phone. The biometric check is performed by the
 * operating system; NoLSAF never sees or stores the fingerprint/face, only a
 * yes/no result. This is independent of the NoLSAF account password.
 */

const ENABLED_KEY = "nolsaf.mobile.appLock.enabled";

function webStorage() {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  return window.localStorage;
}

export async function isAppLockEnabled(): Promise<boolean> {
  const storage = webStorage();
  if (storage) return storage.getItem(ENABLED_KEY) === "1";
  const value = await SecureStore.getItemAsync(ENABLED_KEY);
  return value === "1";
}

export async function setAppLockEnabledFlag(enabled: boolean): Promise<void> {
  const storage = webStorage();
  if (storage) {
    if (enabled) storage.setItem(ENABLED_KEY, "1");
    else storage.removeItem(ENABLED_KEY);
    return;
  }
  if (enabled) {
    await SecureStore.setItemAsync(ENABLED_KEY, "1", {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
  } else {
    await SecureStore.deleteItemAsync(ENABLED_KEY);
  }
}

/** Which biometric the phone offers, so the UI can name it. */
export type BiometricKind = "face" | "fingerprint" | "iris" | null;

export type LockCapability = {
  /** The device can gate at all: enrolled biometric OR a device passcode. */
  supported: boolean;
  /** A biometric (fingerprint / face) is specifically available. */
  biometric: boolean;
  kind: BiometricKind;
};

export async function getLockCapability(): Promise<LockCapability> {
  if (Platform.OS === "web") return { supported: false, biometric: false, kind: null };
  try {
    const [hasHardware, isEnrolled, level, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync()
    ]);
    const biometric = Boolean(hasHardware && isEnrolled);
    // A device passcode alone (SECRET) is enough to lock, even without biometrics.
    const hasSecret = level !== LocalAuthentication.SecurityLevel.NONE;
    const T = LocalAuthentication.AuthenticationType;
    const kind: BiometricKind = !biometric
      ? null
      : types.includes(T.FACIAL_RECOGNITION)
        ? "face"
        : types.includes(T.FINGERPRINT)
          ? "fingerprint"
          : types.includes(T.IRIS)
            ? "iris"
            : "fingerprint";
    return { supported: biometric || hasSecret, biometric, kind };
  } catch {
    return { supported: false, biometric: false, kind: null };
  }
}

/**
 * Outcome of one unlock attempt, so the lock screen can say the right thing:
 * a cancel is not an error, and a lockout means "use the phone passcode".
 */
export type LockAttempt = "ok" | "cancelled" | "lockout" | "failed";

/**
 * Prompts the OS biometric/passcode sheet. Device-passcode fallback stays
 * enabled so users without biometrics are never locked out of their own account.
 */
export async function attemptLock(reason: string): Promise<LockAttempt> {
  if (Platform.OS === "web") return "ok";
  try {
    // The passcode lives inside the system prompt (expo-local-authentication has
    // no passcode-only mode): Android shows its own "Use PIN" button, iOS offers
    // the passcode after a missed Face ID / Touch ID. The prompt says so.
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      promptDescription: "You can also use your phone PIN, pattern or password.",
      cancelLabel: "Cancel",
      fallbackLabel: "Use passcode",
      disableDeviceFallback: false
    });
    if (result.success) return "ok";
    const error = String(result.error || "");
    if (error === "user_cancel" || error === "system_cancel" || error === "app_cancel" || error === "user_fallback") return "cancelled";
    if (error === "lockout" || error === "lockout_permanent") return "lockout";
    return "failed";
  } catch {
    return "failed";
  }
}

/** Yes/no form of attemptLock, for confirm-to-change-a-setting checks. */
export async function authenticateLock(reason: string): Promise<boolean> {
  return (await attemptLock(reason)) === "ok";
}
