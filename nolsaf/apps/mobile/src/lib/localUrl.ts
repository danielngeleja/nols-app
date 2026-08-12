import { NativeModules, Platform } from "react-native";

type SourceCodeModule = {
  scriptURL?: string;
};

function hostnameFrom(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname;
  } catch {
    return "";
  }
}

function isLoopback(hostname: string): boolean {
  return /^(localhost|127\.0\.0\.1|::1)$/i.test(hostname);
}

/**
 * Resolve the machine running Metro while developing on a native device.
 * A physical phone cannot reach the computer through localhost, while the
 * Android emulator uses 10.0.2.2 when Metro does not expose a LAN address.
 */
function nativeDevelopmentHost(): string {
  if (Platform.OS === "web") return "";

  const sourceCode = NativeModules.SourceCode as SourceCodeModule | undefined;
  const metroHost = hostnameFrom(sourceCode?.scriptURL);
  if (metroHost && !isLoopback(metroHost)) return metroHost;

  return Platform.OS === "android" ? "10.0.2.2" : "";
}

export function resolveLocalhostUrl(value: string): string {
  const configured = value.trim().replace(/\/+$/, "");
  if (!configured || Platform.OS === "web") return configured;

  try {
    const url = new URL(configured);
    if (!isLoopback(url.hostname)) return configured;

    const developmentHost = nativeDevelopmentHost();
    if (!developmentHost) return configured;
    url.hostname = developmentHost;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return configured;
  }
}
