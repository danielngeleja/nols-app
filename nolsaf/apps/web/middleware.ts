// apps/web/middleware.ts
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
  const url = req.nextUrl.clone();
  const path = url.pathname;

  // ─── MAINTENANCE MODE ───────────────────────────────────────────────────────
  // Edge runtime reads process.env at request time (not build time in Next.js 15+).
  // Set MAINTENANCE_MODE=true in your .env.local or AWS EB environment variables.
  const maintenance = process.env.MAINTENANCE_MODE === "true";
  if (maintenance && path !== "/maintenance") {
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

  // Customer account pages should require auth (like Group Stays).
  // Allow auth routes under /account/* to remain public.
  if (path.startsWith("/account")) {
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

  // If logged in and on /login, honor a safe next target, else bounce to role home
  if (path === "/login" && role) {
    const next = url.searchParams.get("next") || "";
    if (next.startsWith("/") && !next.startsWith("//")) {
      return NextResponse.redirect(new URL(next, req.url));
    }
    if (role === "ADMIN") url.pathname = "/admin/home";
    else if (role === "OWNER") url.pathname = "/owner";
    else if (role === "DRIVER") url.pathname = "/driver";
    else if (role === "AGENT") url.pathname = "/account/agent";
    else url.pathname = "/account";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
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
