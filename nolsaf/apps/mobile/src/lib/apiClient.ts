import { Platform } from "react-native";

import { env } from "./env";
import { resolveLocalhostUrl } from "./localUrl";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  token?: string | null;
};

export type ApiError = Error & {
  status?: number;
  payload?: unknown;
};

type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  unauthorizedHandler = handler;
}

function handleUnauthorized(status: number, hadToken: boolean) {
  if (status === 401 && hadToken && unauthorizedHandler) {
    void unauthorizedHandler();
  }
}

/**
 * Extracts a human-readable message from an API error. Prefers `payload.reasons`
 * (friendly explanations), falls back to `error.message` unless it looks like a raw
 * machine-readable code (e.g. "password_reused", "weak_password"), in which case the
 * provided fallback is used instead.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
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
  const base = resolveLocalhostUrl(env.apiUrl);
  if (!base) {
    throw Object.assign(new Error("Mobile API URL is not configured. Set EXPO_PUBLIC_API_URL."), {
      status: 0
    });
  }
  return base;
}

function connectionMessage(baseUrl: string): string {
  if (__DEV__) {
    return `Could not connect to the local NoLSAF API at ${baseUrl}. Start the API and confirm this device can reach your computer.`;
  }
  return "We could not connect to NoLSAF right now. Check your connection and try again.";
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json"
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
      // This app authenticates purely with the Bearer token. Never send cookies:
      // React Native's fetch otherwise stores the server's Set-Cookie and re-sends
      // it, which makes the API treat requests as cookie-authenticated and blocks
      // mutations with a CSRF error.
      credentials: "omit",
      body: options.body != null ? JSON.stringify(options.body) : undefined
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw Object.assign(new Error(connectionMessage(baseUrl)), {
      status: 0,
      payload: { baseUrl, path, reason }
    }) as ApiError;
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    handleUnauthorized(response.status, Boolean(options.token));
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

  const headers: Record<string, string> = { Accept: "application/json" };
  if (params.token) headers.Authorization = `Bearer ${params.token}`;

  const baseUrl = apiBaseUrl();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      credentials: "omit",
      body: form
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Network request failed";
    throw Object.assign(new Error(connectionMessage(baseUrl)), {
      status: 0,
      payload: { baseUrl, path, reason }
    }) as ApiError;
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;
  if (!response.ok) {
    handleUnauthorized(response.status, Boolean(params.token));
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
