export type AccountRole = "ADMIN" | "OWNER" | "DRIVER" | "AGENT" | "NRMS_AGENT" | "USER" | "CUSTOMER";

export function normalizeAccountRole(role: unknown): AccountRole | "" {
  const normalized = String(role || "").trim().toUpperCase();
  return ["ADMIN", "OWNER", "DRIVER", "AGENT", "NRMS_AGENT", "USER", "CUSTOMER"].includes(normalized)
    ? (normalized as AccountRole)
    : "";
}

export function roleHomePath(role: unknown): string {
  switch (normalizeAccountRole(role)) {
    case "ADMIN":
      return "/admin/home";
    case "OWNER":
      return "/owner";
    case "DRIVER":
      return "/driver";
    case "AGENT":
      return "/account/agent";
    case "NRMS_AGENT":
      return "/agent-portal";
    default:
      return "/account";
  }
}

export function shouldResolveWorkspaceSelection(role: unknown): boolean {
  const accountRole = normalizeAccountRole(role);
  return accountRole === "USER" || accountRole === "CUSTOMER";
}

function targetPathname(target: string): string | null {
  try {
    if (!target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return null;
    const parsed = new URL(target, "https://post-auth.nolsaf.invalid");
    if (parsed.origin !== "https://post-auth.nolsaf.invalid") return null;
    return decodeURIComponent(parsed.pathname).toLowerCase();
  } catch {
    return null;
  }
}

/**
 * A return destination is navigation context, never an authorization grant.
 * Reject portal destinations that conflict with the role in the authenticated
 * session so a legacy Owner/Admin/Driver login URL cannot choose the dashboard.
 */
export function isPostAuthTargetAllowed(target: string, role: unknown): boolean {
  const pathname = targetPathname(target);
  const accountRole = normalizeAccountRole(role);
  if (!pathname) return false;

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return accountRole === "ADMIN";
  }

  // NRMS staff use property-scoped memberships instead of the global OWNER
  // role. Its APIs perform the membership authorization after navigation.
  if (pathname === "/owner/nrms" || pathname.startsWith("/owner/nrms/")) {
    return Boolean(accountRole);
  }

  if (pathname === "/owner" || pathname.startsWith("/owner/")) {
    return accountRole === "OWNER" || accountRole === "ADMIN";
  }

  if (pathname === "/driver" || pathname.startsWith("/driver/")) {
    return accountRole === "DRIVER" || accountRole === "ADMIN";
  }

  if (pathname === "/account/agent" || pathname.startsWith("/account/agent/")) {
    return accountRole === "AGENT" || accountRole === "ADMIN";
  }

  if (pathname === "/agent-portal" || pathname.startsWith("/agent-portal/")) {
    // AGENT is an additive candidate role only. Navigation may enter the shell,
    // but every portal API still requires the centrally granted accommodation
    // capability, approved operator profile, and active agency identity.
    return accountRole === "AGENT" || accountRole === "NRMS_AGENT" || accountRole === "ADMIN";
  }

  return true;
}

/** A portal label in the URL may describe intent, but it cannot replace role truth. */
export function doesRoleHintMatchAccount(roleHint: unknown, role: unknown): boolean {
  const hint = String(roleHint || "").trim().toLowerCase();
  const accountRole = normalizeAccountRole(role);
  if (!hint) return true;

  if (hint === "admin") return accountRole === "ADMIN";
  if (hint === "owner" || hint === "partner" || hint === "partners") return accountRole === "OWNER";
  if (hint === "driver") return accountRole === "DRIVER";
  if (hint === "agent") return accountRole === "AGENT" || accountRole === "NRMS_AGENT";
  if (hint === "traveller" || hint === "traveler" || hint === "customer" || hint === "user") {
    return accountRole === "USER" || accountRole === "CUSTOMER";
  }

  // Unknown presentation hints must not unexpectedly suppress a legitimate
  // return link. Protected destinations are still checked above.
  return true;
}

export function validatedPostAuthTarget(
  target: unknown,
  roleHint: unknown,
  role: unknown,
): string | null {
  if (typeof target !== "string") return null;
  const normalizedTarget = target.trim();
  if (!normalizedTarget) return null;
  if (!doesRoleHintMatchAccount(roleHint, role)) return null;
  if (!isPostAuthTargetAllowed(normalizedTarget, role)) return null;
  return normalizedTarget;
}

export function signedInLoginDestination(
  target: unknown,
  roleHint: unknown,
  role: unknown,
): string {
  return validatedPostAuthTarget(target, roleHint, role) ?? roleHomePath(role);
}
