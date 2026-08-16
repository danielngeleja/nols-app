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

export type LockCapability = {
  /** The device can gate at all: enrolled biometric OR a device passcode. */
  supported: boolean;
  /** A biometric (fingerprint / face) is specifically available. */
  biometric: boolean;
};

export async function getLockCapability(): Promise<LockCapability> {
  if (Platform.OS === "web") return { supported: false, biometric: false };
  try {
    const [hasHardware, isEnrolled, level] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.getEnrolledLevelAsync()
    ]);
    const biometric = Boolean(hasHardware && isEnrolled);
    // A device passcode alone (SECRET) is enough to lock, even without biometrics.
    const hasSecret = level !== LocalAuthentication.SecurityLevel.NONE;
    return { supported: biometric || hasSecret, biometric };
  } catch {
    return { supported: false, biometric: false };
  }
}

/**
 * Prompts the OS biometric/passcode sheet. Returns true only on a successful
 * check. Device-passcode fallback stays enabled so users without biometrics are
 * never locked out of their own account.
 */
export async function authenticateLock(reason: string): Promise<boolean> {
  if (Platform.OS === "web") return true;
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      cancelLabel: "Cancel",
      fallbackLabel: "Use device passcode",
      disableDeviceFallback: false
    });
    return result.success;
  } catch {
    return false;
  }
}
