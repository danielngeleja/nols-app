/**
 * Shared axios client for owner/admin/driver portal API calls.
 *
 * Auth relies on secure cookies and same-origin rewrites. No bearer token is
 * read from browser storage or attached from client-side JavaScript.
 *
 * CSRF:
 *   1. Capture the X-CSRF-Token header the server sends on every GET response.
 *   2. Persist it to sessionStorage so it survives mobile JS context resets.
 *   3. Attach it on all state-changing requests.
 */
import axios from "axios";

const CSRF_SESSION_KEY = "nolsaf:csrf";

let csrfToken: string | null = null;

function readCsrfToken(): string | null {
  if (csrfToken) return csrfToken;
  try {
    return sessionStorage.getItem(CSRF_SESSION_KEY);
  } catch {
    return null;
  }
}

function writeCsrfToken(token: string): void {
  csrfToken = token;
  try {
    sessionStorage.setItem(CSRF_SESSION_KEY, token);
  } catch {
    // sessionStorage is not always available in mobile/WebView contexts.
  }
}

const MUTATION_METHODS = new Set(["post", "put", "patch", "delete"]);

const apiClient = axios.create({ baseURL: "", withCredentials: true });
let authRedirectInFlight = false;
let csrfRefreshInFlight: Promise<string | null> | null = null;

apiClient.interceptors.request.use((config) => {
  config.headers = config.headers ?? {};

  if (MUTATION_METHODS.has((config.method ?? "").toLowerCase())) {
    const csrf = readCsrfToken();
    if (csrf) {
      config.headers["X-CSRF-Token"] = csrf;
    }
  }

  return config;
});

apiClient.interceptors.response.use(
  (response) => {
    const csrfHeader = response.headers["x-csrf-token"];
    if (csrfHeader) {
      writeCsrfToken(String(csrfHeader));
    }
    return response;
  },
  async (error) => {
    const status = error?.response?.status;
    const config = error?.config as any;
    if (status === 403 && error?.response?.data?.require2fa && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("finance-grant-required"));
    }
    if (status === 423 && error?.response?.data?.code === "NRMS_PROPERTY_FROZEN" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("nrms-property-frozen", { detail: error.response.data }));
    }
    const isMutation = MUTATION_METHODS.has(String(config?.method || "").toLowerCase());
    const csrfFailure =
      error?.response?.data?.error === "Invalid CSRF token"
      || error?.response?.data?.code === "CSRF_TOKEN_MISSING";
    if (
      status === 403
      && csrfFailure
      && isMutation
      && config
      && !config.__csrfRetried
    ) {
      config.__csrfRetried = true;
      const refreshed = await refreshCsrfToken();
      if (refreshed) {
        config.headers = config.headers ?? {};
        config.headers["X-CSRF-Token"] = refreshed;
        return apiClient.request(config);
      }
    }
    if (status === 401 && shouldForceBrowserLogout(error)) {
      await forceBrowserLogout();
    }
    return Promise.reject(error);
  }
);

async function refreshCsrfToken(): Promise<string | null> {
  if (csrfRefreshInFlight) return csrfRefreshInFlight;
  csrfRefreshInFlight = (async () => {
    clearAuthToken();
    try {
      await apiClient.get("/api/auth/session", { params: { csrf_refresh: Date.now() } });
      return readCsrfToken();
    } catch {
      return null;
    }
  })().finally(() => {
    csrfRefreshInFlight = null;
  });
  return csrfRefreshInFlight;
}

export function saveAuthToken(token: string | null | undefined): void {
  void token;
}

export function clearAuthToken(): void {
  csrfToken = null;
  try {
    sessionStorage.removeItem(CSRF_SESSION_KEY);
  } catch {
    // ignore
  }
}

function shouldForceBrowserLogout(error: any): boolean {
  const code = error?.response?.data?.code;
  if (code === "SESSION_EXPIRED" || code === "SESSION_REVOKED") return true;

  const url = String(error?.config?.url || "");
  if (isAuthEntryPath(url)) return false;
  return true;
}

function isAuthEntryPath(url: string): boolean {
  return (
    url.includes("/api/auth/login") ||
    url.includes("/api/auth/login-password") ||
    url.includes("/api/auth/register") ||
    url.includes("/api/auth/send-otp") ||
    url.includes("/api/auth/verify-otp") ||
    url.includes("/api/auth/forgot-password") ||
    url.includes("/api/auth/reset-password") ||
    url.includes("/api/auth/passkeys")
  );
}

async function forceBrowserLogout(): Promise<void> {
  if (authRedirectInFlight || typeof window === "undefined") return;
  authRedirectInFlight = true;
  clearAuthToken();
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
  } catch {
    // Redirect even if clearing the server cookie fails; the current token is dead.
  }
  window.location.replace(getLoginPathForCurrentRoute());
}

function getLoginPathForCurrentRoute(): string {
  if (typeof window === "undefined") return "/account/login";
  const path = window.location.pathname;
  if (path.startsWith("/admin")) return "/admin/login";
  if (path.startsWith("/owner")) return "/owner/login";
  if (path.startsWith("/driver")) return "/driver/login";
  if (path.startsWith("/account/agent")) return "/account/login";
  return "/account/login";
}

export default apiClient;
