import { Platform } from "react-native";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
};

export type ApiError = Error & {
  status?: number;
  payload?: unknown;
};

let configuredApiUrl = "";
let configuredClient = "NATIVE_APP";

/** Configures the API base URL used by apiRequest/apiUploadFile. Call once per app at startup. */
export function configureApiClient(config: { apiUrl: string; client?: string }) {
  configuredApiUrl = config.apiUrl;
  configuredClient = config.client?.trim() || "NATIVE_APP";
}

/**
 * Extracts a human-readable message from an API error. Prefers `payload.reasons`
 * (friendly explanations), falls back to `error.message` unless it looks like a raw
 * machine-readable code (e.g. "password_reused", "weak_password"), in which case the
 * provided fallback is used instead.
 */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  const payload = (error as ApiError | undefined)?.payload as { reasons?: unknown } | undefined;
  if (Array.isArray(payload?.reasons) && payload!.reasons.length) {
    return payload!.reasons.map(String).join(" ");
  }
  if (error instanceof Error && error.message && !/^[a-z][a-z0-9_]*$/.test(error.message)) {
    return error.message;
  }
  return fallback;
}

export function apiBaseUrl() {
  const base = configuredApiUrl.trim().replace(/\/+$/, "");
  if (!base) {
    throw Object.assign(new Error("API URL is not configured. Call configureApiClient({ apiUrl }) at startup."), {
      status: 0
    });
  }
  if (!__DEV__ && /^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)(?=:\d+|\/|$)/i.test(base)) {
    throw Object.assign(new Error("This production app build points to a local API. Configure the production HTTPS API origin and rebuild."), {
      status: 0
    });
  }
  if (Platform.OS === "android") {
    return base.replace(/^http:\/\/(localhost|127\.0\.0\.1)(?=:\d+|$)/i, "http://10.0.2.2");
  }
  return base;
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "X-NoLSAF-Client": configuredClient
  };

  if (options.body != null) {
    headers["Content-Type"] = "application/json";
  }

  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }

  const baseUrl = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body != null ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw Object.assign(new Error("We could not connect to NoLSAF right now. Check your connection and try again."), {
      status: 0,
      payload: { baseUrl, path, reason }
    }) as ApiError;
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : `Request failed with status ${response.status}`;

    throw Object.assign(new Error(message), {
      status: response.status,
      payload
    }) as ApiError;
  }

  return payload as T;
}

export async function apiUploadFile<T>(
  path: string,
  params: {
    token?: string | null;
    file: { uri: string; name: string; type?: string | null; file?: Blob | File | null };
    fields?: Record<string, string>;
  }
): Promise<T> {
  const form = new FormData();
  Object.entries(params.fields || {}).forEach(([key, value]) => form.append(key, value));
  if (Platform.OS === "web") {
    const webFile = params.file.file ? params.file.file : await fetch(params.file.uri).then((res) => res.blob());
    form.append("file", webFile, params.file.name);
  } else {
    form.append("file", {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.type || "application/octet-stream"
    } as any);
  }

  const headers: Record<string, string> = { Accept: "application/json", "X-NoLSAF-Client": configuredClient };
  if (params.token) headers.Authorization = `Bearer ${params.token}`;

  const baseUrl = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: form
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw Object.assign(new Error("We could not connect to NoLSAF right now. Check your connection and try again."), {
      status: 0,
      payload: { baseUrl, path, reason }
    }) as ApiError;
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload && "message" in payload
        ? String((payload as { message?: unknown }).message)
        : typeof payload === "object" && payload && "error" in payload
          ? String((payload as { error?: unknown }).error)
          : `Upload failed with status ${response.status}`;
    throw Object.assign(new Error(message), { status: response.status, payload }) as ApiError;
  }

  return payload as T;
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
