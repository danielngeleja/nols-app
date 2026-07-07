import { env } from "./env";

/** The NoLSAF web app's origin, derived from the configured API URL. */
export function webOrigin(): string {
  const raw = env.apiUrl.trim().replace(/\/+$/, "");
  if (!raw) return "http://localhost:3000";
  try {
    const url = new URL(raw);
    if (/^(localhost|127\.0\.0\.1|10\.0\.2\.2)$/i.test(url.hostname) && url.port === "4000") {
      url.port = "3000";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/api.*$/i, "");
  }
}
