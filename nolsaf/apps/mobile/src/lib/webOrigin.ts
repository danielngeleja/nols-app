import { env } from "./env";
import { resolveLocalhostUrl } from "./localUrl";

/** The NoLSAF web app's origin, derived from the configured API URL. */
export function webOrigin(): string {
  const configuredWebOrigin = resolveLocalhostUrl(env.webUrl);
  if (configuredWebOrigin) return configuredWebOrigin;

  const raw = resolveLocalhostUrl(env.apiUrl);
  if (!raw) return "http://localhost:3000";
  try {
    const url = new URL(raw);
    if (url.port === "4000") {
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
