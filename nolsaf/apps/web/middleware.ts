// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { buildAuthLoginRedirect } from "./lib/authLoginRedirect";
import { signedInLoginDestination } from "./lib/postAuthRouting";

function buildContentSecurityPolicy(nonce: string): string {
  const isProduction = process.env.NODE_ENV === "production";
  const apiOrigin = String(process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || "").replace(/\/$/, "");
  const socketOrigin = String(process.env.NEXT_PUBLIC_SOCKET_URL || "").replace(/\/$/, "");
  const localConnectSrc = isProduction
    ? []
    : ["http://127.0.0.1:4000", "http://localhost:4000", "http://localhost:3001", "ws:"];
  const connectSrc = [
    "'self'",
    "https:",
    "wss:",
    "https://api.mapbox.com",
    "https://events.mapbox.com",
    apiOrigin,
    socketOrigin,
    ...localConnectSrc,
  ].filter(Boolean);
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(isProduction ? [] : ["'unsafe-eval'"]),
    "https://static.cloudflareinsights.com",
    "https://api.mapbox.com",
    "https://events.mapbox.com",
  ];
  const imgSrc = [
    "'self'",
    "blob:",
    "data:",
    "https:",
    ...(isProduction ? [] : ["http:"]),
    "res.cloudinary.com",
    "img.youtube.com",
    "https://api.mapbox.com",
    "https://*.mapbox.com",
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSrc.join(" ")}`,
    "style-src 'self' 'unsafe-inline' https://api.mapbox.com",
    `img-src ${imgSrc.join(" ")}`,
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data: https:",
    `connect-src ${connectSrc.join(" ")}`,
    "frame-ancestors 'self'",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(isProduction ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

// Browser API requests must retain the API's normal CSRF protections.
// This middleware only allows the Next.js rewrite to proxy the request.
// It deliberately adds no trusted headers to browser traffic.
export function middleware(req: NextRequest) {
  // API traffic is proxied by Next.js rewrites without a CSRF bypass.
  // The rewrite runs after middleware and forwards the original request headers.
  const isApiProxy =
    req.nextUrl.pathname.startsWith("/api/") ||
    req.nextUrl.pathname.startsWith("/uploads/") ||
    req.nextUrl.pathname.startsWith("/webhooks/");

  if (isApiProxy) return NextResponse.next();

  // Next reads the nonce from the request CSP and applies it to framework
  // scripts. The matching response header lets the browser enforce it. A new
  // nonce per request removes the need for script-src 'unsafe-inline'.
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
  requestHeaders.set("x-nonce", nonce);
  const url = req.nextUrl.clone();
  const path = url.pathname;

  // ─── MAINTENANCE MODE ───────────────────────────────────────────────────────
  // Edge runtime reads process.env at request time (not build time in Next.js 15+).
  // Set MAINTENANCE_MODE=true in your .env.local or AWS EB environment variables.
  const maintenance = process.env.MAINTENANCE_MODE === "true";
  // Keep legally required privacy and account-deletion resources available
  // even while the transactional product is undergoing maintenance.
  const isAlwaysAvailablePolicyRoute =
    path === "/maintenance" ||
    path === "/account-deletion" ||
    path === "/privacy";
  if (maintenance && !isAlwaysAvailablePolicyRoute) {
    url.pathname = "/maintenance";
    return NextResponse.redirect(url);
  }
  // ────────────────────────────────────────────────────────────────────────────

  // Check for both cookie names for compatibility
  const token = req.cookies.get("token")?.value || req.cookies.get("nolsaf_token")?.value || "";
  // Prefer the token role for page routing. Keep the legacy role cookie only as
  // a fallback for sessions issued before role was included in the JWT.
  const tokenRole = decodeRoleFromToken(token);
  const cookieRole = req.cookies.get("role")?.value || "";
  const role = tokenRole || cookieRole;

  // Preserve the existing signed-in /login behavior before normalizing legacy
  // login aliases. Unauthenticated aliases are redirected at the HTTP layer so
  // React never hydrates an async redirect page.
  if (path === "/login" && role) {
    const next = url.searchParams.get("next");
    const roleHint = url.searchParams.get("role");
    const destination = signedInLoginDestination(next, roleHint, role);
    return NextResponse.redirect(new URL(destination, req.url));
  }

  const authLoginRedirect = buildAuthLoginRedirect(url);
  if (authLoginRedirect) {
    return NextResponse.redirect(authLoginRedirect);
  }

  const isPublicNrmsGuestRoute =
    path.startsWith("/nrms/book/") ||
    path.startsWith("/nrms/guest/payment/") ||
    path.startsWith("/nrms/guest/review/");

  if (path.startsWith("/admin")) {
    if (role !== "ADMIN") {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  if (path.startsWith("/nrms") && !isPublicNrmsGuestRoute && !token) {
    // Preserve the destination (e.g. the emailed /nrms/confirm?token=... link)
    // so the user lands back on it after signing in.
    const next = path + (req.nextUrl.search || "");
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", next);
    return NextResponse.redirect(url);
  }

  if (path.startsWith("/owner/nrms")) {
    // NRMS staff are authorized by property-scoped memberships in the API.
    // The page shell requires authentication but deliberately does not grant
    // access to any other Owner route.
    if (!token) {
      const next = path + (req.nextUrl.search || "");
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("next", next);
      return NextResponse.redirect(url);
    }
  } else if (path.startsWith("/owner")) {
    if (role !== "OWNER" && role !== "ADMIN") {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  if (path.startsWith("/driver")) {
    if (role !== "DRIVER" && role !== "ADMIN") {
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
  }

  if (path.startsWith("/sales") || path === "/workspace/select") {
    // Sales partners are ordinary users: there is no SALES role and the role
    // cookie says nothing about the entitlement. Authorization lives in
    // UserWorkspaceAccess and is enforced by the API on every request, exactly
    // as /owner/nrms does for staff memberships. The shell only requires that
    // somebody is signed in.
    if (!token) {
      const next = path + (req.nextUrl.search || "");
      url.pathname = "/login";
      url.search = "";
      url.searchParams.set("next", next);
      return NextResponse.redirect(url);
    }
  }

  // Customer account pages should require auth (like Group Stays).
  // Allow auth routes under /account/* to remain public.
  // Match the /account section only (exact or /account/...), never a bare
  // "account" prefix — otherwise the public, legally-required /account-deletion
  // page gets caught and bounced to login, breaking Play Store compliance.
  if (path === "/account" || path.startsWith("/account/")) {
    const isAccountAuthRoute =
      path === "/account/login" ||
      path === "/account/register" ||
      path === "/account/forgot-password" ||
      path === "/account/reset-password";

    // Allow the Agent Portal pages — but require AGENT (or ADMIN) role.
    // Other authenticated roles hitting /account/agent get redirected to their
    // own portal instead of seeing a broken state.
    const isAgentPortalRoute = path === "/account/agent" || path.startsWith("/account/agent/");

    if (!isAccountAuthRoute) {
      if (!token) {
        url.pathname = "/account/login";
        return NextResponse.redirect(url);
      }
      // Role-guard the agent portal — non-agents are bounced to their home
      if (isAgentPortalRoute && role && role !== "AGENT" && role !== "ADMIN") {
        if (role === "OWNER") url.pathname = "/owner";
        else if (role === "DRIVER") url.pathname = "/driver";
        else url.pathname = "/account";
        return NextResponse.redirect(url);
      }
    }
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  const isCapabilityPage =
    path.startsWith("/nrms/guest/payment/") ||
    path.startsWith("/nrms/guest/review/");
  response.headers.set(
    "Referrer-Policy",
    isCapabilityPage ? "no-referrer" : "strict-origin-when-cross-origin",
  );
  if (isCapabilityPage) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  }
  return response;
}

export const config = {
  matcher: [
    // When in maintenance mode, intercept everything except Next.js internals
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)",
  ],
};

// stub — replace with real decode
function decodeRoleFromToken(token: string) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    const decoded = atob(padded);
    const role = String((JSON.parse(decoded) as { role?: unknown })?.role || "").toUpperCase();
    return ["ADMIN", "OWNER", "DRIVER", "AGENT", "USER", "CUSTOMER"].includes(role) ? role : "";
  } catch {
    return "";
  }
}
