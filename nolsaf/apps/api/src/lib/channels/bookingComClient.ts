const DEFAULT_BOOKING_AUTH_URL = "https://connectivity-authentication.booking.com";
const DEFAULT_BOOKING_SUPPLY_URL = "https://supply-xml.booking.com";
const DEFAULT_BOOKING_SECURE_SUPPLY_URL = "https://secure-supply-xml.booking.com";
const DEFAULT_TIMEOUT_MS = 300_000;
const MAX_ERROR_BODY_CHARS = 4_000;

export type BookingComCredentials = {
  clientId: string;
  clientSecret: string;
};

export type BookingComToken = {
  jwt: string;
  ruid?: string;
};

export type BookingComRequestOptions = {
  path: string;
  method?: "GET" | "POST" | "PUT" | "PATCH";
  body?: string | Record<string, unknown>;
  secure?: boolean;
  contentType?: "application/json" | "application/xml" | "application/x-www-form-urlencoded";
  timeoutMs?: number;
  headers?: Record<string, string>;
};

export type BookingComClientConfig = {
  authUrl?: string;
  supplyUrl?: string;
  secureSupplyUrl?: string;
  target?: "Production" | "Test";
};

export class BookingComApiError extends Error {
  readonly status: number;
  readonly providerCode?: string;
  readonly requestId?: string;

  constructor(message: string, options: { status: number; providerCode?: string; requestId?: string }) {
    super(message);
    this.name = "BookingComApiError";
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.requestId = options.requestId;
  }
}

function boundedTimeout(timeoutMs: number | undefined): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(Math.floor(timeoutMs as number), DEFAULT_TIMEOUT_MS));
}

function parseProviderError(raw: string): { code?: string; message?: string } {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        code: typeof parsed.code === "string" ? parsed.code : typeof parsed.status === "string" ? parsed.status : undefined,
        message: typeof parsed.message === "string" ? parsed.message : typeof parsed.error === "string" ? parsed.error : undefined,
      };
    } catch {
      // Continue with the deliberately small XML/text parser below.
    }
  }
  const code = raw.match(/(?:code|status)[^A-Za-z0-9]+([A-Z0-9_-]+)/i)?.[1];
  const message = raw.match(/(?:message|string|ShortText)[^>:=]+[>:=]\s*["']?([^"'<\n]+)["']?/i)?.[1]?.trim();
  return { code, message };
}

async function readResponseBody(response: Response): Promise<string> {
  const body = await response.text();
  // Successful reservation responses must remain complete for XML parsing.
  // Only provider error diagnostics are bounded before they can reach logs or
  // application error records.
  return response.ok ? body : body.slice(0, MAX_ERROR_BODY_CHARS);
}

function baseUrl(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export class BookingComClient {
  private readonly authUrl: string;
  private readonly supplyUrl: string;
  private readonly secureSupplyUrl: string;
  private readonly target: "Production" | "Test";

  constructor(private readonly fetchImpl: typeof fetch = fetch, config: BookingComClientConfig = {}) {
    this.authUrl = baseUrl(config.authUrl ?? process.env.BOOKING_COM_AUTH_URL ?? DEFAULT_BOOKING_AUTH_URL);
    this.supplyUrl = baseUrl(config.supplyUrl ?? process.env.BOOKING_COM_SUPPLY_URL ?? DEFAULT_BOOKING_SUPPLY_URL);
    this.secureSupplyUrl = baseUrl(config.secureSupplyUrl ?? process.env.BOOKING_COM_SECURE_SUPPLY_URL ?? DEFAULT_BOOKING_SECURE_SUPPLY_URL);
    this.target = config.target ?? (process.env.BOOKING_COM_TARGET === "Test" ? "Test" : "Production");
  }

  async exchangeToken(credentials: BookingComCredentials, timeoutMs = 30_000): Promise<BookingComToken> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
    try {
      const response = await this.fetchImpl(`${this.authUrl}/token-based-authentication/exchange`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ client_id: credentials.clientId, client_secret: credentials.clientSecret }),
        signal: controller.signal,
      });
      const raw = await readResponseBody(response);
      if (!response.ok) {
        const providerError = parseProviderError(raw);
        throw new BookingComApiError(providerError.message || "Booking.com token exchange failed", {
          status: response.status,
          providerCode: providerError.code,
          requestId: response.headers.get("ruid") ?? undefined,
        });
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new BookingComApiError("Booking.com returned an invalid token response", { status: 502 });
      }
      const token = parsed && typeof parsed === "object" && typeof (parsed as { jwt?: unknown }).jwt === "string"
        ? (parsed as { jwt: string; ruid?: unknown })
        : null;
      if (!token || !token.jwt.trim()) {
        throw new BookingComApiError("Booking.com returned no access token", { status: 502 });
      }
      return { jwt: token.jwt, ruid: typeof token.ruid === "string" ? token.ruid : undefined };
    } catch (error) {
      if (error instanceof BookingComApiError) throw error;
      if ((error as { name?: string })?.name === "AbortError") {
        throw new BookingComApiError("Booking.com token exchange timed out", { status: 504 });
      }
      throw new BookingComApiError("Booking.com token exchange could not be completed", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async request(token: string, options: BookingComRequestOptions): Promise<{ status: number; body: string; requestId?: string }> {
    if (!token.trim()) throw new Error("Booking.com access token is required");
    const path = options.path.startsWith("/") ? options.path : `/${options.path}`;
    const requestBaseUrl = options.secure ? this.secureSupplyUrl : this.supplyUrl;
    const contentType = options.contentType ?? (typeof options.body === "object" ? "application/json" : "application/xml");
    const body = options.body == null
      ? undefined
      : typeof options.body === "string"
        ? options.body
        : JSON.stringify(options.body);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(options.timeoutMs));
    try {
      const response = await this.fetchImpl(`${requestBaseUrl}${path}`, {
        method: options.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: contentType,
          "Content-Type": contentType,
          ...(options.headers ?? {}),
        },
        body,
        signal: controller.signal,
      });
      const responseBody = await readResponseBody(response);
      const requestId = response.headers.get("ruid") ?? undefined;
      if (!response.ok) {
        const providerError = parseProviderError(responseBody);
        throw new BookingComApiError(providerError.message || "Booking.com request failed", {
          status: response.status,
          providerCode: providerError.code,
          requestId,
        });
      }
      return { status: response.status, body: responseBody, requestId };
    } catch (error) {
      if (error instanceof BookingComApiError) throw error;
      if ((error as { name?: string })?.name === "AbortError") {
        throw new BookingComApiError("Booking.com request timed out", { status: 504 });
      }
      throw new BookingComApiError("Booking.com request could not be completed", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async getReservationsSummary(token: string, hotelId: number): Promise<{ status: number; body: string; requestId?: string }> {
    if (!Number.isInteger(hotelId) || hotelId <= 0) throw new Error("A valid Booking.com hotel ID is required");
    return this.request(token, {
      path: "/hotels/xml/reservationssummary",
      method: "POST",
      secure: true,
      contentType: "application/xml",
      body: `<request><hotel_id>${hotelId}</hotel_id></request>`,
    });
  }

  async getNewReservations(token: string, hotelId: number): Promise<{ status: number; body: string; requestId?: string }> {
    if (!Number.isInteger(hotelId) || hotelId <= 0) throw new Error("A valid Booking.com hotel ID is required");
    return this.request(token, {
      path: `/hotels/ota/OTA_HotelResNotif?hotel_ids=${encodeURIComponent(String(hotelId))}`,
      method: "GET",
      secure: true,
      contentType: "application/xml",
    });
  }

  async getModifiedOrCancelledReservations(token: string, hotelId: number): Promise<{ status: number; body: string; requestId?: string }> {
    if (!Number.isInteger(hotelId) || hotelId <= 0) throw new Error("A valid Booking.com hotel ID is required");
    return this.request(token, {
      path: `/hotels/ota/OTA_HotelResModifyNotif?hotel_ids=${encodeURIComponent(String(hotelId))}`,
      method: "GET",
      secure: true,
      contentType: "application/xml",
    });
  }

  async acknowledgeReservations(
    token: string,
    reservationIds: string[],
    modified = false,
  ): Promise<{ status: number; body: string; requestId?: string }> {
    const ids = reservationIds.map((id) => id.trim()).filter(Boolean);
    if (!ids.length) throw new Error("At least one Booking.com reservation ID is required");
    const root = modified ? "OTA_HotelResModifyNotifRS" : "OTA_HotelResNotifRS";
    const body = `<${root} TimeStamp="${new Date().toISOString()}" Target="${this.target}" Version="2.001"><HotelReservations>${ids
      .map((id) => `<HotelReservation><ResGlobalInfo><HotelReservationIDs><HotelReservationID ResID_Value="${escapeXmlAttribute(id)}" /></HotelReservationIDs></ResGlobalInfo></HotelReservation>`)
      .join("")}</HotelReservations></${root}>`;
    return this.request(token, {
      path: `/hotels/ota/${modified ? "OTA_HotelResModifyNotif" : "OTA_HotelResNotif"}`,
      method: "POST",
      secure: true,
      contentType: "application/xml",
      body,
      headers: { "Accept-Version": "2.001" },
    });
  }

  async updateAvailability(token: string, xmlBody: string): Promise<{ status: number; body: string; requestId?: string }> {
    if (!xmlBody.trim().startsWith("<")) throw new Error("Booking.com availability payload must be XML");
    return this.request(token, {
      path: "/hotels/xml/availability",
      method: "POST",
      contentType: "application/xml",
      body: xmlBody,
      headers: { "Accept-Version": "1.1" },
    });
  }
}

function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const bookingComClient = new BookingComClient();
