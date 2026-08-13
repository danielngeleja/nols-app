import crypto from "node:crypto";

const DEFAULT_TOKEN_URL = "https://api.expediagroup.com/identity/oauth2/v3/token";
const DEFAULT_GRAPHQL_URL = "https://api.expediagroup.com/supply/lodging/graphql";
const DEFAULT_TIMEOUT_MS = 65_000;
const MAX_ERROR_BODY_CHARS = 4_000;

export type ExpediaCredentials = {
  username: string;
  password: string;
};

export type ExpediaToken = {
  accessToken: string;
  expiresIn: number;
  tokenType: string;
};

export type ExpediaClientConfig = {
  tokenUrl?: string;
  graphqlUrl?: string;
  ariUrl?: string;
};

export type ExpediaGraphqlResponse<T> = {
  data: T;
  transactionId?: string;
};

export type ExpediaReservationPage = {
  property: {
    id: string;
    reservations: {
      totalCount: number | null;
      edges: Array<{ cursor: string; node: Record<string, unknown> }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
};

const RESERVATION_FIELDS = `
  id propertyId status creationDateTime lastUpdatedDateTime
  checkInDate checkOutDate adultCount childCount totalGuestCount
  unitIds { id idSource }
  rateIds { id idSource }
  reservationIds { id idSource }
  primaryGuest { firstName lastName emailAddress phoneNumbers { fullPhoneNumber } loyaltyTier }
  amounts { summary { type description amount { amount currencyCode } } }
`;

export class ExpediaApiError extends Error {
  readonly status: number;
  readonly providerCode?: string;
  readonly transactionId?: string;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number; providerCode?: string; transactionId?: string; retryable?: boolean }) {
    super(message);
    this.name = "ExpediaApiError";
    this.status = options.status;
    this.providerCode = options.providerCode;
    this.transactionId = options.transactionId;
    this.retryable = options.retryable ?? (options.status === 429 || options.status >= 500);
  }
}

type CachedToken = ExpediaToken & { expiresAt: number };

function boundedTimeout(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1_000, Math.min(Math.trunc(timeoutMs as number), DEFAULT_TIMEOUT_MS));
}

function credentialKey(credentials: ExpediaCredentials): string {
  return crypto.createHash("sha256").update(`${credentials.username}\0${credentials.password}`).digest("hex");
}

function firstGraphqlError(value: unknown): { message: string; code?: string } | null {
  if (!value || typeof value !== "object") return null;
  const errors = (value as { errors?: unknown }).errors;
  if (!Array.isArray(errors) || !errors.length) return null;
  const first = errors[0] as { message?: unknown; extensions?: { code?: unknown } };
  return {
    message: typeof first?.message === "string" ? first.message : "Expedia GraphQL request failed",
    code: typeof first?.extensions?.code === "string" ? first.extensions.code : undefined,
  };
}

function xmlError(value: string): { message?: string; code?: string; warnings: string[] } {
  const warnings = Array.from(value.matchAll(/<(?:Warning|warning)\b[^>]*(?:code|Code)=["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/(?:Warning|warning)>/g))
    .map((match) => `${match[1]}: ${match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}`.slice(0, 500));
  const code = value.match(/<(?:Error|error)\b[^>]*(?:code|Code)=["']?([^"' >]+)["']?/i)?.[1]
    ?? value.match(/<(?:ErrorCode|errorCode)>([^<]+)</i)?.[1]?.trim();
  const message = value.match(/<(?:Error|error)\b[^>]*>([\s\S]*?)<\/(?:Error|error)>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return { code, message, warnings };
}

export class ExpediaClient {
  private readonly tokenUrl: string;
  private readonly graphqlUrl: string;
  private readonly ariUrl: string | null;
  private readonly tokenCache = new Map<string, CachedToken>();

  constructor(private readonly fetchImpl: typeof fetch = fetch, config: ExpediaClientConfig = {}) {
    this.tokenUrl = config.tokenUrl ?? process.env.EXPEDIA_TOKEN_URL ?? DEFAULT_TOKEN_URL;
    this.graphqlUrl = config.graphqlUrl ?? process.env.EXPEDIA_GRAPHQL_URL ?? DEFAULT_GRAPHQL_URL;
    this.ariUrl = (config.ariUrl ?? process.env.EXPEDIA_ARI_URL ?? "").trim() || null;
  }

  isAriConfigured(): boolean {
    return this.ariUrl != null;
  }

  async exchangeToken(credentials: ExpediaCredentials, timeoutMs = 30_000): Promise<ExpediaToken> {
    const key = credentialKey(credentials);
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 30_000) {
      return { accessToken: cached.accessToken, expiresIn: Math.max(1, Math.floor((cached.expiresAt - Date.now()) / 1000)), tokenType: cached.tokenType };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
    try {
      const response = await this.fetchImpl(this.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`, "utf8").toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: "grant_type=client_credentials",
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!response.ok) {
        let code: string | undefined;
        try {
          const parsed = JSON.parse(raw.slice(0, MAX_ERROR_BODY_CHARS)) as { error?: unknown };
          code = typeof parsed.error === "string" ? parsed.error : undefined;
        } catch { /* bounded provider response only */ }
        throw new ExpediaApiError("Expedia token exchange failed", { status: response.status, providerCode: code });
      }
      const parsed = JSON.parse(raw) as { access_token?: unknown; expires_in?: unknown; token_type?: unknown };
      if (typeof parsed.access_token !== "string" || !parsed.access_token.trim()) {
        throw new ExpediaApiError("Expedia returned no access token", { status: 502 });
      }
      const expiresIn = Number.isFinite(Number(parsed.expires_in)) ? Math.max(60, Number(parsed.expires_in)) : 1_800;
      const token = { accessToken: parsed.access_token, expiresIn, tokenType: typeof parsed.token_type === "string" ? parsed.token_type : "Bearer" };
      this.tokenCache.set(key, { ...token, expiresAt: Date.now() + expiresIn * 1_000 });
      return token;
    } catch (error) {
      if (error instanceof ExpediaApiError) throw error;
      if ((error as { name?: string })?.name === "AbortError") throw new ExpediaApiError("Expedia token exchange timed out", { status: 504 });
      throw new ExpediaApiError("Expedia token exchange could not be completed", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async graphql<T>(token: string, query: string, variables: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ExpediaGraphqlResponse<T>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
    try {
      const response = await this.fetchImpl(this.graphqlUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/graphql-response+json",
        },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      });
      const transactionId = response.headers.get("transaction-id") ?? undefined;
      const raw = await response.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(response.ok ? raw : raw.slice(0, MAX_ERROR_BODY_CHARS));
      } catch {
        throw new ExpediaApiError("Expedia returned an invalid GraphQL response", { status: response.ok ? 502 : response.status, transactionId });
      }
      const graphError = firstGraphqlError(parsed);
      if (!response.ok || graphError) {
        throw new ExpediaApiError(graphError?.message ?? "Expedia GraphQL request failed", {
          status: response.ok ? 422 : response.status,
          providerCode: graphError?.code,
          transactionId,
          retryable: response.status === 429 || response.status >= 500 || graphError?.code === "RATE_LIMIT_EXCEEDED",
        });
      }
      const data = (parsed as { data?: T }).data;
      if (data == null) throw new ExpediaApiError("Expedia GraphQL response contained no data", { status: 502, transactionId });
      return { data, transactionId };
    } catch (error) {
      if (error instanceof ExpediaApiError) throw error;
      if ((error as { name?: string })?.name === "AbortError") throw new ExpediaApiError("Expedia GraphQL request timed out", { status: 504 });
      throw new ExpediaApiError("Expedia GraphQL request could not be completed", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }

  async verifyProperty(token: string, propertyId: string) {
    const query = `query NrmsExpediaPropertyAccess($propertyId: String!) { property(id: $propertyId, idSource: EXPEDIA) { id } }`;
    const response = await this.graphql<{ property: { id: string } | null }>(token, query, { propertyId });
    if (!response.data.property || String(response.data.property.id) !== String(propertyId)) {
      throw new ExpediaApiError("Expedia credentials do not have access to this property", { status: 403, transactionId: response.transactionId });
    }
    return response;
  }

  async getReservationsUpdatedBetween(token: string, propertyId: string, from: string, to: string, after?: string | null) {
    const query = `query NrmsExpediaReservationDelta($propertyId: String!, $from: ZoneDateTime!, $to: ZoneDateTime!, $after: String) {
      property(id: $propertyId, idSource: EXPEDIA) {
        id
        reservations(filter: { lastUpdatedDateTime: { from: $from, to: $to } }, pageSize: 25, after: $after) {
          totalCount edges { cursor node { ${RESERVATION_FIELDS} } } pageInfo { hasNextPage endCursor }
        }
      }
    }`;
    return this.graphql<ExpediaReservationPage>(token, query, { propertyId, from, to, after: after ?? null });
  }

  async getReservation(token: string, propertyId: string, reservationId: string) {
    const query = `query NrmsExpediaReservation($propertyId: String!, $reservationIds: [IdNodeInput!]) {
      property(id: $propertyId, idSource: EXPEDIA) {
        id
        reservations(filter: { reservationIds: $reservationIds }, pageSize: 1) {
          totalCount edges { cursor node { ${RESERVATION_FIELDS} } } pageInfo { hasNextPage endCursor }
        }
      }
    }`;
    return this.graphql<ExpediaReservationPage>(token, query, { propertyId, reservationIds: [{ id: reservationId, idSource: "EXPEDIA" }] });
  }

  async confirmReservationNotification(token: string, input: { propertyId: string; reservationId: string; actionType: string; confirmationToken: string }) {
    const actionType = input.actionType.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(actionType)) throw new Error("Invalid Expedia notification action type");
    const mutation = `mutation NrmsConfirmExpediaReservationNotification {
      confirmReservationNotification(
        propertyId: ${JSON.stringify(input.propertyId)},
        reservationId: ${JSON.stringify(input.reservationId)},
        actionType: ${actionType},
        confirmationToken: ${JSON.stringify(input.confirmationToken)}
      )
    }`;
    return this.graphql<{ confirmReservationNotification: unknown }>(token, mutation, {});
  }

  async updateAvailability(credentials: ExpediaCredentials, xmlBody: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ status: number; body: string; transactionId?: string; warnings: string[] }> {
    if (!this.ariUrl) throw new ExpediaApiError("Expedia ARI endpoint has not been supplied for this environment", { status: 503, providerCode: "ARI_ENDPOINT_MISSING", retryable: false });
    if (!xmlBody.startsWith("<?xml") && !xmlBody.startsWith("<AvailRateUpdateRQ")) throw new Error("Expedia ARI payload must be XML");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), boundedTimeout(timeoutMs));
    try {
      const response = await this.fetchImpl(this.ariUrl, {
        method: "POST",
        headers: { "Content-Type": "text/xml; charset=UTF-8", Accept: "text/xml" },
        body: xmlBody,
        signal: controller.signal,
      });
      const transactionId = response.headers.get("transaction-id") ?? response.headers.get("x-request-id") ?? undefined;
      const body = await response.text();
      const provider = xmlError(response.ok ? body : body.slice(0, MAX_ERROR_BODY_CHARS));
      if (!response.ok || provider.code) {
        throw new ExpediaApiError(provider.message || "Expedia rejected the availability and rates update", { status: response.ok ? 422 : response.status, providerCode: provider.code, transactionId });
      }
      return { status: response.status, body, transactionId, warnings: provider.warnings };
    } catch (error) {
      if (error instanceof ExpediaApiError) throw error;
      if ((error as { name?: string })?.name === "AbortError") throw new ExpediaApiError("Expedia ARI request timed out", { status: 504 });
      throw new ExpediaApiError("Expedia ARI request could not be completed", { status: 502 });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const expediaClient = new ExpediaClient();
