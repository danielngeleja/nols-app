import { useEffect } from "react";
import { Platform } from "react-native";
import { allowScreenCaptureAsync, preventScreenCaptureAsync } from "expo-screen-capture";

/**
 * Marks the current screen as sensitive so its contents cannot be captured.
 *
 * Android: sets FLAG_SECURE, which blocks screenshots and screen recordings and
 * blanks the app-switcher preview. iOS: blanks the screen while a screen
 * recording is in progress (Apple does not allow blocking still screenshots).
 *
 * Protection is enabled while the screen is mounted and released automatically
 * when it unmounts, so it never leaks onto other screens. A unique key per mount
 * keeps overlapping sensitive screens from re-enabling capture for one another.
 * No-ops on web.
 *
 * Use only on screens that show OTP codes, bank account numbers, or payment
 * details. Do not blanket the whole app: ordinary screens should stay
 * screenshot-friendly so travellers can share a stay with a friend.
 */
let mountCounter = 0;

export function useSecureScreen(): void {
  useEffect(() => {
    if (Platform.OS === "web") return;
    const key = `nolsaf-secure-${mountCounter++}`;
    void preventScreenCaptureAsync(key).catch(() => {});
    return () => {
      void allowScreenCaptureAsync(key).catch(() => {});
    };
  }, []);
}
