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
    if (status === 401 && shouldForceBrowserLogout(error)) {
      await forceBrowserLogout();
    }
    return Promise.reject(error);
  }
);

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
