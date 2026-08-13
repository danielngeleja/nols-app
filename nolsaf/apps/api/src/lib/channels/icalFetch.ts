// apps/api/src/lib/channels/icalFetch.ts
//
// Fetching a URL an owner typed in is a server-side request forgery primitive
// unless it is fenced off, so this module exists to be the only way an iCal
// feed is ever retrieved.
//
// The fence is applied at connect time, not before it. Validating the hostname
// and then handing the URL to fetch() leaves the gap between the two lookups
// open: DNS can answer publicly for the check and privately for the request.
// A custom `lookup` passed to the agent means Node connects to an address this
// module has already cleared, so there is no second resolution to poison.
//
// Redirects are followed by hand for the same reason. Each hop is a fresh URL
// that has to pass the same scheme, port and address rules as the first.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import ipaddr from "ipaddr.js";

export class IcalFetchError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "IcalFetchError";
    this.code = code;
  }
}

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
/** True for anything that could reach inside the deployment's own network. */
export function isBlockedAddress(address: string): boolean {
  try {
    // process() converts every IPv4-mapped spelling—including hexadecimal
    // forms such as ::ffff:a00:1—back to IPv4 before range classification.
    // Only globally routable unicast addresses are valid feed destinations;
    // this also rejects NAT64, 6to4, Teredo, documentation and reserved space.
    return ipaddr.process(address.trim()).range() !== "unicast";
  } catch {
    return true;
  }
}

/** Rejects the URL itself, before any packet is sent. */
export function assertFetchableFeedUrl(raw: string): URL {
  // webcal:// is how Airbnb and Apple hand out subscription links. It is http
  // semantics with a different label, so it is rewritten rather than bounced
  // back at an owner who pasted exactly what the provider gave them. The swap
  // happens on the string: URL refuses to reassign `protocol` between a
  // non-special scheme like webcal and a special one like https.
  const candidate = raw.trim().replace(/^webcal:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new IcalFetchError("INVALID_URL", "That is not a valid calendar address.");
  }
  if (url.username || url.password) {
    throw new IcalFetchError("CREDENTIALS_IN_URL", "Remove the username and password from the calendar address.");
  }
  // A bare IP literal skips DNS entirely, so it is checked here as well as in
  // the connect-time lookup.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if ((net.isIP(host) && isBlockedAddress(host)) || host === "localhost" || host.endsWith(".localhost")) {
    throw new IcalFetchError("BLOCKED_ADDRESS", "That calendar address points inside a private network.");
  }
  if (url.protocol !== "https:") {
    throw new IcalFetchError("UNSUPPORTED_SCHEME", "A calendar address must start with https.");
  }
  const port = url.port ? Number(url.port) : 443;
  if (port !== 443) {
    throw new IcalFetchError("BLOCKED_PORT", "A calendar address cannot use a custom port.");
  }
  return url;
}

/**
 * dns.lookup with every private answer stripped out. Node connects only to
 * what this hands back, which is what makes the check unbypassable rather
 * than advisory.
 */
const guardedLookup: NonNullable<http.RequestOptions["lookup"]> = ((hostname: string, options: any, callback: any) => {
  const done = typeof options === "function" ? options : callback;
  const opts = typeof options === "function" ? {} : options ?? {};
  dns.lookup(hostname, { ...opts, all: true }, (error, addresses) => {
    if (error) return done(error);
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as Array<{ address: string; family: number }>;
    const safe = list.filter((entry) => !isBlockedAddress(entry.address));
    if (!safe.length) {
      return done(new IcalFetchError("BLOCKED_ADDRESS", "That calendar address resolves to a private network."));
    }
    if (opts.all) return done(null, safe as any);
    return done(null, safe[0].address, safe[0].family);
  });
}) as NonNullable<http.RequestOptions["lookup"]>;

type RawResponse = { status: number; location: string | null; body: string };

function requestOnce(url: URL): Promise<RawResponse> {
  const transport = https;
  return new Promise<RawResponse>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "GET",
        lookup: guardedLookup,
        timeout: TIMEOUT_MS,
        headers: {
          // Some providers serve HTML to unknown agents and text/calendar to
          // anything that asks for it explicitly.
          Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
          "User-Agent": "NoLSAF-NRMS/1.0 (+https://nolsaf.com)",
          "Accept-Encoding": "identity",
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = typeof response.headers.location === "string" ? response.headers.location : null;
        if (location) {
          response.resume();
          return resolve({ status, location, body: "" });
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_BYTES) {
            request.destroy();
            reject(new IcalFetchError("FEED_TOO_LARGE", "That calendar is too large to import."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ status, location: null, body: Buffer.concat(chunks).toString("utf8") }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new IcalFetchError("TIMEOUT", "The calendar provider did not respond in time."));
    });
    request.on("error", (error) => {
      reject(error instanceof IcalFetchError ? error : new IcalFetchError("NETWORK_ERROR", String(error.message || error)));
    });
    request.end();
  });
}

/** The calendar body, or an IcalFetchError carrying a code worth showing an owner. */
export async function fetchIcalText(rawUrl: string): Promise<string> {
  let url = assertFetchableFeedUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await requestOnce(url);
    if (response.status >= 300 && response.status < 400 && response.location) {
      if (hop === MAX_REDIRECTS) throw new IcalFetchError("TOO_MANY_REDIRECTS", "That calendar address redirects too many times.");
      url = assertFetchableFeedUrl(new URL(response.location, url).toString());
      continue;
    }
    if (response.status === 401 || response.status === 403) {
      throw new IcalFetchError("FEED_FORBIDDEN", "The provider refused the calendar link. Generate a new one and paste it again.");
    }
    if (response.status === 404) {
      throw new IcalFetchError("FEED_NOT_FOUND", "That calendar link no longer exists on the provider's side.");
    }
    if (response.status < 200 || response.status >= 300) {
      throw new IcalFetchError("FEED_UNAVAILABLE", `The provider returned status ${response.status}.`);
    }
    if (!/BEGIN:VCALENDAR/i.test(response.body)) {
      throw new IcalFetchError("NOT_A_CALENDAR", "That address did not return a calendar. Copy the iCal export link, not the listing page.");
    }
    return response.body;
  }

  throw new IcalFetchError("TOO_MANY_REDIRECTS", "That calendar address redirects too many times.");
}
