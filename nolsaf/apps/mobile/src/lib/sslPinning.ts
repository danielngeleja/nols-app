import { Platform } from "react-native";

import { env } from "./env";

/**
 * Public-key (SPKI SHA-256) pins for the NoLSAF production API certificate
 * chain, issued by AWS Certificate Manager. Pinning makes the app reject any
 * TLS certificate whose chain does not present one of these keys, which stops
 * man-in-the-middle interception on hostile networks (rogue cafe/hotel Wi-Fi,
 * corporate proxies, malware-installed root CAs). This protects the AzamPesa and
 * bank OTP (CRDB / NMB) flows in particular.
 *
 * Three layers are pinned: tight security with zero-downtime certificate rotation.
 *   1. leaf          CN=api.nolsaf.com      tightest match, AWS rotates it ~yearly
 *   2. intermediate  Amazon RSA 2048 M01    survives leaf rotation (multi-year)
 *   3. root          Amazon Root CA 1       final availability backstop
 *
 * A connection is accepted if ANY pin in the chain matches, so AWS's automatic
 * leaf renewal cannot brick installed apps while the intermediate/root hold.
 *
 * ROTATION DUTY: before the leaf's notAfter (currently 2027-02-28) or whenever
 * AWS changes the intermediate, regenerate these pins and ship an app update
 * BEFORE the old certificate is retired, or installed apps lose connectivity.
 * Regenerate every pin in the live chain with:
 *
 *   echo | openssl s_client -connect api.nolsaf.com:443 \
 *       -servername api.nolsaf.com -showcerts 2>/dev/null \
 *     | awk '/BEGIN CERT/{c++} {print > "c"c".pem"}'
 *   for f in c*.pem; do openssl x509 -in "$f" -pubkey -noout \
 *     | openssl pkey -pubin -outform der \
 *     | openssl dgst -sha256 -binary | openssl enc -base64; done
 */
const PUBLIC_KEY_HASHES = [
  "J2KYV9NVCHnQiuriptQ95NznLPY2aAD7dmN1gG5RogE=", // leaf: CN=api.nolsaf.com
  "DxH4tt40L+eduF6szpY6TONlxhZhBd+pJ9wbHlQ2fuw=", // intermediate: Amazon RSA 2048 M01
  "++MBgDH5WGvL9Bcn5Be30cRcL0f5O+NyoXuWtQdX1aI=" // root: Amazon Root CA 1
];

function hostFrom(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Activates certificate pinning for every nolsaf.com host the app talks to
 * (API and, in production, the realtime socket, which share the same cert chain).
 *
 * Safe to call unconditionally. It intentionally no-ops when:
 *   - running on web (browser handles TLS),
 *   - the configured host is not a nolsaf.com host (local dev / staging use
 *     different certificates and must not be pinned or they would fail to connect),
 *   - the native pinning module is unavailable (e.g. Expo Go).
 *
 * Resolves once pinning is active or intentionally skipped. Callers MUST await it
 * before issuing the first network request so no traffic can escape unpinned.
 */
export async function initSslPinning(): Promise<void> {
  if (Platform.OS === "web") return;

  const hosts = new Set<string>();
  for (const candidate of [env.apiUrl, env.socketUrl]) {
    const host = hostFrom(candidate);
    // Only pin production nolsaf.com hosts; everything else keeps working unpinned.
    if (host.endsWith("nolsaf.com")) hosts.add(host);
  }
  if (hosts.size === 0) return;

  const pinnedHosts: Record<string, { includeSubdomains: boolean; publicKeyHashes: string[] }> = {};
  for (const host of hosts) {
    pinnedHosts[host] = { includeSubdomains: false, publicKeyHashes: PUBLIC_KEY_HASHES };
  }

  try {
    // Dynamically imported so the app still typechecks/runs before the native
    // package is installed, and so web/Expo-Go bundles never hard-require it.
    // @ts-ignore optional native dependency, resolved at build time
    const { initializeSslPinning } = await import("react-native-ssl-public-key-pinning");
    await initializeSslPinning(pinnedHosts);
  } catch (error) {
    // Native module missing (Expo Go) or init failure. Without the native layer
    // there is nothing to enforce, and we must never trap the user offline.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.warn("[sslPinning] pinning not activated:", error);
    }
  }
}
